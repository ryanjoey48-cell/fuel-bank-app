import "server-only";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseAdmin } from "@/lib/admin-user-management-server";
import { DriverPortalError, type DriverPortalSession } from "@/lib/driver-portal-server";
import type { DriverProfile } from "@/lib/driver-operations";

export function profileFields(body: Record<string, unknown>) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DriverPortalError(400, "Invalid profile.");
  if (Object.keys(body).some((key) => !["displayName", "phone"].includes(key))) throw new DriverPortalError(400, "Invalid profile field.");
  if (typeof body.displayName !== "string" || typeof body.phone !== "string") throw new DriverPortalError(400, "Invalid profile.");
  const display_name = body.displayName.trim();
  const phone = body.phone.trim();
  if (!display_name || display_name.length > 100 || phone.length > 30 || (phone && !/^[+0-9() .-]+$/.test(phone))) {
    throw new DriverPortalError(400, "Invalid profile.");
  }
  return { display_name, phone: phone || null };
}

export async function readDriverProfile(
  authUserId: string,
  identity: { driverId: string; driverName: string; vehicleRegistration: string | null }
): Promise<DriverProfile> {
  const admin = createServerSupabaseAdmin();
  const [profile, auth] = await Promise.all([
    admin.from("driver_profiles").select("display_name,phone,avatar_path").eq("auth_user_id", authUserId).maybeSingle(),
    admin.auth.admin.getUserById(authUserId)
  ]);

  if (profile.error || auth.error || !auth.data.user) {
    throw new DriverPortalError(503, "Profile unavailable.");
  }

  const user = auth.data.user;

  /*
   * Use our authenticated same-origin avatar route rather than a short-lived
   * Supabase signed URL. This avoids expired URLs, browser/PWA caching issues,
   * CORS surprises and stale avatars on iPhone.
   *
   * The version query changes after every upload because avatar_path changes.
   */
  const avatarUrl = profile.data?.avatar_path
    ? `/api/driver/profile/avatar?v=${encodeURIComponent(profile.data.avatar_path)}`
    : null;

  return {
    displayName: profile.data?.display_name || identity.driverName,
    officialName: identity.driverName,
    email: user.email || "",
    phone: profile.data ? profile.data.phone || "" : String(user.user_metadata?.phone || ""),
    driverId: identity.driverId,
    vehicle: identity.vehicleRegistration,
    avatarUrl,
    lastLogin: user.last_sign_in_at || null
  };
}

export async function readDriverAvatar(authUserId: string) {
  const admin = createServerSupabaseAdmin();

  const profile = await admin
    .from("driver_profiles")
    .select("avatar_path")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (profile.error) throw new DriverPortalError(503, "Avatar unavailable.");
  if (!profile.data?.avatar_path) throw new DriverPortalError(404, "Avatar not found.");

  const downloaded = await admin.storage
    .from("driver-avatars")
    .download(profile.data.avatar_path);

  if (downloaded.error || !downloaded.data) {
    throw new DriverPortalError(404, "Avatar not found.");
  }

  return Buffer.from(await downloaded.data.arrayBuffer());
}

export async function updateDriverProfile(session: DriverPortalSession, body: Record<string, unknown>) {
  const fields = profileFields(body);
  const { error } = await createServerSupabaseAdmin()
    .from("driver_profiles")
    .upsert({ auth_user_id: session.authUserId, ...fields }, { onConflict: "auth_user_id" });

  if (error) throw new DriverPortalError(503, "Unable to save profile.");
}

export async function uploadDriverAvatar(session: DriverPortalSession, file: File) {
  if (!file.size || file.size > 5242880 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new DriverPortalError(400, "Use a JPEG, PNG or WebP image up to 5 MB.");
  }

  let bytes: Buffer;

  try {
    const input = sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 20000000,
      animated: false
    });

    const metadata = await input.metadata();

    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages || 1) > 1
    ) {
      throw new Error("Unsupported image");
    }

    bytes = await input
      .rotate()
      .resize(512, 512, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new DriverPortalError(400, "Invalid or oversized image.");
  }

  const admin = createServerSupabaseAdmin();
  const path = `${session.authUserId}/${randomUUID()}.webp`;

  const old = await admin
    .from("driver_profiles")
    .select("avatar_path")
    .eq("auth_user_id", session.authUserId)
    .maybeSingle();

  if (old.error) throw new DriverPortalError(503, "Profile unavailable.");

  const upload = await admin.storage
    .from("driver-avatars")
    .upload(path, bytes, { contentType: "image/webp", upsert: false });

  if (upload.error) throw new DriverPortalError(503, "Unable to upload avatar.");

  let initialFields = {};

  try {
    if (!old.data) {
      const current = await readDriverProfile(session.authUserId, session);
      initialFields = {
        display_name: current.displayName,
        phone: current.phone || null
      };
    }
  } catch {
    await admin.storage.from("driver-avatars").remove([path]);
    throw new DriverPortalError(503, "Profile unavailable.");
  }

  const saved = await admin
    .from("driver_profiles")
    .upsert(
      {
        auth_user_id: session.authUserId,
        ...initialFields,
        avatar_path: path
      },
      { onConflict: "auth_user_id" }
    );

  if (saved.error) {
    await admin.storage.from("driver-avatars").remove([path]);
    throw new DriverPortalError(503, "Unable to save avatar.");
  }

  if (old.data?.avatar_path) {
    await admin.storage.from("driver-avatars").remove([old.data.avatar_path]);
  }
}

export async function changeDriverPassword(session: DriverPortalSession, body: Record<string, unknown>) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DriverPortalError(400, "Invalid password request.");
  if (
    Object.keys(body).some((key) => !["currentPassword", "password", "confirmPassword"].includes(key)) ||
    typeof body.currentPassword !== "string" ||
    !body.currentPassword ||
    body.currentPassword.length > 128 ||
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128 ||
    body.password !== body.confirmPassword
  ) {
    throw new DriverPortalError(400, "Invalid password request.");
  }

  const admin = createServerSupabaseAdmin();
  const { data, error } = await admin.auth.admin.getUserById(session.authUserId);

  if (error || !data.user?.email) throw new DriverPortalError(503, "Account unavailable.");

  const auth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );

  const signed = await auth.auth.signInWithPassword({
    email: data.user.email,
    password: body.currentPassword
  });

  if (signed.error || signed.data.user?.id !== session.authUserId) {
    throw new DriverPortalError(401, "Reauthentication failed.");
  }

  try {
    const updated = await auth.auth.updateUser({ password: body.password });

    if (updated.error) {
      throw new DriverPortalError(
        400,
        "Unable to update password. Check the password policy or contact operations."
      );
    }

    const revoked = await admin
      .from("driver_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("driver_account_id", session.accountId)
      .neq("id", session.sessionId)
      .is("revoked_at", null);

    if (revoked.error) {
      throw new DriverPortalError(
        503,
        "Password updated, but other sessions could not be revoked. Contact operations."
      );
    }
  } finally {
    await auth.auth.signOut({ scope: "global" });
  }
}
