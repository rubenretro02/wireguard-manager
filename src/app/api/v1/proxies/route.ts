import { NextResponse } from "next/server";
import { apiError, authenticateApiKey, type ApiCaller } from "@/lib/api-auth";
import { canUseRouter } from "@/lib/access-scope";
import { Socks5ProxyClient } from "@/lib/socks5-proxy";
import { logActivity } from "@/lib/activity-logger";
import type { Router } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProxyRow {
  id: string;
  router_id: string;
  username: string;
  password: string;
  public_ip: string;
  port: number;
  enabled: boolean;
  name: string | null;
  max_connections: number | null;
  expires_at: string | null;
  created_by: string | null;
  bytes_sent: number | null;
  bytes_received: number | null;
  last_connected_at: string | null;
}

export function buildSocksClient(router: Router) {
  return new Socks5ProxyClient({
    host: router.host,
    port: router.ssh_port || 22,
    username: router.username,
    password: router.password,
    privateKey: router.ssh_key || undefined,
    authMethod: (router.ssh_auth_method as "password" | "key" | "both") || "password",
  });
}

/** 3proxy holds every proxy of a server in one config file, so it is rebuilt whole. */
export async function rebuildProxies(caller: ApiCaller, router: Router) {
  const { data: all } = await caller.admin
    .from("socks5_proxies")
    .select("*")
    .eq("router_id", router.id)
    .eq("enabled", true);

  return buildSocksClient(router).rebuildConfig(
    (all || []).map((p: ProxyRow) => ({
      username: p.username,
      password: p.password,
      publicIp: p.public_ip,
      port: 1080,
      enabled: true,
      maxConnections: p.max_connections || 0,
    }))
  );
}

function toApi(p: ProxyRow) {
  return {
    id: p.id,
    name: p.name,
    username: p.username,
    password: p.password,
    host: p.public_ip,
    port: p.port,
    enabled: p.enabled,
    maxConnections: p.max_connections || 0,
    expiresAt: p.expires_at,
    bytesSent: p.bytes_sent || 0,
    bytesReceived: p.bytes_received || 0,
    lastConnectedAt: p.last_connected_at,
  };
}

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

  const result = await rebuildProxies(caller, router as Router);
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
