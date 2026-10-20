import { createSessionRestClient, supabase } from "@/lib/supabase";
import { withRequestDeadline } from "@/lib/request-deadline";
import { assertOilDeleteAccess, OilServiceDeleteError } from "@/lib/oil-service-delete";

function sessionError(error: { message?: string; name?: string; status?: number } | null, message: string): never {
  const network = error?.name === "AuthRetryableFetchError" || (error?.status != null && error.status >= 500)
    || /fetch|network|timed out|abort/i.test(error?.message ?? "");
  throw new OilServiceDeleteError(network ? "network" : "authentication", network
    ? "Authentication service could not be reached. No DELETE was sent. Check your connection and retry."
    : message);
}

export async function createOilServiceDeleteContext() {
  const sessionResult = await withRequestDeadline(() => supabase.auth.getSession());
  const session = sessionResult.data.session;
  if (sessionResult.error || !session?.access_token) sessionError(sessionResult.error, "Sign in again before deleting an oil-service record. No DELETE was sent.");
  const userResult = await withRequestDeadline(() => supabase.auth.getUser(session.access_token));
  if (userResult.error || !userResult.data.user) sessionError(userResult.error, "Supabase could not verify your current session. No DELETE was sent.");
  let claims: { sub?: string; role?: string };
  try {
    const encoded = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    claims = JSON.parse(atob(encoded));
  } catch {
    throw new OilServiceDeleteError("authentication", "The verified session's database role could not be read. No DELETE was sent.");
  }
  if (claims.sub !== userResult.data.user.id || claims.role !== "authenticated") throw new OilServiceDeleteError("authentication", "An authenticated user session is required; anonymous or service-role browser requests are not permitted.");
  const client = createSessionRestClient(session.access_token);
  const [roleResult, activeResult, officeResult] = await Promise.all([client.rpc("current_account_role"), client.rpc("is_account_active"), client.rpc("is_office_account")]);
  const roleError = roleResult.error || activeResult.error || officeResult.error;
  if (roleError) {
    const network = [roleResult, activeResult, officeResult].some(result => result.status === 0)
      || /fetch|network|timed out|abort/i.test(roleError.message);
    throw new OilServiceDeleteError(network ? "network" : "permission_denied", network
      ? "Account-permission lookup failed due to a network error. No DELETE was sent."
      : `Unable to verify account permissions in Supabase. No DELETE was sent. ${roleError.message}`);
  }
  const accountRole = typeof roleResult.data === "string" ? roleResult.data : null;
  assertOilDeleteAccess(accountRole, activeResult.data === true && officeResult.data === true);
  return { client, projectHost: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,
    userId: userResult.data.user.id, databaseRole: claims.role, accountRole };
}
