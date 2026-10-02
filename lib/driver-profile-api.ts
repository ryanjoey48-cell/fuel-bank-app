import "server-only";
import { DriverPortalError, getDriverPortalSession } from "@/lib/driver-portal-server";
export async function ownDriver(request?: Request) {
  if (request && request.headers.get("origin") !== new URL(request.url).origin) throw new DriverPortalError(403, "Invalid request origin.");
  const session = await getDriverPortalSession();
  if (!session) throw new DriverPortalError(401, "Driver sign-in required.");
  return session;
}
export function profileResponse(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }
export function profileError(error: unknown) { return profileResponse({ error: error instanceof DriverPortalError ? error.message : "Request unavailable." }, error instanceof DriverPortalError ? error.status : 500); }
export async function limitedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new DriverPortalError(413, "Request too large.");
  const reader = request.body?.getReader(); if (!reader) throw new DriverPortalError(400, "Missing request body.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new DriverPortalError(413, "Request too large."); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks));
}
export async function profileJson(request: Request) {
  try { const value = JSON.parse(new TextDecoder().decode(await limitedBody(request, 8192))); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch (e) { if (e instanceof DriverPortalError) throw e; throw new DriverPortalError(400, "Invalid request body."); }
}
