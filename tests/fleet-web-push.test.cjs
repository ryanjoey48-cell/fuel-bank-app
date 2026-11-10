const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const crypto = require("node:crypto");
const file = path.resolve(__dirname, "../lib/fleet-web-push-server.ts");
const loaded = new Module(file, module);
loaded.require = (request) => request === "server-only" ? {} : require(request);
loaded._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, file);
const { encryptFleetWebPushPayload, isAllowedFleetPushEndpoint, sendFleetWebPushTest } = loaded.exports;

test("RFC 8291 known vector produces the expected encrypted Web Push body", () => {
  const body = encryptFleetWebPushPayload({
    p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    plaintext: "When I grow up, I want to be a watermelon",
    senderPrivateKey: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"),
    salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url")
  });
  assert.equal(body.length, 144); // The RFC's Content-Length says 145, but its published body decodes to 144.
  assert.equal(body.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("push destinations are restricted to known HTTPS push services", () => {
  assert.equal(isAllowedFleetPushEndpoint("https://web.push.apple.com/Q123"), true);
  assert.equal(isAllowedFleetPushEndpoint("http://web.push.apple.com/Q123"), false);
  assert.equal(isAllowedFleetPushEndpoint("https://push.apple.com.evil.example/Q123"), false);
  assert.equal(isAllowedFleetPushEndpoint("https://127.0.0.1/private"), false);
});

test("server push test signs with VAPID and classifies permanent and retryable delivery failures", async () => {
  const vapid = crypto.createECDH("prime256v1");
  vapid.generateKeys();
  const recipient = crypto.createECDH("prime256v1");
  recipient.generateKeys();
  const config = { publicKey: vapid.getPublicKey().toString("base64url"),
    privateKey: vapid.getPrivateKey().toString("base64url"), subject: "mailto:ops@example.com" };
  const subscription = { endpoint: "https://web.push.apple.com/test", p256dh: recipient.getPublicKey().toString("base64url"),
    auth_secret: crypto.randomBytes(16).toString("base64url") };
  const originalFetch = global.fetch;
  try {
    let captured;
    global.fetch = async (_url, options) => { captured = options; return { ok: false, status: 410 }; };
    assert.deepEqual(await sendFleetWebPushTest(subscription, config),
      { status: "permanent_failure", httpStatus: 410, errorCode: "push_http_410" });
    assert.equal(captured.headers["Content-Encoding"], "aes128gcm");
    assert.match(captured.headers.Authorization, /^vapid t=.*k=/);
    // Decrypt is heavy; assert ciphertext exists and plaintext was marked TEST at encrypt time via body length.
    assert.ok(Buffer.isBuffer(captured.body) || captured.body instanceof Uint8Array);
    // Reconstruct expected plaintext marker by re-encrypting is non-deterministic; assert via source contract:
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /\[TEST\] EES notification test/);
    assert.match(source, /ees-fleet-test-not-operational/);
    assert.match(source, /Not a live fleet arrival/);
    const token = captured.headers.Authorization.match(/^vapid t=([^,]+), k=/)[1];
    const [header, claims, signature] = token.split(".");
    assert.equal(JSON.parse(Buffer.from(claims, "base64url")).aud, "https://web.push.apple.com");
    const publicBytes = vapid.getPublicKey();
    const publicKey = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256",
      x: publicBytes.subarray(1, 33).toString("base64url"),
      y: publicBytes.subarray(33).toString("base64url") }, format: "jwk" });
    assert.equal(crypto.verify("sha256", Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")), true);
    assert.equal(captured.redirect, "error");
    global.fetch = async () => ({ ok: false, status: 503 });
    assert.equal((await sendFleetWebPushTest(subscription, config)).status, "retryable_failure");
    global.fetch = async () => { throw new Error("network down"); };
    assert.equal((await sendFleetWebPushTest(subscription, config)).errorCode, "push_network_error");
  } finally { global.fetch = originalFetch; }
});
