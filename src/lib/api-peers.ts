/**
 * Peer read/write helpers shared by the public API (v1).
 *
 * Deliberately DB-first: the peer list survives a server outage, and the router
 * is only consulted for live state (handshake/traffic). Mirrors what the panel
 * does in /api/wireguard, but scoped server-side (see access-scope.ts).
 */
import { buildLinuxClient, buildMikroTikClient } from "@/lib/tg-store";
import { cachedRouterRead } from "@/lib/router-read-cache";
import { buildEndpointResolver } from "@/lib/endpoint-domain";
import { generateKeyPair } from "@/lib/wireguard-keys";
import { logActivity } from "@/lib/activity-logger";
import { peerInScope, type PeerScope } from "@/lib/access-scope";
import type { Router } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export interface ApiPeer {
  id: string;
  name: string;
  publicKey: string;
  address: string;
  publicIp: string;
  interface: string | null;
  enabled: boolean;
  connected: boolean;
  lastHandshake: string | null;
  rx: number;
  tx: number;
  endpoint: string | null;
  createdAt: string | null;
  createdBy: string | null;
}

const HANDSHAKE_WINDOW_SEC = 180;

/** Live handshake/traffic keyed by public key; empty when the server is down. */
async function liveStateFor(router: Router): Promise<Map<string, { handshake: number; rx: number; tx: number }>> {
  const live = new Map<string, { handshake: number; rx: number; tx: number }>();
  try {
    if (router.connection_type === "linux-ssh") {
      const iface = router.wg_interface || "wg0";
      const read = await cachedRouterRead(`linux-peers:${router.id}:${iface}`, () =>
        buildLinuxClient(router, iface).getPeersForInterface(iface)
      );
      for (const p of read.data) {
        live.set(p.publicKey, {
          handshake: Number.parseInt(p.latestHandshake || "0", 10),
          rx: p.transfer?.rx || 0,
          tx: p.transfer?.tx || 0,
        });
      }
    } else {
      const read = await cachedRouterRead(`mt-peers:${router.id}`, () =>
        buildMikroTikClient(router).getWireGuardPeers()
      );
      for (const p of read.data) {
        live.set(p["public-key"], { handshake: 0, rx: Number(p.rx) || 0, tx: Number(p.tx) || 0 });
      }
    }
  } catch {
    // Server unreachable: everything reports offline, the list still works
  }
  return live;
}

