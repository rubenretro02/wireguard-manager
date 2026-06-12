import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { LinuxWireGuardClient } from "@/lib/linux-wireguard";
import { MikroTikClient } from "@/lib/mikrotik";
import { generateKeyPair } from "@/lib/wireguard-keys";
import type { AuthMethod, PublicIP, Router, WireGuardPeer } from "@/lib/types";

/**
 * Telegram store: tipos + provisioning de peers para customers.
 * Todo corre server-side con el SERVICE ROLE (bypass RLS).
 * Soporta routers `linux-ssh` (add/remove por SSH) y MikroTik
 * (create + enable/disable nativo por API/REST).
 */

export interface TgCustomer {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  language_code: string | null;
  is_banned: boolean;
  created_at: string;
  last_seen_at: string;
}

export interface TgPlan {
  id: string;
  name: string;
  description: string | null;
  price_usd: number;
  duration_days: number;
  router_id: string;
  public_ip_id: string | null;
  enabled: boolean;
  sort_order: number;
  created_at: string;
}

export type TgPeerStatus = "active" | "expired" | "disabled";

export interface TgCustomerPeer {
  id: string;
  customer_id: string;
  plan_id: string | null;
  router_id: string;
  linux_peer_id: string | null;
  peer_name: string;
  peer_public_key: string;
  peer_private_key: string | null;
  allowed_address: string;
  wg_interface: string;
  public_ip: string;
  server_public_key: string;
  listen_port: number;
  dns: string;
  status: TgPeerStatus;
  expires_at: string;
  created_at: string;
}

export type TgPaymentType = "purchase" | "renewal";
export type TgPaymentStatus = "pending" | "paid" | "failed" | "cancelled" | "expired";

