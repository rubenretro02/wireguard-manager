// Cross-portal visible password. Every Blackgoat portal (this WireGuard panel,
// the Cloud Phone portal, the VM manager) shares ONE Supabase auth user, so the
// visible "reference" password lives on that shared user
// (user_metadata.login_password). Reads across portals prefer it, so the eye
// shows the same password no matter where it was last changed.
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mirror the visible password onto the shared auth user (metadata is merged so
 * other portals' fields survive). Does NOT change the auth password — the caller
 * already did that. Returns whether the user also has a Cloud Phone profile
 * (cp_profiles), so the UI can note the change is reflected there too.
 */
export async function writeSharedPassword(
  admin: SupabaseClient,
  userId: string,
  password: string,
): Promise<{ otherPortal: boolean }> {
  try {
    const { data: got } = await admin.auth.admin.getUserById(userId);
    const meta = { ...((got?.user?.user_metadata as Record<string, unknown>) ?? {}), login_password: password };
    await admin.auth.admin.updateUserById(userId, { user_metadata: meta });
  } catch {
    /* best-effort */
  }
  let otherPortal = false;
  try {
    const { data: cp } = await admin.from("cp_profiles").select("id").eq("id", userId).maybeSingle();
    otherPortal = !!cp;
  } catch {
    /* cp_profiles unreadable -> treat as absent */
  }
  return { otherPortal };
}
