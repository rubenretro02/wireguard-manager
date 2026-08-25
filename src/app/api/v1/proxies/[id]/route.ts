import { NextResponse } from "next/server";
import { apiError, authenticateApiKey, type ApiCaller } from "@/lib/api-auth";
import { logActivity } from "@/lib/activity-logger";
import { rebuildProxies } from "@/lib/api-proxies";
import type { Router } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadOwnProxy(caller: ApiCaller, proxyId: string) {
  const { data: proxy } = await caller.admin
    .from("socks5_proxies")
    .select("*")
    .eq("id", proxyId)
    .maybeSingle();
  if (!proxy) return { error: apiError("Proxy not found", 404) };
  if (!caller.isAdmin && !caller.capabilities.can_see_all_proxies && proxy.created_by !== caller.userId) {
    return { error: apiError("This proxy is not yours", 403) };
  }
  const { data: router } = await caller.admin.from("routers").select("*").eq("id", proxy.router_id).single();
  if (!router) return { error: apiError("Server not found", 404) };
  return { proxy, router: router as Router };
}

/** PATCH /api/v1/proxies/{id} { password?, maxConnections?, name?, enabled?, expiresAt? } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;

  const loaded = await loadOwnProxy(caller, (await params).id);
  if ("error" in loaded) return loaded.error;

  const body = await request.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  if (typeof body.password === "string" && body.password) update.password = body.password;
  if (typeof body.name === "string") update.name = body.name || null;
  if (body.maxConnections !== undefined) update.max_connections = Number(body.maxConnections) || 0;
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (body.expiresAt !== undefined) update.expires_at = body.expiresAt;

  if (Object.keys(update).length === 0) return apiError("Nothing to update", 400);

  const { error: dbError } = await caller.admin.from("socks5_proxies").update(update).eq("id", loaded.proxy.id);
  if (dbError) return apiError(dbError.message, 500);

  const result = await rebuildProxies(caller.admin, loaded.router);
  if (!result.success) return apiError(result.message, 502);

  await logActivity({
    supabase: caller.admin,
    userId: caller.userId,
    routerId: loaded.router.id,
    action: "update",
    entityType: "socks5",
    entityId: loaded.proxy.id,
    entityName: loaded.proxy.username,
    details: { fields: Object.keys(update), source: "api" },
  });

  return NextResponse.json({ updated: true });
}

/** DELETE /api/v1/proxies/{id} — requires can_delete. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;
  if (!caller.isAdmin && !caller.capabilities.can_delete) {
    return apiError("Your account can't delete proxies", 403, "no_delete");
  }

  const loaded = await loadOwnProxy(caller, (await params).id);
  if ("error" in loaded) return loaded.error;

  const { error: dbError } = await caller.admin.from("socks5_proxies").delete().eq("id", loaded.proxy.id);
  if (dbError) return apiError(dbError.message, 500);

  const result = await rebuildProxies(caller.admin, loaded.router);
  if (!result.success) return apiError(result.message, 502);

  await logActivity({
    supabase: caller.admin,
    userId: caller.userId,
    routerId: loaded.router.id,
    action: "delete",
    entityType: "socks5",
    entityId: loaded.proxy.id,
    entityName: loaded.proxy.username,
    details: { source: "api" },
  });

  return NextResponse.json({ deleted: true });
}