export interface TgPayment {
  id: string;
  customer_id: string;
  plan_id: string | null;
  customer_peer_id: string | null;
  type: TgPaymentType;
  order_id: string;
  cryptomus_uuid: string | null;
  amount_usd: number;
  status: TgPaymentStatus;
  payment_url: string | null;
  fulfilled_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured");
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Misma lógica de puertos/tipo que /api/wireguard
export function buildMikroTikClient(router: Router): MikroTikClient {
  const ct = router.connection_type || "api";
  const isApiConnection = ct === "api" || ct === "api-ssl";
  const useApiSsl = ct === "api-ssl";
  const apiPort = ct === "api-ssl" ? (router.api_port || 8729) : (router.api_port || 8728);
  const restPort = ct === "rest-8443" ? (router.port || 8443) : (router.port || 443);
  return new MikroTikClient({
    host: router.host,
    port: restPort,
    apiPort,
    username: router.username,
    password: router.password,
    useSsl: useApiSsl,
    connectionType: isApiConnection ? "api" : "rest",
  });
}

async function findMikroTikPeerByPublicKey(
  client: MikroTikClient,
  publicKey: string
): Promise<WireGuardPeer | null> {
  const peers = await client.getWireGuardPeers();
  return peers.find((p) => p["public-key"] === publicKey) || null;
}

/** "1m30s" / "55s" / "2h3m" de MikroTik → segundos. */
function parseMikroTikDuration(value?: string): number | null {
  if (!value) return null;
  const matches = value.match(/(\d+)([wdhms])/g);
  if (!matches) return null;
  const mult: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let seconds = 0;
  for (const m of matches) {
    const num = Number.parseInt(m.slice(0, -1), 10);
    seconds += num * (mult[m.slice(-1)] || 0);
  }
  return seconds;
}

export function buildLinuxClient(router: Router, wgInterface?: string): LinuxWireGuardClient {
  return new LinuxWireGuardClient({
    host: router.host,
    port: router.ssh_port || 22,
    username: router.username,
    password: router.password,
    privateKey: router.ssh_key || undefined,
    authMethod: (router.ssh_auth_method as AuthMethod) || "password",
    wgInterface: wgInterface || router.wg_interface || "wg0",
    outInterface: router.out_interface || "ens192",
    publicIpPrefix: router.public_ip_prefix || undefined,
    internalPrefix: router.internal_prefix || "10.10",
  });
}

/** Config de cliente WireGuard (.conf) a partir de un peer guardado. */
export function buildClientConfig(peer: TgCustomerPeer): string {
  const address = peer.allowed_address.split(",")[0].split("/")[0];
  return `[Interface]
PrivateKey = ${peer.peer_private_key || "[YOUR_PRIVATE_KEY]"}
Address = ${address}/32
DNS = ${peer.dns}

[Peer]
PublicKey = ${peer.server_public_key}
AllowedIPs = 0.0.0.0/0
Endpoint = ${peer.public_ip}:${peer.listen_port}
PersistentKeepalive = 25`;
}

async function pickPublicIp(
  supabase: SupabaseClient,
  plan: TgPlan
): Promise<PublicIP> {
  // IP fija del plan (clientes con dedicated IP elegida por el admin)
  if (plan.public_ip_id) {
    const { data, error } = await supabase
      .from("public_ips")
      .select("*")
      .eq("id", plan.public_ip_id)
      .single();
    if (error || !data) throw new Error("Plan public IP not found");
    if (!data.enabled) throw new Error("Plan public IP is disabled");
    return data as PublicIP;
  }

  // Auto: SOLO IPs marcadas "for sale" por el admin (v17). Las demás quedan
  // reservadas para uso propio o dedicated. Se elige la menos cargada.
  const { data, error } = await supabase
    .from("public_ips")
    .select("*")
    .eq("router_id", plan.router_id)
    .eq("enabled", true)
    .eq("for_sale", true)
    .order("ip_number", { ascending: true });
  if (error || !data?.length) {
    throw new Error("No public IPs marked for sale on this server — mark some in Admin → Telegram → IPs for Sale");
  }

  const { data: activePeers } = await supabase
    .from("tg_customer_peers")
    .select("public_ip")
    .eq("router_id", plan.router_id)
    .eq("status", "active");
  const load = new Map<string, number>();
  for (const p of activePeers || []) {
    load.set(p.public_ip, (load.get(p.public_ip) || 0) + 1);
  }

  let best = data[0] as PublicIP;
  let bestLoad = load.get(best.public_ip) || 0;
  for (const ip of data as PublicIP[]) {
    const l = load.get(ip.public_ip) || 0;
    if (l < bestLoad) {
      best = ip;
      bestLoad = l;
    }
  }
  return best;
}

/**
 * Siguiente IP libre en el subnet, cruzando lo vivo en WireGuard (SSH) con lo
 * registrado en DB (linux_peers + tg_customer_peers) — los peers disabled no
 * están en `wg show` pero su IP sigue reservada.
 */
async function getNextFreeIp(
  supabase: SupabaseClient,
  client: LinuxWireGuardClient,
  publicIp: PublicIP,
  routerId: string
): Promise<number> {
  const used = await client.getUsedIpsInSubnet(publicIp.ip_number);

  const subnetPrefix = `${publicIp.internal_subnet}.`;
  const collect = (rows: { addr: string | null }[] | null) => {
    for (const row of rows || []) {
      const addr = row.addr?.split(",")[0]?.split("/")[0];
      if (addr?.startsWith(subnetPrefix)) {
        const lastOctet = Number.parseInt(addr.split(".")[3], 10);
        if (!Number.isNaN(lastOctet)) used.add(lastOctet);
      }
    }
  };

  const { data: dbPeers } = await supabase
    .from("linux_peers")
    .select("allowed_ips")
    .eq("router_id", routerId);
  collect((dbPeers || []).map((p) => ({ addr: p.allowed_ips as string })));

  const { data: tgPeers } = await supabase
    .from("tg_customer_peers")
    .select("allowed_address")
    .eq("router_id", routerId);
  collect((tgPeers || []).map((p) => ({ addr: p.allowed_address as string })));

  for (let i = 2; i < 255; i++) {
    if (!used.has(i)) return i;
  }
  throw new Error("No available IPs in this subnet");
}

export interface ProvisionResult {
  peer: TgCustomerPeer;
}

/**
 * Crea un peer WireGuard para un customer según un plan:
 * elige IP pública, asigna IP interna, genera llaves, lo agrega por SSH,
 * lo persiste en linux_peers (visible en el dashboard normal) y en
 * tg_customer_peers con todo lo necesario para armar la config del cliente.
 */
export async function provisionPeerForCustomer(params: {
  supabase?: SupabaseClient;
  customer: TgCustomer;
  plan: TgPlan;
  peerName?: string;
}): Promise<ProvisionResult> {
  const supabase = params.supabase || getServiceClient();
  const { customer, plan } = params;

  const { data: router, error: routerError } = await supabase
    .from("routers")
    .select("*")
    .eq("id", plan.router_id)
    .single();
  if (routerError || !router) throw new Error("Server for this plan not found");

  const isLinux = router.connection_type === "linux-ssh";
  const publicIp = await pickPublicIp(supabase, plan);
  const effectiveInterface = publicIp.wg_interface || router.wg_interface || "wg0";

  const keyPair = generateKeyPair();
  const peerName =
    params.peerName ||
    `tg-${customer.username || customer.telegram_id}-${keyPair.publicKey.substring(0, 6).replace(/[^a-zA-Z0-9]/g, "")}`;

  let serverPublicKey: string;
  let listenPort: number;
  let allowedAddress: string;
  let storedLinuxPeerId: string | null = null;

  if (isLinux) {
    const client = buildLinuxClient(router as Router, effectiveInterface);

    const serverInfo = await client.getInterfaceInfo();
    if (!serverInfo) throw new Error(`Could not read server info for ${effectiveInterface}`);
    serverPublicKey = serverInfo.publicKey;
    listenPort = serverInfo.listenPort;

    const lastOctet = await getNextFreeIp(supabase, client, publicIp, plan.router_id);
    allowedAddress = `${publicIp.internal_subnet}.${lastOctet}/32`;

    const added = await client.addPeer(keyPair.publicKey, allowedAddress, effectiveInterface);
    if (!added) throw new Error("Failed to add peer to WireGuard");

    // Persistir en linux_peers para que aparezca en el dashboard admin normal
    const { data: storedLinuxPeer, error: linuxPeerError } = await supabase
      .from("linux_peers")
      .insert({
        router_id: plan.router_id,
        public_key: keyPair.publicKey,
        private_key: keyPair.privateKey,
        allowed_ips: allowedAddress,
        name: peerName,
        comment: publicIp.public_ip,
        public_ip: publicIp.public_ip,
        disabled: false,
        created_by_email: `telegram:${customer.telegram_id}`,
      })
      .select()
      .single();
    if (linuxPeerError) {
      console.warn("[TgStore] Failed to store linux_peers row:", linuxPeerError.message);
    }
    storedLinuxPeerId = storedLinuxPeer?.id || null;
  } else {
    // MikroTik: el peer vive en el router (incluidos los disabled), así que
    // las IPs usadas salen del propio router + lo registrado en tg_customer_peers.
    const client = buildMikroTikClient(router as Router);

    const interfaces = await client.getWireGuardInterfaces();
    const iface = interfaces.find((i) => i.name === effectiveInterface);
    if (!iface) throw new Error(`Interface ${effectiveInterface} not found on router`);
    serverPublicKey = iface["public-key"];
    listenPort = iface["listen-port"] || 13231;

    const existingPeers = await client.getWireGuardPeers();
    const subnetPrefix = `${publicIp.internal_subnet}.`;
    const used = new Set<number>();
    const collect = (addr?: string | null) => {
      const ip = addr?.split(",")[0]?.split("/")[0];
      if (ip?.startsWith(subnetPrefix)) {
        const lastOctet = Number.parseInt(ip.split(".")[3], 10);
        if (!Number.isNaN(lastOctet)) used.add(lastOctet);
      }
    };
    for (const p of existingPeers) collect(p["allowed-address"]);
    const { data: tgPeers } = await supabase
      .from("tg_customer_peers")
      .select("allowed_address")
      .eq("router_id", plan.router_id);
    for (const p of tgPeers || []) collect(p.allowed_address);

    let nextOctet = 2;
    while (used.has(nextOctet) && nextOctet < 255) nextOctet++;
    if (nextOctet >= 255) throw new Error("No available IPs in this subnet");
    allowedAddress = `${subnetPrefix}${nextOctet}/32`;

    await client.createWireGuardPeer({
      interface: effectiveInterface,
      name: peerName,
      "allowed-address": allowedAddress,
      comment: publicIp.public_ip,
      "private-key": keyPair.privateKey,
    });
  }

  const expiresAt = new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000);

