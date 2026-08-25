/** Glue between an API caller and the scope/peer helpers. */
import { buildPeerScope, canUseRouter, type PeerScope } from "@/lib/access-scope";
import { resolvePeer, type ResolvedPeer } from "@/lib/api-peers";
import type { ApiCaller } from "@/lib/api-auth";

export function scopeFor(caller: ApiCaller) {
  return (routerId: string): Promise<PeerScope> => buildPeerScope(caller.admin, caller, routerId);
}

export function routerCheckFor(caller: ApiCaller) {
  return (routerId: string): Promise<boolean> => canUseRouter(caller.admin, caller, routerId);
}

export function resolvePeerFor(
  caller: ApiCaller,
  peerId: string
): Promise<ResolvedPeer | { error: string; status: number }> {
  return resolvePeer(
    caller.admin,
    { userId: caller.userId, email: caller.email, isAdmin: caller.isAdmin, capabilities: caller.capabilities as Record<string, unknown> },
    peerId,
    scopeFor(caller),
    routerCheckFor(caller)
  );
}
