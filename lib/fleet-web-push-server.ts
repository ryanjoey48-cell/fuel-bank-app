import "server-only";
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign, timingSafeEqual } from "node:crypto";

type PushSubscriptionSecret = { endpoint: string; p256dh: string; auth_secret: string };
type VapidConfig = { publicKey: string; privateKey: string; subject: string };

function decode(value: string) { return Buffer.from(value, "base64url"); }
function hmac(key: Buffer, value: Buffer) { return createHmac("sha256", key).update(value).digest(); }

export function isAllowedFleetPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (host.endsWith(".push.apple.com") || host === "push.apple.com" ||
        host === "fcm.googleapis.com" || host.endsWith(".push.services.mozilla.com"));
  } catch { return false; }
}

/** RFC 8291 and RFC 8188, one aes128gcm record. Optional fixed inputs are for RFC test vectors only. */
export function encryptFleetWebPushPayload(input: {
  p256dh: string; auth: string; plaintext: string;
  senderPrivateKey?: Buffer; salt?: Buffer;
}) {
  const uaPublic = decode(input.p256dh);
  const authSecret = decode(input.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error("Invalid push encryption keys.");
  const sender = createECDH("prime256v1");
  sender.setPrivateKey(input.senderPrivateKey ?? randomBytes(32));
  const asPublic = sender.getPublicKey(undefined, "uncompressed");
  const salt = input.salt ?? randomBytes(16);
  if (salt.length !== 16) throw new Error("Invalid push salt.");
  const secret = sender.computeSecret(uaPublic); // Node validates the P-256 point.
  const prkKey = hmac(authSecret, secret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]))
    .subarray(0, 32);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const message = Buffer.concat([Buffer.from(input.plaintext, "utf8"), Buffer.from([2])]);
  if (message.length + 16 >= 4096) throw new Error("Push payload is too large.");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(message), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([65]), asPublic, ciphertext]);
}

function vapidAuthorization(endpoint: string, config: VapidConfig) {
  const publicBytes = decode(config.publicKey);
  const privateBytes = decode(config.privateKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) throw new Error("VAPID keys are invalid.");
  const pair = createECDH("prime256v1");
  pair.setPrivateKey(privateBytes);
  if (!timingSafeEqual(pair.getPublicKey(undefined, "uncompressed"), publicBytes)) throw new Error("VAPID key pair does not match.");
  if (!/^mailto:[^\s@]+@[^\s@]+$|^https:\/\/[^\s]+$/.test(config.subject)) throw new Error("VAPID contact is invalid.");
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: config.privateKey,
    x: publicBytes.subarray(1, 33).toString("base64url"), y: publicBytes.subarray(33).toString("base64url") }, format: "jwk" });
  const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 3600,
    sub: config.subject })).toString("base64url");
  const signed = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(signed), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `vapid t=${signed}.${signature}, k=${config.publicKey}`;
}

export async function sendFleetWebPushTest(subscription: PushSubscriptionSecret, config: VapidConfig) {
  if (!isAllowedFleetPushEndpoint(subscription.endpoint)) throw new Error("Push endpoint is not permitted.");
  const body = encryptFleetWebPushPayload({ p256dh: subscription.p256dh, auth: subscription.auth_secret,
    plaintext: JSON.stringify({
      title: "[TEST] EES notification test",
      body: "[TEST] Server delivery test only. Not a live fleet arrival/departure alert.",
      href: "/fleet-events?testPush=1",
      tag: "ees-fleet-test-not-operational"
    }) });
  try {
    const response = await fetch(subscription.endpoint, { method: "POST", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(10_000), headers: {
        Authorization: vapidAuthorization(subscription.endpoint, config), TTL: "60",
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream"
      }, body: new Uint8Array(body) });
    return { status: response.ok ? "delivered" as const : [404, 410].includes(response.status) ? "permanent_failure" as const : "retryable_failure" as const,
      httpStatus: response.status, errorCode: response.ok ? null : `push_http_${response.status}` };
  } catch {
    return { status: "retryable_failure" as const, httpStatus: null, errorCode: "push_network_error" };
  }
}