  const { data: tgPeer, error: tgPeerError } = await supabase
    .from("tg_customer_peers")
    .insert({
      customer_id: customer.id,
      plan_id: plan.id,
      router_id: plan.router_id,
      linux_peer_id: storedLinuxPeerId,
      peer_name: peerName,
      peer_public_key: keyPair.publicKey,
      peer_private_key: keyPair.privateKey,
      allowed_address: allowedAddress,
      wg_interface: effectiveInterface,
      public_ip: publicIp.public_ip,
      server_public_key: serverPublicKey,
      listen_port: listenPort,
      status: "active",
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (tgPeerError || !tgPeer) {
    // rollback del peer en el servidor para no dejar huérfanos
    try {
      if (isLinux) {
        await buildLinuxClient(router as Router, effectiveInterface).removePeer(keyPair.publicKey, effectiveInterface);
      } else {
        const client = buildMikroTikClient(router as Router);
        const created = await findMikroTikPeerByPublicKey(client, keyPair.publicKey);
        if (created) await client.deleteWireGuardPeer(created[".id"]);
      }
    } catch { /* best effort */ }
    throw new Error(`Failed to save customer peer: ${tgPeerError?.message}`);
  }

  return { peer: tgPeer as TgCustomerPeer };
}

/**
 * Renueva un peer: extiende expires_at desde max(ahora, expiración actual).
 * Si estaba expired/disabled lo re-agrega a WireGuard y lo reactiva.
 */
export async function renewCustomerPeer(params: {
  supabase?: SupabaseClient;
  peer: TgCustomerPeer;
  durationDays: number;
}): Promise<TgCustomerPeer> {
  const supabase = params.supabase || getServiceClient();
  const { peer, durationDays } = params;

  const base = Math.max(Date.now(), new Date(peer.expires_at).getTime());
  const newExpiry = new Date(base + durationDays * 24 * 60 * 60 * 1000);

  if (peer.status !== "active") {
    await reactivateCustomerPeerOnServer(supabase, peer);
  }

  const { data: updated, error } = await supabase
    .from("tg_customer_peers")
    .update({ status: "active", expires_at: newExpiry.toISOString() })
    .eq("id", peer.id)
    .select()
    .single();
  if (error || !updated) throw new Error(`Failed to renew peer: ${error?.message}`);
  return updated as TgCustomerPeer;
}

/**
 * Reactiva un peer en el servidor sin tocar fechas:
 * Linux re-agrega por SSH; MikroTik lo enable-a (o lo recrea con las mismas
 * llaves si fue borrado del router).
 */
export async function reactivateCustomerPeerOnServer(
  supabase: SupabaseClient,
  peer: TgCustomerPeer
): Promise<void> {
  const { data: router } = await supabase
    .from("routers")
    .select("*")
    .eq("id", peer.router_id)
    .single();
  if (!router) throw new Error("Server not found for peer");

  if (router.connection_type === "linux-ssh") {
    const client = buildLinuxClient(router as Router, peer.wg_interface);
    const added = await client.addPeer(peer.peer_public_key, peer.allowed_address, peer.wg_interface);
    if (!added) throw new Error("Failed to re-enable peer in WireGuard");
    if (peer.linux_peer_id) {
      await supabase.from("linux_peers").update({ disabled: false }).eq("id", peer.linux_peer_id);
    }
  } else {
    const client = buildMikroTikClient(router as Router);
    const existing = await findMikroTikPeerByPublicKey(client, peer.peer_public_key);
    if (existing) {
      await client.enableWireGuardPeer(existing[".id"]);
    } else {
      if (!peer.peer_private_key) {
        throw new Error("Peer no longer exists on the router and has no stored key — rotate keys to recreate it");
      }
      await client.createWireGuardPeer({
        interface: peer.wg_interface,
        name: peer.peer_name,
        "allowed-address": peer.allowed_address,
        comment: peer.public_ip,
        "private-key": peer.peer_private_key,
      });
    }
  }
}

/**
 * Rota las llaves de un peer (lo pide el customer desde la Mini App).
 * Genera un keypair nuevo, lo aplica en el servidor conservando IP/nombre,
 * y lo persiste. La config vieja del cliente deja de funcionar.
 */
export async function rotateCustomerPeerKeys(
  supabase: SupabaseClient,
  peer: TgCustomerPeer
): Promise<TgCustomerPeer> {
  const { data: router } = await supabase
    .from("routers")
    .select("*")
    .eq("id", peer.router_id)
    .single();
  if (!router) throw new Error("Server not found for peer");

  const keyPair = generateKeyPair();

  if (router.connection_type === "linux-ssh") {
    const client = buildLinuxClient(router as Router, peer.wg_interface);
    // best effort: sacar la llave vieja (puede ya no estar si está expirado)
    await client.removePeer(peer.peer_public_key, peer.wg_interface).catch(() => {});
    if (peer.status === "active") {
      const added = await client.addPeer(keyPair.publicKey, peer.allowed_address, peer.wg_interface);
      if (!added) throw new Error("Failed to apply new keys on the server");
    }
    if (peer.linux_peer_id) {
      await supabase
        .from("linux_peers")
        .update({ public_key: keyPair.publicKey, private_key: keyPair.privateKey })
        .eq("id", peer.linux_peer_id);
    }
  } else {
    const client = buildMikroTikClient(router as Router);
    const existing = await findMikroTikPeerByPublicKey(client, peer.peer_public_key);
    if (existing) {
      await client.updateWireGuardPeer(existing[".id"], {
        "private-key": keyPair.privateKey,
        "public-key": keyPair.publicKey,
      });
    } else if (peer.status === "active") {
      await client.createWireGuardPeer({
        interface: peer.wg_interface,
        name: peer.peer_name,
        "allowed-address": peer.allowed_address,
        comment: peer.public_ip,
        "private-key": keyPair.privateKey,
      });
    }
  }

  const { data: updated, error } = await supabase
    .from("tg_customer_peers")
    .update({ peer_public_key: keyPair.publicKey, peer_private_key: keyPair.privateKey })
    .eq("id", peer.id)
    .select()
    .single();
  if (error || !updated) throw new Error(`Failed to save new keys: ${error?.message}`);
  return updated as TgCustomerPeer;
}

/** Saca un peer de WireGuard y lo marca con el estado dado (expired/disabled). */
export async function deactivateCustomerPeer(params: {
  supabase?: SupabaseClient;
  peer: TgCustomerPeer;
  status: "expired" | "disabled";
}): Promise<void> {
  const supabase = params.supabase || getServiceClient();
  const { peer, status } = params;

  const { data: router } = await supabase
    .from("routers")
    .select("*")
    .eq("id", peer.router_id)
    .single();
  if (router) {
    try {
      if (router.connection_type === "linux-ssh") {
        const client = buildLinuxClient(router as Router, peer.wg_interface);
        await client.removePeer(peer.peer_public_key, peer.wg_interface);
      } else {
        const client = buildMikroTikClient(router as Router);
        const existing = await findMikroTikPeerByPublicKey(client, peer.peer_public_key);
        if (existing) await client.disableWireGuardPeer(existing[".id"]);
      }
    } catch (err) {
      console.warn("[TgStore] deactivate on server failed (continuing):", err instanceof Error ? err.message : err);
    }
  }

  await supabase.from("tg_customer_peers").update({ status }).eq("id", peer.id);
  if (peer.linux_peer_id) {
    await supabase.from("linux_peers").update({ disabled: true }).eq("id", peer.linux_peer_id);
  }
}

/** Borra el peer del servidor (Linux: remove por SSH; MikroTik: delete). */
export async function removeCustomerPeerFromServer(
  supabase: SupabaseClient,
  peer: TgCustomerPeer
): Promise<void> {
  const { data: router } = await supabase
    .from("routers")
    .select("*")
    .eq("id", peer.router_id)
    .single();
  if (!router) return;
  try {
    if (router.connection_type === "linux-ssh") {
      const client = buildLinuxClient(router as Router, peer.wg_interface);
      await client.removePeer(peer.peer_public_key, peer.wg_interface);
    } else {
      const client = buildMikroTikClient(router as Router);
      const existing = await findMikroTikPeerByPublicKey(client, peer.peer_public_key);
      if (existing) await client.deleteWireGuardPeer(existing[".id"]);
    }
  } catch (err) {
    console.warn("[TgStore] remove on server failed (continuing):", err instanceof Error ? err.message : err);
  }
}

/** Estado en vivo de un peer (handshake + tráfico). Linux por SSH, MikroTik por API. */
export async function getLivePeerStatus(peer: TgCustomerPeer): Promise<{
  connected: boolean;
  latestHandshake: string | null;
  rx: number;
  tx: number;
} | null> {
  const supabase = getServiceClient();
  const { data: router } = await supabase
    .from("routers")
    .select("*")
    .eq("id", peer.router_id)
    .single();
  if (!router) return null;

  // handshake en los últimos 3 minutos = conectado
  if (router.connection_type === "linux-ssh") {
    const client = buildLinuxClient(router as Router, peer.wg_interface);
    const peers = await client.getPeersForInterface(peer.wg_interface);
    const live = peers.find((p) => p.publicKey === peer.peer_public_key);
    if (!live) return { connected: false, latestHandshake: null, rx: 0, tx: 0 };

    const handshakeEpoch = Number.parseInt(live.latestHandshake || "0", 10);
    const connected = handshakeEpoch > 0 && Date.now() / 1000 - handshakeEpoch < 180;
    return {
      connected,
      latestHandshake: handshakeEpoch > 0 ? new Date(handshakeEpoch * 1000).toISOString() : null,
      rx: live.transfer?.rx || 0,
      tx: live.transfer?.tx || 0,
    };
  }

  const client = buildMikroTikClient(router as Router);
  const live = await findMikroTikPeerByPublicKey(client, peer.peer_public_key);
  if (!live || live.disabled) return { connected: false, latestHandshake: null, rx: 0, tx: 0 };

  const secondsAgo = parseMikroTikDuration(live["last-handshake"]);
  const connected = secondsAgo !== null && secondsAgo < 180;
  return {
    connected,
    latestHandshake: secondsAgo !== null ? new Date(Date.now() - secondsAgo * 1000).toISOString() : null,
    rx: Number(live.rx) || 0,
    tx: Number(live.tx) || 0,
  };
}
