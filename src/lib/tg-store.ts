import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { LinuxWireGuardClient } from "@/lib/linux-wireguard";
import { MikroTikClient } from "@/lib/mikrotik";
import { mirrorTgExpiryToDashboard, movePeerTimerToNewKey } from "@/lib/peer-expiry";
import { cachedRouterRead } from "@/lib/router-read-cache";
import { buildEndpointResolver } from "@/lib/endpoint-domain";
import { generateKeyPair } from "@/lib/wireguard-keys";
import type { AuthMethod, PublicIP, Router, WireGuardPeer } from "@/lib/types";

/**
 * Telegram store: tipos + provisioning de peers para customers.
 * Todo corre server-side con el SERVICE ROLE (bypass RLS).
 * Soporta routers `linux-ssh` (add/remove por SSH) y MikroTik
 * (create + enable/disable nativo por API/REST).
 */

export type TgCustomerType = "client" | "agent";

export interface TgCustomer {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  language_code: string | null;
  is_banned: boolean;
  // 'client' ve la tienda completa; 'agent' solo ve sus peers (sin precios)
  customer_type: TgCustomerType;
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
  // v20: true = aprovisiona solo en IPs sale_dedicated (1 customer por IP)
  is_dedicated_ip: boolean;
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
  // v20: nombre que ve/edita el customer ("Peer 1"...). El admin ve peer_name.
  display_name: string | null;
  peer_public_key: string;
  peer_private_key: string | null;
  allowed_address: string;
  wg_interface: string;
  public_ip: string;
  // v29: host white-label del Endpoint (<slug>.<dominio>). NULL = usar public_ip
  endpoint_host: string | null;
  server_public_key: string;
  listen_port: number;
  dns: string;
  status: TgPeerStatus;
  // NULL = sin timer (peer asignado sin expiración): la app no muestra fecha
  expires_at: string | null;
  created_at: string;
  // v19: precio de renovación propio (peers asignados). NULL = usa planes del store
  renewal_price_usd: number | null;
  renewal_duration_days: number | null;
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

export async function findMikroTikPeerByPublicKey(
  client: MikroTikClient,
  publicKey: string
): Promise<WireGuardPeer | null> {
  const peers = await client.getWireGuardPeers();
  return peers.find((p) => p["public-key"] === publicKey) || null;
}

/** MikroTik REST devuelve disabled como string "true"/"false"; el API clásico como boolean. */
export function isMikroTikDisabled(value: unknown): boolean {
  return value === true || String(value) === "true";
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
Endpoint = ${peer.endpoint_host || peer.public_ip}:${peer.listen_port}
PersistentKeepalive = 25`;
}

/**
 * White-label host for a store peer (v29). Resolved when the peer is created,
 * assigned or re-keyed, so the Mini App can build the config without touching
 * the server. Falls back to the public IP when the tenant has no domain.
 */
export async function resolveTgEndpointHost(
  supabase: SupabaseClient,
  routerId: string,
  creatorUserId?: string | null
): Promise<string | null> {
  const { data: router } = await supabase
    .from("routers")
    .select("name, endpoint_slug, endpoint_domain")
    .eq("id", routerId)
    .single();
  if (!router) return null;
  const resolve = await buildEndpointResolver(supabase, router);
  return resolve(creatorUserId);
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

  // Auto: SOLO IPs marcadas "for sale" por el admin (v17). v20: los planes
  // dedicated usan solo IPs sale_dedicated (1 customer por IP); los planes
  // normales usan solo las shared y se elige la menos cargada.
  const dedicated = Boolean(plan.is_dedicated_ip);
  const { data, error } = await supabase
    .from("public_ips")
    .select("*")
    .eq("router_id", plan.router_id)
    .eq("enabled", true)
    .eq("for_sale", true)
    .eq("sale_dedicated", dedicated)
    .order("ip_number", { ascending: true });
  if (error || !data?.length) {
    throw new Error(
      dedicated
        ? "No dedicated IPs available on this server — mark some as Dedicated in Admin → Telegram → IPs for Sale"
        : "No public IPs marked for sale on this server — mark some in Admin → Telegram → IPs for Sale"
    );
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

  if (dedicated) {
    // Una IP dedicada se vende a UN solo customer: solo IPs sin peers activos
    const free = (data as PublicIP[]).find((ip) => !load.get(ip.public_ip));
    if (!free) throw new Error("All dedicated IPs are taken — contact support");
    return free;
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

/** Siguiente "Peer N" para el customer (nombre que ve el cliente). */
export async function nextDisplayName(supabase: SupabaseClient, customerId: string): Promise<string> {
  const { count } = await supabase
    .from("tg_customer_peers")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  return `Peer ${(count || 0) + 1}`;
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

  const displayName = await nextDisplayName(supabase, customer.id);

  const { data: tgPeer, error: tgPeerError } = await supabase
    .from("tg_customer_peers")
    .insert({
      customer_id: customer.id,
      plan_id: plan.id,
      router_id: plan.router_id,
      linux_peer_id: storedLinuxPeerId,
      peer_name: peerName,
      display_name: displayName,
      peer_public_key: keyPair.publicKey,
      peer_private_key: keyPair.privateKey,
      allowed_address: allowedAddress,
      wg_interface: effectiveInterface,
      public_ip: publicIp.public_ip,
      endpoint_host: await resolveTgEndpointHost(supabase, plan.router_id, null),
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

  // Espejo del timer en peer_metadata: sin esto el peer nace sin fila ahí y el
  // dashboard lo lee como "sin timer".
  await mirrorTgExpiryToDashboard(
    supabase,
    { routerId: plan.router_id, publicKey: keyPair.publicKey },
    expiresAt.toISOString(),
    { peerName, peerInterface: effectiveInterface, allowedAddress }
  );

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

  const base = Math.max(Date.now(), peer.expires_at ? new Date(peer.expires_at).getTime() : 0);
  const newExpiry = new Date(base + durationDays * 24 * 60 * 60 * 1000);

  // SIEMPRE se re-asegura en el servidor, sin mirar el status guardado.
  // Antes era `if (peer.status !== "active")`, y con un status congelado en
  // "active" (pasa cuando nadie abre la Mini App) el extend movía la fecha y
  // NUNCA volvía a poner el peer en WireGuard: el cliente pagaba y se quedaba
  // sin servicio. `wg set` es idempotente, así que re-agregar uno vivo no hace
  // nada. Si el peer ya estaba activo y el servidor no responde, no se aborta la
  // renovación (la fecha vale igual y el cobro no se puede perder); si estaba
  // caído sí se propaga, para que Cryptomus reintente.
  try {
    await reactivateCustomerPeerOnServer(supabase, peer);
  } catch (err) {
    if (peer.status !== "active") throw err;
    console.warn(
      `[TgStore] renew: no se pudo re-asegurar ${peer.peer_name} en el server (seguía activo):`,
      err instanceof Error ? err.message : err
    );
  }

  const { data: updated, error } = await supabase
    .from("tg_customer_peers")
    .update({ status: "active", expires_at: newExpiry.toISOString() })
    .eq("id", peer.id)
    .select()
    .single();
  if (error || !updated) throw new Error(`Failed to renew peer: ${error?.message}`);

  // El timer es uno solo: bajar la fecha nueva al dashboard. Sin esto,
  // peer_metadata.expires_at queda vencido y su auto-disable vuelve a apagar el
  // peer al minuto (pasa con el extend del admin, Cryptomus y el checkout free).
  await mirrorTgExpiryToDashboard(
    supabase,
    { routerId: peer.router_id, publicKey: peer.peer_public_key },
    newExpiry.toISOString(),
    { peerName: peer.peer_name, peerInterface: peer.wg_interface, allowedAddress: peer.allowed_address }
  );

  return updated as TgCustomerPeer;
}

/**
 * Fija la expiración a una fecha EXACTA (o la saca con null) y deja el servidor
 * coherente con esa fecha.
 *
 * `renewCustomerPeer` solo suma, así que no había forma de corregir a la baja un
 * peer al que se le extendió de más. Acá la fecha se reemplaza:
 *   - futura (o null) -> el peer se re-asegura en WireGuard y queda 'active'
 *   - pasada          -> se saca de WireGuard y queda 'expired'
 */
export async function setCustomerPeerExpiry(params: {
  supabase?: SupabaseClient;
  peer: TgCustomerPeer;
  expiresAt: string | null;
}): Promise<TgCustomerPeer> {
  const supabase = params.supabase || getServiceClient();
  const { peer, expiresAt } = params;

  const isPast = Boolean(expiresAt) && new Date(expiresAt as string).getTime() <= Date.now();

  if (isPast) {
    // deactivateCustomerPeer ya escribe status + espeja linux_peers
    await deactivateCustomerPeer({ supabase, peer, status: "expired" });
  } else {
    try {
      await reactivateCustomerPeerOnServer(supabase, peer);
    } catch (err) {
      // Mismo criterio que renew: si ya estaba activo no se aborta la corrección
      if (peer.status !== "active") throw err;
      console.warn(
        `[TgStore] setExpiry: no se pudo re-asegurar ${peer.peer_name}:`,
        err instanceof Error ? err.message : err
      );
    }
    await supabase.from("tg_customer_peers").update({ status: "active" }).eq("id", peer.id);
  }

  // Una sola fecha: escribe tg_customer_peers Y peer_metadata
  await mirrorTgExpiryToDashboard(
    supabase,
    { routerId: peer.router_id, publicKey: peer.peer_public_key },
    expiresAt,
    { peerName: peer.peer_name, peerInterface: peer.wg_interface, allowedAddress: peer.allowed_address }
  );

  const { data: updated, error } = await supabase
    .from("tg_customer_peers")
    .select("*")
    .eq("id", peer.id)
    .single();
  if (error || !updated) throw new Error(`Failed to read back peer: ${error?.message}`);
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
    await setLinuxPeerDisabled(supabase, peer, false);
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

  // Al rotar se re-emite el config: aprovechamos para resolver el endpoint
  // white-label (el peer pudo crearse antes de que el dueño tuviera dominio).
  const { data: linuxPeer } = peer.linux_peer_id
    ? await supabase.from("linux_peers").select("created_by_user_id").eq("id", peer.linux_peer_id).maybeSingle()
    : { data: null };
  const endpointHost = await resolveTgEndpointHost(supabase, peer.router_id, linuxPeer?.created_by_user_id);

  const { data: updated, error } = await supabase
    .from("tg_customer_peers")
    .update({
      peer_public_key: keyPair.publicKey,
      peer_private_key: keyPair.privateKey,
      endpoint_host: endpointHost,
    })
    .eq("id", peer.id)
    .select()
    .single();
  if (error || !updated) throw new Error(`Failed to save new keys: ${error?.message}`);

  // El timer vive en peer_metadata indexado por public key: moverlo o el peer
  // queda "sin timer" después de rotar.
  await movePeerTimerToNewKey(supabase, {
    oldKey: peer.peer_public_key,
    newKey: keyPair.publicKey,
  });

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
  await setLinuxPeerDisabled(supabase, peer, true);
}

/**
 * Espeja el estado en `linux_peers`, que es lo que lee el dashboard.
 *
 * Antes esto se hacía solo `if (peer.linux_peer_id)`. Con ese campo en null
 * (peers asignados a mano, o filas creadas antes de que existiera el link) la
 * bandera no se tocaba nunca: el peer quedaba vivo en el servidor pero el
 * dashboard lo mostraba Disabled. Se cae de vuelta a router_id + public key.
 */
async function setLinuxPeerDisabled(
  supabase: SupabaseClient,
  peer: TgCustomerPeer,
  disabled: boolean
): Promise<void> {
  const query = supabase.from("linux_peers").update({ disabled });
  const { error } = peer.linux_peer_id
    ? await query.eq("id", peer.linux_peer_id)
    : await query.eq("router_id", peer.router_id).eq("public_key", peer.peer_public_key);
  if (error) {
    console.warn("[TgStore] linux_peers mirror failed (continuing):", error.message);
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

export interface LivePeerStatus {
  connected: boolean;
  latestHandshake: string | null;
  rx: number;
  tx: number;
}

/**
 * Estados en vivo para VARIOS peers de un customer, agrupando por router para
 * hacer una sola consulta por interface (Linux) o por router (MikroTik).
 * Además SINCRONIZA el status guardado con la realidad del servidor (si el
 * admin lo deshabilitó/habilitó desde el dashboard, la app lo refleja).
 * Los routers que fallen se omiten (sin live ni sync para sus peers).
 */
export async function getLiveStatusesForPeers(
  supabase: SupabaseClient,
  peers: TgCustomerPeer[]
): Promise<{
  live: Map<string, LivePeerStatus>;
  statusChanges: Map<string, TgPeerStatus>;
}> {
  const live = new Map<string, LivePeerStatus>();
  const statusChanges = new Map<string, TgPeerStatus>();

  const byRouter = new Map<string, TgCustomerPeer[]>();
  for (const p of peers) {
    const list = byRouter.get(p.router_id) || [];
    list.push(p);
    byRouter.set(p.router_id, list);
  }
  if (!byRouter.size) return { live, statusChanges };

  const { data: routers } = await supabase
    .from("routers")
    .select("*")
    .in("id", Array.from(byRouter.keys()));

  const now = Date.now();

  // status guardado vs. realidad del router (enabled = presente y habilitado).
  // Sin expires_at = sin timer (nunca expira). Si está apagado en el server y
  // su fecha ya pasó, se muestra "expired" (no "disabled").
  const sync = (p: TgCustomerPeer, enabledOnServer: boolean) => {
    const isPastExpiry = Boolean(p.expires_at) && new Date(p.expires_at as string).getTime() <= now;
    if (p.status === "active" && !enabledOnServer) {
      statusChanges.set(p.id, isPastExpiry ? "expired" : "disabled");
    } else if (p.status === "disabled" && enabledOnServer) {
      statusChanges.set(p.id, "active");
    } else if (p.status === "disabled" && !enabledOnServer && isPastExpiry) {
      statusChanges.set(p.id, "expired");
    } else if (p.status === "expired" && enabledOnServer && !isPastExpiry) {
      statusChanges.set(p.id, "active");
    }
  };

  for (const router of routers || []) {
    const routerPeers = byRouter.get(router.id) || [];
    try {
      if (router.connection_type === "linux-ssh") {
        const interfaces = Array.from(new Set(routerPeers.map((p) => p.wg_interface)));
        for (const iface of interfaces) {
          const client = buildLinuxClient(router as Router, iface);
          // Cache corto compartido con /api/wireguard (misma key): una sola
          // consulta SSH por ventana de TTL sirve a todos los que pollean; si
          // el server no responde, se usa el último dump conocido (stale) —
          // los handshakes son epoch, así que "connected" envejece solo.
          const read = await cachedRouterRead(`linux-peers:${router.id}:${iface}`, () =>
            client.getPeersForInterface(iface)
          );
          const byKey = new Map(read.data.map((lp) => [lp.publicKey, lp]));
          for (const p of routerPeers.filter((x) => x.wg_interface === iface)) {
            const lp = byKey.get(p.peer_public_key);
            // No sincronizar status desde datos stale ni desde un dump vacío
            // (un [] con el server caído marcaría todos los peers disabled)
            if (!read.stale && read.data.length > 0) sync(p, Boolean(lp)); // en Linux, presente en wg = habilitado
            if (!lp) {
              live.set(p.id, { connected: false, latestHandshake: null, rx: 0, tx: 0 });
              continue;
            }
            const handshakeEpoch = Number.parseInt(lp.latestHandshake || "0", 10);
            live.set(p.id, {
              connected: handshakeEpoch > 0 && now / 1000 - handshakeEpoch < 180,
              latestHandshake: handshakeEpoch > 0 ? new Date(handshakeEpoch * 1000).toISOString() : null,
              rx: lp.transfer?.rx || 0,
              tx: lp.transfer?.tx || 0,
            });
          }
        }
      } else {
        const client = buildMikroTikClient(router as Router);
        // Cache corto compartido con /api/wireguard (misma key). MikroTik
        // reporta el handshake como duración relativa al momento del dump, así
        // que se le suma la edad del cache — con datos stale el peer pasa a
        // Offline cuando su último handshake real supera la ventana de 3 min.
        const read = await cachedRouterRead(`mt-peers:${router.id}`, () => client.getWireGuardPeers());
        const elapsedSec = Math.max(0, Math.round((now - read.fetchedAt) / 1000));
        const byKey = new Map(read.data.map((lp) => [lp["public-key"], lp]));
        for (const p of routerPeers) {
          const rp = byKey.get(p.peer_public_key);
          const enabled = Boolean(rp) && !isMikroTikDisabled(rp?.disabled);
          // No sincronizar status desde datos stale ni desde un dump vacío
          // (mismo cinturón que la rama Linux: un [] "exitoso" marcaría disabled
          // a todos los peers TG de este router)
          if (!read.stale && read.data.length > 0) sync(p, enabled);
          if (!rp || !enabled) {
            live.set(p.id, { connected: false, latestHandshake: null, rx: 0, tx: 0 });
            continue;
          }
          const parsed = parseMikroTikDuration(rp["last-handshake"]);
          const secondsAgo = parsed !== null ? parsed + elapsedSec : null;
          live.set(p.id, {
            connected: secondsAgo !== null && secondsAgo < 180,
            latestHandshake: secondsAgo !== null ? new Date(now - secondsAgo * 1000).toISOString() : null,
            rx: Number(rp.rx) || 0,
            tx: Number(rp.tx) || 0,
          });
        }
      }
    } catch (err) {
      console.warn(`[TgStore] live status failed for router ${router.id}:`, err instanceof Error ? err.message : err);
    }
  }

  // Persistir las correcciones de status (agrupadas por valor)
  for (const status of ["active", "disabled", "expired"] as TgPeerStatus[]) {
    const ids = Array.from(statusChanges.entries())
      .filter(([, s]) => s === status)
      .map(([id]) => id);
    if (ids.length) {
      await supabase.from("tg_customer_peers").update({ status }).in("id", ids);
    }
  }

  return { live, statusChanges };
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
  if (!live || isMikroTikDisabled(live.disabled)) return { connected: false, latestHandshake: null, rx: 0, tx: 0 };

  const secondsAgo = parseMikroTikDuration(live["last-handshake"]);
  const connected = secondsAgo !== null && secondsAgo < 180;
  return {
    connected,
    latestHandshake: secondsAgo !== null ? new Date(Date.now() - secondsAgo * 1000).toISOString() : null,
    rx: Number(live.rx) || 0,
    tx: Number(live.tx) || 0,
  };
}
