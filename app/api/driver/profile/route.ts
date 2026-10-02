import { ownDriver, profileError, profileResponse, profileJson } from "@/lib/driver-profile-api";
import { readDriverProfile, updateDriverProfile } from "@/lib/driver-profile-server";
export const dynamic = "force-dynamic";
export async function GET() {
  try { const session = await ownDriver(); return profileResponse(await readDriverProfile(session.authUserId, session)); } catch (e) { return profileError(e); }
}
export async function PATCH(request: Request) {
  try { const session = await ownDriver(request); const body = await profileJson(request); await updateDriverProfile(session, body); return profileResponse({ saved: true }); } catch (e) { return profileError(e); }
}