export async function listPeers(
  admin: AnyClient,
  router: Router,
  scope: PeerScope
): Promise<ApiPeer[]> {
  const resolveEndpoint = await buildEndpointResolver(admin, router);
  const live = await liveStateFor(router);
  const now = Date.now() / 1000;
  const out: ApiPeer[] = [];

  const toApiPeer = (row: {
    id: string;
    public_key: string;
    name?: string | null;
    allowed_ips?: string | null;
    allowed_address?: string | null;
    public_ip?: string | null;
    comment?: string | null;
    interface?: string | null;
    disabled?: boolean;
    created_at?: string | null;
    created_by_user_id?: string | null;
    created_by_email?: string | null;
  }): ApiPeer => {
    const state = live.get(row.public_key);
    const host = resolveEndpoint(row.created_by_user_id);
    const publicIp = row.public_ip || row.comment || "";
    return {
      id: row.id,
      name: row.name || "",
      publicKey: row.public_key,
      address: row.allowed_ips || row.allowed_address || "",
      publicIp,
      interface: row.interface || router.wg_interface || null,
      enabled: !row.disabled,
      connected: Boolean(state && state.handshake > 0 && now - state.handshake < HANDSHAKE_WINDOW_SEC),
      lastHandshake: state && state.handshake > 0 ? new Date(state.handshake * 1000).toISOString() : null,
      rx: state?.rx || 0,
      tx: state?.tx || 0,
      endpoint: host ? `${host}` : publicIp || null,
      createdAt: row.created_at || null,
      createdBy: row.created_by_email || null,
    };
  };

  if (router.connection_type === "linux-ssh") {
    const { data: rows } = await admin.from("linux_peers").select("*").eq("router_id", router.id);
    for (const row of rows || []) {
      if (!peerInScope(scope, { ...row, comment: row.comment || row.public_ip })) continue;
      out.push(toApiPeer(row));
    }
  } else {
    const { data: rows } = await admin.from("peer_metadata").select("*").eq("router_id", router.id);
    for (const row of rows || []) {
      if (!peerInScope(scope, row)) continue;
      out.push(
        toApiPeer({
          id: row.id,
          public_key: row.peer_public_key,
          name: row.peer_name,
          allowed_address: row.allowed_address,
          interface: row.peer_interface,
          disabled: false,
          created_at: row.created_at,
          created_by_user_id: row.created_by_user_id,
          created_by_email: row.created_by_email,
        })
      );
    }
  }

  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

/** One peer by id, already scope-checked. */
export async function findPeer(
  admin: AnyClient,
  router: Router,
  scope: PeerScope,
  peerId: string
): Promise<ApiPeer | null> {
  const peers = await listPeers(admin, router, scope);
  return peers.find((p) => p.id === peerId || p.publicKey === peerId) || null;
}

export interface CreatePeerInput {
  name: string;
  publicIpId: string;
  actorId: string;
  actorEmail: string;
}

/**
 * Creates a peer the same way the panel does: pick the public IP, take the next
 * free address in its subnet, add it to WireGuard and mirror it in the DB.
 */
export async function createPeer(
  admin: AnyClient,
  router: Router,
  input: CreatePeerInput
): Promise<{ peer: ApiPeer; privateKey: string } | { error: string; status: number }> {
  const { data: publicIp } = await admin.from("public_ips").select("*").eq("id", input.publicIpId).single();
  if (!publicIp || publicIp.router_id !== router.id) {
    return { error: "Public IP not found on this server", status: 404 };
  }

  const keyPair = generateKeyPair();
  const iface = publicIp.wg_interface || router.wg_interface || "wg0";

  if (router.connection_type === "linux-ssh") {
    const client = buildLinuxClient(router, iface);
    const nextIp = await client.getNextAvailableIp(publicIp.ip_number);
    if (!nextIp) return { error: "No available addresses in this subnet", status: 409 };

    const allowedAddress = `${publicIp.internal_subnet}.${nextIp}/32`;
    const added = await client.addPeer(keyPair.publicKey, allowedAddress, iface);
    if (!added) return { error: "The server rejected the peer", status: 502 };

    const { data: stored } = await admin
      .from("linux_peers")
      .insert({
        router_id: router.id,
        public_key: keyPair.publicKey,
        private_key: keyPair.privateKey,
        allowed_ips: allowedAddress,
        name: input.name,
        comment: publicIp.public_ip,
        public_ip: publicIp.public_ip,
        disabled: false,
        created_by_user_id: input.actorId,
        created_by_email: input.actorEmail,
      })
      .select()
      .single();

    await logActivity({
      supabase: admin,
      userId: input.actorId,
      routerId: router.id,
      action: "create",
      entityType: "peer",
      entityId: stored?.id || keyPair.publicKey.slice(0, 8),
      entityName: input.name,
      details: { allowedAddress, publicIp: publicIp.public_ip, interface: iface, source: "api" },
    });

    const resolveEndpoint = await buildEndpointResolver(admin, router);
    const host = resolveEndpoint(input.actorId);
    return {
      privateKey: keyPair.privateKey,
      peer: {
        id: stored?.id || keyPair.publicKey,
        name: input.name,
        publicKey: keyPair.publicKey,
        address: allowedAddress,
        publicIp: publicIp.public_ip,
        interface: iface,
        enabled: true,
        connected: false,
        lastHandshake: null,
        rx: 0,
        tx: 0,
        endpoint: host || publicIp.public_ip,
        createdAt: stored?.created_at || new Date().toISOString(),
        createdBy: input.actorEmail,
      },
    };
  }

  // MikroTik
  const client = buildMikroTikClient(router);
  const existing = await client.getWireGuardPeers();
  const prefix = `${publicIp.internal_subnet}.`;
  const used = new Set<number>();
  for (const p of existing) {
    const addr = p["allowed-address"]?.split("/")[0];
    if (addr?.startsWith(prefix)) {
      const octet = Number.parseInt(addr.split(".")[3], 10);
      if (!Number.isNaN(octet)) used.add(octet);
    }
  }
  let next = 2;
  while (used.has(next) && next < 255) next++;
  if (next >= 255) return { error: "No available addresses in this subnet", status: 409 };

  const allowedAddress = `${publicIp.internal_subnet}.${next}/32`;
  const created = await client.createWireGuardPeer({
    interface: iface,
    name: input.name,
    "allowed-address": allowedAddress,
    comment: publicIp.public_ip,
    "private-key": keyPair.privateKey,
  });

  const { data: meta } = await admin
    .from("peer_metadata")
    .insert({
      router_id: router.id,
      peer_public_key: keyPair.publicKey,
      peer_name: input.name,
      peer_interface: iface,
      allowed_address: allowedAddress,
      created_by_user_id: input.actorId,
      created_by_email: input.actorEmail,
    })
    .select()
    .single();

  await logActivity({
    supabase: admin,
    userId: input.actorId,
    routerId: router.id,
    action: "create",
    entityType: "peer",
    entityId: created[".id"],
    entityName: input.name,
    details: { allowedAddress, publicIp: publicIp.public_ip, interface: iface, source: "api" },
  });

  const resolveEndpoint = await buildEndpointResolver(admin, router);
  const host = resolveEndpoint(input.actorId);
  return {
    privateKey: keyPair.privateKey,
    peer: {
      id: meta?.id || created[".id"],
      name: input.name,
      publicKey: keyPair.publicKey,
      address: allowedAddress,
      publicIp: publicIp.public_ip,
      interface: iface,
      enabled: true,
      connected: false,
      lastHandshake: null,
      rx: 0,
      tx: 0,
      endpoint: host || publicIp.public_ip,
      createdAt: meta?.created_at || new Date().toISOString(),
      createdBy: input.actorEmail,
    },
  };
}

export interface ResolvedPeer {
  router: Router;
  peer: ApiPeer;
  privateKey: string | null;
  scope: PeerScope;
}

/**
 * Finds a peer by id across the servers the caller may use, so the public API
 * can address peers by id alone.
 */
export async function resolvePeer(
  admin: AnyClient,
  owner: { userId: string; email: string; isAdmin: boolean; capabilities: Record<string, unknown> },
  peerId: string,
  buildScope: (routerId: string) => Promise<PeerScope>,
  canUse: (routerId: string) => Promise<boolean>
): Promise<ResolvedPeer | { error: string; status: number }> {
  const { data: linuxRow } = await admin.from("linux_peers").select("*").eq("id", peerId).maybeSingle();
  const { data: metaRow } = linuxRow
    ? { data: null }
    : await admin.from("peer_metadata").select("*").eq("id", peerId).maybeSingle();

  const routerId = linuxRow?.router_id || metaRow?.router_id;
  if (!routerId) return { error: "Peer not found", status: 404 };
  if (!(await canUse(routerId))) return { error: "You don't have access to this server", status: 403 };

  const { data: router } = await admin.from("routers").select("*").eq("id", routerId).single();
  if (!router) return { error: "Server not found", status: 404 };

  const scope = await buildScope(routerId);
  const peers = await listPeers(admin, router as Router, scope);
  const peer = peers.find((p) => p.id === peerId);
  if (!peer) return { error: "Peer not found", status: 404 };

  return { router: router as Router, peer, privateKey: linuxRow?.private_key || null, scope };
}

/** Enable/disable: on Linux the peer is added to or removed from the interface. */
export async function setPeerEnabled(
  admin: AnyClient,
  router: Router,
  peer: ApiPeer,
  enabled: boolean,
  actor: { id: string; email: string }
): Promise<{ ok: true } | { error: string; status: number }> {
  const iface = peer.interface || router.wg_interface || "wg0";

  try {
    if (router.connection_type === "linux-ssh") {
      const client = buildLinuxClient(router, iface);
      if (enabled) {
        const added = await client.addPeer(peer.publicKey, peer.address, iface);
        if (!added) return { error: "The server rejected the peer", status: 502 };
      } else {
        await client.removePeer(peer.publicKey, iface);
      }
      await admin
        .from("linux_peers")
        .update({ disabled: !enabled })
        .eq("router_id", router.id)
        .eq("public_key", peer.publicKey);
    } else {
      const client = buildMikroTikClient(router);
      const remote = (await client.getWireGuardPeers()).find((p) => p["public-key"] === peer.publicKey);
      if (!remote) return { error: "Peer not found on the router", status: 404 };
      await client.updateWireGuardPeer(remote[".id"], { disabled: !enabled });
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server operation failed", status: 502 };
  }

  await logActivity({
    supabase: admin,
    userId: actor.id,
    routerId: router.id,
    action: enabled ? "enable" : "disable",
    entityType: "peer",
    entityId: peer.id,
    entityName: peer.name,
    details: { publicKey: peer.publicKey, source: "api" },
  });
  return { ok: true };
}

export async function deletePeer(
  admin: AnyClient,
  router: Router,
  peer: ApiPeer,
  actor: { id: string; email: string }
): Promise<{ ok: true } | { error: string; status: number }> {
  const iface = peer.interface || router.wg_interface || "wg0";
  try {
    if (router.connection_type === "linux-ssh") {
      await buildLinuxClient(router, iface).removePeer(peer.publicKey, iface);
      await admin.from("linux_peers").delete().eq("router_id", router.id).eq("public_key", peer.publicKey);
    } else {
      const client = buildMikroTikClient(router);
      const remote = (await client.getWireGuardPeers()).find((p) => p["public-key"] === peer.publicKey);
      if (remote) await client.deleteWireGuardPeer(remote[".id"]);
    }
    await admin
      .from("peer_metadata")
      .delete()
      .eq("router_id", router.id)
      .eq("peer_public_key", peer.publicKey);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server operation failed", status: 502 };
  }

  await logActivity({
    supabase: admin,
    userId: actor.id,
    routerId: router.id,
    action: "delete",
    entityType: "peer",
    entityId: peer.id,
    entityName: peer.name,
    details: { publicKey: peer.publicKey, source: "api" },
  });
  return { ok: true };
}

/** The .conf a client installs. Needs the server's public key and listen port. */
export async function buildPeerConfig(
  admin: AnyClient,
  router: Router,
  peer: ApiPeer,
  privateKey: string | null
): Promise<string> {
  const { data: iface } = await admin
    .from("wg_interfaces")
    .select("public_key, listen_port")
    .eq("host", router.host)
    .eq("interface_name", peer.interface || router.wg_interface)
    .maybeSingle();

  const address = peer.address.split(",")[0].split("/")[0];
  const endpointHost = peer.endpoint || peer.publicIp;
  const port = iface?.listen_port || 51820;

  return [
    "[Interface]",
    `PrivateKey = ${privateKey || "[CLIENT_PRIVATE_KEY]"}`,
    `Address = ${address}/32`,
    "DNS = 8.8.8.8",
    "",
    "[Peer]",
    `PublicKey = ${iface?.public_key || "[SERVER_PUBLIC_KEY]"}`,
    "AllowedIPs = 0.0.0.0/0",
    `Endpoint = ${endpointHost}:${port}`,
    "PersistentKeepalive = 25",
  ].join("\n");
}
