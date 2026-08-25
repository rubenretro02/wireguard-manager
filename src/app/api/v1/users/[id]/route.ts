import { NextResponse } from "next/server";
import { apiError, authenticateApiKey, type ApiCaller } from "@/lib/api-auth";
import { logActivity } from "@/lib/activity-logger";
import { invalidateEndpointDomainCache } from "@/lib/endpoint-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A semi-admin may only touch users it created. */
async function loadManagedUser(caller: ApiCaller, userId: string) {
  const { data: user } = await caller.admin
    .from("profiles")
    .select("id, email, username, role, capabilities, created_by_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (!user) return { error: apiError("User not found", 404) };
  if (!caller.isAdmin && user.created_by_user_id !== caller.userId) {
    return { error: apiError("This user is not yours", 403) };
  }
  return { user };
}

/** PATCH /api/v1/users/{id} { capabilities?, username?, password? } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;
  if (!caller.isAdmin && !caller.capabilities.can_create_users) {
    return apiError("Your account can't manage users", 403, "no_create_users");
  }

  const { id } = await params;
  const loaded = await loadManagedUser(caller, id);
  if ("error" in loaded) return loaded.error;

  const body = await request.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (body.capabilities) {
    const granted: Record<string, boolean> = {};
    for (const [cap, value] of Object.entries(body.capabilities as Record<string, boolean>)) {
      if (!value) continue;
      if (caller.isAdmin || (caller.capabilities as Record<string, boolean>)[cap]) granted[cap] = true;
      else return apiError(`You can't grant "${cap}" because you don't have it`, 403, "capability_escalation");
    }
    update.capabilities = granted;
  }
  if (typeof body.username === "string") update.username = body.username || null;

  if (body.password) {
    if (String(body.password).length < 8) return apiError("The password must be at least 8 characters", 400);
    const { error: pwError } = await caller.admin.auth.admin.updateUserById(id, { password: body.password });
    if (pwError) return apiError(pwError.message, 400);
  }

  if (Object.keys(update).length > 0) {
    const { error: dbError } = await caller.admin.from("profiles").update(update).eq("id", id);
    if (dbError) return apiError(dbError.message, 500);
    invalidateEndpointDomainCache();
  }

  await logActivity({
    supabase: caller.admin,
    userId: caller.userId,
    action: "update",
    entityType: "user",
    entityId: id,
    entityName: loaded.user.email,
    details: { fields: Object.keys(update), password: Boolean(body.password), source: "api" },
  });

  return NextResponse.json({ user: { id, ...update } });
}

/** DELETE /api/v1/users/{id} — requires can_delete. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;
  if (!caller.isAdmin && !caller.capabilities.can_delete) {
    return apiError("Your account can't delete users", 403, "no_delete");
  }

  const { id } = await params;
  const loaded = await loadManagedUser(caller, id);
  if ("error" in loaded) return loaded.error;

  const { error: authError } = await caller.admin.auth.admin.deleteUser(id);
  if (authError) return apiError(authError.message, 500);

  await logActivity({
    supabase: caller.admin,
    userId: caller.userId,
    action: "delete",
    entityType: "user",
    entityId: id,
    entityName: loaded.user.email,
    details: { source: "api" },
  });

  return NextResponse.json({ deleted: true });
}
