import { ownDriver, profileError, profileResponse, limitedBody } from "@/lib/driver-profile-api";
import { readDriverAvatar, readDriverProfile, uploadDriverAvatar } from "@/lib/driver-profile-server";
import { DriverPortalError } from "@/lib/driver-portal-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await ownDriver(request);
    const bytes = await readDriverAvatar(session.authUserId);

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (e) {
    return profileError(e);
  }
}

export async function POST(request: Request) {
  try {
    const session = await ownDriver(request);

    if (Number(request.headers.get("content-length")) > 5500000) {
      throw new DriverPortalError(413, "File too large.");
    }

    const body = await new Response(await limitedBody(request, 5500000), {
      headers: { "Content-Type": request.headers.get("content-type") || "" }
    }).formData();

    const file = body.get("avatar");

    if (!(file instanceof File) || [...body.keys()].some((key) => key !== "avatar")) {
      throw new DriverPortalError(400, "Invalid upload.");
    }

    await uploadDriverAvatar(session, file);

    return profileResponse(
      await readDriverProfile(session.authUserId, session)
    );
  } catch (e) {
    return profileError(e);
  }
}
