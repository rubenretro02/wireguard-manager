import { NextResponse } from "next/server";
import { apiError, authenticateApiKey } from "@/lib/api-auth";
import { canUseRouter } from "@/lib/access-scope";
import { buildSocksClient, rebuildProxies, toApiProxy as toApi, type ProxyRow } from "@/lib/api-proxies";
import { logActivity } from "@/lib/activity-logger";
import type { Router } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/proxies?server=<id> — the caller's SOCKS5 proxies. */
export async function GET(request: Request) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;

  const serverId = new URL(request.url).searchParams.get("server");
  let query = caller.admin.from("socks5_proxies").select("*").order("created_at", { ascending: false });
  if (serverId) {
    if (!(await canUseRouter(caller.admin, caller, serverId))) {
      return apiError("You don't have access to this server", 403);
    }
    query = query.eq("router_id", serverId);
  }
  // Only proxies this caller owns, unless they may see everything
  if (!caller.isAdmin && !caller.capabilities.can_see_all_proxies) {
    query = query.eq("created_by", caller.userId);
  }

  const { data, error: dbError } = await query;
  if (dbError) return apiError(dbError.message, 500);
  return NextResponse.json({ proxies: (data || []).map(toApi) });
}

/** POST /api/v1/proxies { server, username, password, publicIp, name?, maxConnections?, expiresAt? } */
export async function POST(request: Request) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;

  const body = await request.json().catch(() => ({}));
  const { server: serverId, username, password, publicIp, name, maxConnections, expiresAt } = body;
  if (!serverId || !username || !password || !publicIp) {
    return apiError("Required: server, username, password, publicIp", 400);
  }
  if (!(await canUseRouter(caller.admin, caller, serverId))) {
    return apiError("You don't have access to this server", 403);
  }

  const { data: router } = await caller.admin.from("routers").select("*").eq("id", serverId).single();
  if (!router) return apiError("Server not found", 404);

  // The IP has to exist on the box, otherwise 3proxy would fail to bind
  const available = await buildSocksClient(router as Router).getAvailablePublicIps();
  if (available.length > 0 && !available.includes(publicIp)) {
    return apiError(`${publicIp} is not configured on this server`, 400, "ip_not_on_server");
  }

  const { data: proxy, error: insertError } = await caller.admin
    .from("socks5_proxies")
    .insert({
      router_id: serverId,
      username,
      password,
      public_ip: publicIp,
      port: 1080,
      max_connections: maxConnections || 0,
      name: name || null,
      expires_at: expiresAt || null,
      enabled: true,
      created_by: caller.userId,
    })
    .select()
    .single();
  if (insertError) return apiError(insertError.message, 500);

  const result = await rebuildProxies(caller.admin, router as Router);
  if (!result.success) {
    await caller.admin.from("socks5_proxies").delete().eq("id", proxy.id);
    return apiError(result.message, 502);
  }

  await logActivity({
    supabase: caller.admin,
    userId: caller.userId,
    routerId: serverId,
    action: "create",
    entityType: "socks5",
    entityId: proxy.id,
    entityName: username,
    details: { publicIp, source: "api" },
  });

  return NextResponse.json({ proxy: toApi(proxy) }, { status: 201 });
}
