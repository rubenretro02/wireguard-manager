import { NextResponse } from "next/server";
import { apiError, authenticateApiKey } from "@/lib/api-auth";
import { logActivity } from "@/lib/activity-logger";
import { invalidateEndpointDomainCache } from "@/lib/endpoint-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/users — the users this key's owner created. */
export async function GET(request: Request) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;
  if (!caller.isAdmin && !caller.capabilities.can_create_users) {
    return apiError("Your account can't manage users", 403, "no_create_users");
  }

  let query = caller.admin
    .from("profiles")
    .select("id, email, username, role, capabilities, created_at, created_by_user_id")
    .order("created_at", { ascending: false });
  // Admins see everyone; a semi-admin only sees the users they created
  if (!caller.isAdmin) query = query.eq("created_by_user_id", caller.userId);

  const { data, error: dbError } = await query;
  if (dbError) return apiError(dbError.message, 500);

  return NextResponse.json({
    users: (data || []).map((u: { id: string; email: string; username: string | null; role: string; capabilities: unknown; created_at: string }) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      role: u.role,
      capabilities: u.capabilities || {},
      createdAt: u.created_at,
    })),
  });
}

/** POST /api/v1/users { email, password, username?, capabilities?, servers? } */
export async function POST(request: Request) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;
  if (!caller.isAdmin && !caller.capabilities.can_create_users) {
    return apiError("Your account can't create users", 403, "no_create_users");
  }

  const body = await request.json().catch(() => ({}));
  const { email, password, username, capabilities, servers } = body;
  if (!email || !password) return apiError("Required: email, password", 400);
  if (String(password).length < 8) return apiError("The password must be at least 8 characters", 400);

  // A semi-admin can never grant capabilities it doesn't hold itself
  const requested = (capabilities || {}) as Record<string, boolean>;
  const granted: Record<string, boolean> = {};
  for (const [cap, value] of Object.entries(requested)) {
    if (!value) continue;
    if (caller.isAdmin || (caller.capabilities as Record<string, boolean>)[cap]) granted[cap] = true;
    else return apiError(`You can't grant "${cap}" because you don't have it`, 403, "capability_escalation");
  }

  const { data: created, error: authError } = await caller.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !created?.user) {
    return apiError(authError?.message || "Could not create the user", 400);
  }

  const { error: profileError } = await caller.admin.from("profiles").upsert({
    id: created.user.id,
    email,
    username: username || null,
    role: "user",
    capabilities: granted,
    created_by_user_id: caller.userId,
  });
  if (profileError) return apiError(profileError.message, 500);

  // Server access: only servers the caller can use
  const requestedServers: string[] = Array.isArray(servers) ? servers : [];
  if (requestedServers.length > 0) {
    let allowed = requestedServers;
    if (!caller.isAdmin) {
      const { data: mine } = await caller.admin
        .from("user_routers")
        .select("router_id")
        .eq("user_id", caller.userId);
      const mineSet = new Set((mine || []).map((r: { router_id: string }) => r.router_id));
      allowed = requestedServers.filter((id) => mineSet.has(id));
    }
    if (allowed.length > 0) {
      await caller.admin
        .from("user_routers")
        .insert(allowed.map((routerId) => ({ user_id: created.user.id, router_id: routerId })));
    }
  }

  invalidateEndpointDomainCache();

  await logActivity({
    supabase: caller.admin,
    userId: caller.userId,
    action: "create",
    entityType: "user",
    entityId: created.user.id,
    entityName: email,
    details: { capabilities: granted, source: "api" },
  });

  return NextResponse.json(
    { user: { id: created.user.id, email, username: username || null, capabilities: granted } },
    { status: 201 }
  );
}
