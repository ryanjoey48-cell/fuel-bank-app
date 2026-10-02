import { ownDriver, profileError, profileResponse, limitedBody } from "@/lib/driver-profile-api";
import { readDriverProfile, uploadDriverAvatar } from "@/lib/driver-profile-server";
import { DriverPortalError } from "@/lib/driver-portal-server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const session = await ownDriver(request);
    if (Number(request.headers.get("content-length")) > 5500000) throw new DriverPortalError(413, "File too large.");
    const body = await new Response(await limitedBody(request, 5500000), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData(); const file = body.get("avatar");
    if (!(file instanceof File) || [...body.keys()].some((key) => key !== "avatar")) throw new DriverPortalError(400, "Invalid upload.");
    await uploadDriverAvatar(session, file); return profileResponse(await readDriverProfile(session.authUserId, session));
  } catch (e) { return profileError(e); }
}
