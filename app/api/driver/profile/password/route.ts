import { ownDriver, profileError, profileResponse, profileJson } from "@/lib/driver-profile-api";
import { changeDriverPassword } from "@/lib/driver-profile-server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { const session = await ownDriver(request); await changeDriverPassword(session, await profileJson(request)); return profileResponse({ saved: true }); } catch (e) { return profileError(e); }
}
