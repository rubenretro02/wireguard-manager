import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { LinuxWireGuardClient } from "@/lib/linux-wireguard";
import { generateKeyPair } from "@/lib/wireguard-keys";
import type { AuthMethod, PublicIP, Router } from "@/lib/types";

/**
 * Telegram store: tipos + provisioning de peers para customers.
 * Todo corre server-side con el SERVICE ROLE (bypass RLS).
 * v1: solo routers `linux-ssh` (el flujo MikroTik queda para después).
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
  peer_private_key: string;
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
PrivateKey = ${peer.peer_private_key}
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
  const { data, error } = await supabase
    .from("public_ips")
    .select("*")
    .eq("router_id", plan.router_id)
    .eq("enabled", true)
    .eq("restricted", false)
    .order("ip_number", { ascending: true });
  if (error || !data?.length) throw new Error("No public IPs available for this plan's server");
  return data[0] as PublicIP;
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
  if (router.connection_type !== "linux-ssh") {
    throw new Error("Automatic provisioning only supports linux-ssh servers for now");
  }

  const publicIp = await pickPublicIp(supabase, plan);
  const effectiveInterface = publicIp.wg_interface || router.wg_interface || "wg0";
  const client = buildLinuxClient(router as Router, effectiveInterface);

  const serverInfo = await client.getInterfaceInfo();
  if (!serverInfo) throw new Error(`Could not read server info for ${effectiveInterface}`);

  const lastOctet = await getNextFreeIp(supabase, client, publicIp, plan.router_id);
  const allowedAddress = `${publicIp.internal_subnet}.${lastOctet}/32`;

  const keyPair = generateKeyPair();
  const peerName =
    params.peerName ||
    `tg-${customer.username || customer.telegram_id}-${keyPair.publicKey.substring(0, 6).replace(/[^a-zA-Z0-9]/g, "")}`;

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

  const expiresAt = new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000);

  const { data: tgPeer, error: tgPeerError } = await supabase
    .from("tg_customer_peers")
    .insert({
      customer_id: customer.id,
      plan_id: plan.id,
      router_id: plan.router_id,
      linux_peer_id: storedLinuxPeer?.id || null,
      peer_name: peerName,
      peer_public_key: keyPair.publicKey,
      peer_private_key: keyPair.privateKey,
      allowed_address: allowedAddress,
      wg_interface: effectiveInterface,
      public_ip: publicIp.public_ip,
      server_public_key: serverInfo.publicKey,
      listen_port: serverInfo.listenPort,
      status: "active",
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (tgPeerError || !tgPeer) {
    // rollback del peer en WG para no dejar huérfanos
    await client.removePeer(keyPair.publicKey, effectiveInterface).catch(() => {});
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
    const { data: router } = await supabase
      .from("routers")
      .select("*")
      .eq("id", peer.router_id)
      .single();
    if (!router) throw new Error("Server not found for peer");
    const client = buildLinuxClient(router as Router, peer.wg_interface);
    const added = await client.addPeer(peer.peer_public_key, peer.allowed_address, peer.wg_interface);
    if (!added) throw new Error("Failed to re-enable peer in WireGuard");
    if (peer.linux_peer_id) {
      await supabase.from("linux_peers").update({ disabled: false }).eq("id", peer.linux_peer_id);
    }
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
    const client = buildLinuxClient(router as Router, peer.wg_interface);
    await client.removePeer(peer.peer_public_key, peer.wg_interface).catch((err) => {
      console.warn("[TgStore] removePeer failed (continuing):", err instanceof Error ? err.message : err);
    });
  }

  await supabase.from("tg_customer_peers").update({ status }).eq("id", peer.id);
  if (peer.linux_peer_id) {
    await supabase.from("linux_peers").update({ disabled: true }).eq("id", peer.linux_peer_id);
  }
}

/** Estado en vivo de un peer vía SSH (handshake + tráfico). */
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

  const client = buildLinuxClient(router as Router, peer.wg_interface);
  const peers = await client.getPeersForInterface(peer.wg_interface);
  const live = peers.find((p) => p.publicKey === peer.peer_public_key);
  if (!live) return { connected: false, latestHandshake: null, rx: 0, tx: 0 };

  // handshake en los últimos 3 minutos = conectado
  const handshakeEpoch = Number.parseInt(live.latestHandshake || "0", 10);
  const connected = handshakeEpoch > 0 && Date.now() / 1000 - handshakeEpoch < 180;
  return {
    connected,
    latestHandshake: handshakeEpoch > 0 ? new Date(handshakeEpoch * 1000).toISOString() : null,
    rx: live.transfer?.rx || 0,
    tx: live.transfer?.tx || 0,
  };
}
