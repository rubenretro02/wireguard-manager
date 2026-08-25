import { NextResponse } from "next/server";
import { apiError, authenticateApiKey } from "@/lib/api-auth";
import { allowedPublicIpsForRouter, buildPeerScope, canUseRouter } from "@/lib/access-scope";
import { buildPeerConfig, createPeer, listPeers } from "@/lib/api-peers";
import type { Router } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/peers?server=<id> — the peers this key may see on that server. */
export async function GET(request: Request) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;

  const serverId = new URL(request.url).searchParams.get("server");
  if (!serverId) return apiError("Missing ?server=<id>", 400);
  if (!(await canUseRouter(caller.admin, caller, serverId))) {
    return apiError("You don't have access to this server", 403);
  }

  const { data: router } = await caller.admin.from("routers").select("*").eq("id", serverId).single();
  if (!router) return apiError("Server not found", 404);

  const scope = await buildPeerScope(caller.admin, caller, serverId);
  const peers = await listPeers(caller.admin, router as Router, scope);
  return NextResponse.json({ peers });
}

/** POST /api/v1/peers { server, name, publicIpId } — create a peer, returns its config. */
export async function POST(request: Request) {
  const { caller, error } = await authenticateApiKey(request);
  if (error || !caller) return error!;

  const body = await request.json().catch(() => ({}));
  const { server: serverId, name, publicIpId } = body;
  if (!serverId || !name || !publicIpId) {
    return apiError("Required: server, name, publicIpId", 400);
  }
  if (!(await canUseRouter(caller.admin, caller, serverId))) {
    return apiError("You don't have access to this server", 403);
  }

  // The IP must be one this caller is allowed to use, not just any IP of the server
  const usableIps = await allowedPublicIpsForRouter(caller.admin, caller, serverId);
  if (!usableIps.some((ip) => ip.id === publicIpId)) {
    return apiError("You don't have access to this public IP", 403);
  }

  const { data: router } = await caller.admin.from("routers").select("*").eq("id", serverId).single();
  if (!router) return apiError("Server not found", 404);

  const result = await createPeer(caller.admin, router as Router, {
    name: String(name).slice(0, 80),
    publicIpId,
    actorId: caller.userId,
    actorEmail: caller.email,
  });
  if ("error" in result) return apiError(result.error, result.status);

  const config = await buildPeerConfig(caller.admin, router as Router, result.peer, result.privateKey);
  return NextResponse.json({ peer: result.peer, privateKey: result.privateKey, config }, { status: 201 });
}
