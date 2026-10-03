import type { SupabaseClient } from "@supabase/supabase-js";
import { promises as dns } from "node:dns";
import type { AuthMethod, Router, WireGuardPeer } from "@/lib/types";
import { publicKeyFromPrivate } from "@/lib/wireguard-keys";
import { logActivity } from "@/lib/activity-logger";
import { buildEndpointResolver } from "@/lib/endpoint-domain";
import { LinuxWireGuardClient } from "@/lib/linux-wireguard";
import { cachedRouterRead } from "@/lib/router-read-cache";

/**
 * StarHome (StarVPN) — provider API client + the mapping of its slots onto the
 * panel's own concepts.
 *
 * A StarVPN account is a row in `routers` with connection_type "starhome" (so it
 * shows up in the Dashboard's server selector) plus a `starhome_accounts` row
 * with the credentials and the account status. Each slot is a `starhome_slots`
 * row presented as a WireGuard peer in the Dashboard. (The SOCKS5 side was
 * dropped on purpose: StarVPN proxies authenticate by allowed IP, 5–10 max.)
 *
 * API (reverse-engineered from the "API Information" page of the StarVPN
 * dashboard, 2026-09-30): every call is a POST to the same URL with the same
 * envelope and the function is chosen with `command`. The token belongs to the
 * ACCOUNT, not to a slot: the dashboard builds the exact same body for slots
 * 1, 2 and 3. `refresh_data` returns the whole account: package / status /
 * next_due_date / total_slots, one entry per slot in `ip_types` (country,
 * region, isp, VPN user+pass, WireGuard keys) and the IP rotations left per
 * slot in `remaining_ip_updates`. It does NOT return the slot's current public
 * IP, and the SOCKS5 proxy can't be reached from an unlisted IP, so the panel
 * never shows the live IP.
 */

const STARHOME_API_URL = "https://api.starhome.io/v1/";

export const STARHOME_PROXY_HOST = "proxy.starzone.io";
/** Slot N is proxy.starzone.io:(BASE + N). Seen on slots 1–3; assumed for the rest. */
export const STARHOME_PROXY_PORT_BASE = 51312;

/**
 * WireGuard: every slot connects to the same ingress. Taken from a config
 * downloaded from the StarVPN member area (2026-10-02), identical for every slot
 * except PrivateKey/Address:
 *   [Interface] Address = <wg_ipv4>/32 + <wg_ipv6>/128, DNS = 1.1.1.1,1.0.0.1, MTU = 1384
 *   [Peer] PublicKey = <below>, Endpoint = wg.starzone.io:1276, AllowedIPs = 0.0.0.0/0, ::/0,
 *          PersistentKeepalive = 25, no preshared key
 * The slot's own PrivateKey/Address come from refresh_data (wg_private_key, wg_ipv4/6).
 */
export const STARHOME_WG_ENDPOINT = "wg.starzone.io";
export const STARHOME_WG_PORT = 1276;
export const STARHOME_WG_SERVER_PUBLIC_KEY: string | null = "NsyFeiW4z67A5FEEX/FnFM5dCwwp+WwfbHwD7Q/h2go=";
export const STARHOME_WG_MTU = 1384;
/**
 * Interface name the Dashboard shows for these peers (generateConfig looks the
 * server key up by it). Neutral on purpose: tenants don't want the provider
 * visible to their users.
 */
export const STARHOME_WG_INTERFACE = "wg0";

/**
 * Relay (v35): with a relay server set on the account, the client's Endpoint is
 * OUR server at (BASE + slot number) and that server DNATs the UDP to
 * wg.starzone.io:1276. That is what makes enable/disable possible without
 * touching the slot's keys: disable = drop the DNAT rule.
 */
export const STARHOME_RELAY_PORT_BASE = 42000;
export const relayPortForSlot = (slotNumber: number) => STARHOME_RELAY_PORT_BASE + slotNumber;

// ---------------------------------------------------------------------------
// Provider API
// ---------------------------------------------------------------------------

export interface StarhomeCredentials {
  email: string;
  auth_token: string;
}

export interface StarhomeSlotData {
  slot_number: number;
  port: number;
  ip_type: string | null;
  country: string | null;
  region: string | null;
  isp: string | null;
  vpn_username: string | null;
  vpn_password: string | null;
  remaining_updates: number | null;
  raw: Record<string, unknown>;
}

export interface StarhomeAccountData {
  package: string | null;
  status: string | null;
  next_due_date: string | null;
  total_slots: number | null;
  slots: StarhomeSlotData[];
}

/** Errors coming from StarHome itself (bad token, provider down…) → HTTP 502 in the routes. */
export class StarhomeError extends Error {}

 
async function starhomeRequest(creds: StarhomeCredentials, command: string, extra: Record<string, unknown> = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(STARHOME_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_type: "web",
        device_id: "starvpn-dashboard",
        app_version: "1.0.0",
        email: creds.email,
        auth_token: creds.auth_token,
        custom: 1,
        command,
        ...extra,
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new StarhomeError(`Couldn't reach StarHome: ${(e as Error).message}`);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new StarhomeError(`StarHome returned a non-JSON response (HTTP ${res.status})`);
  }
  // An invalid token comes back as HTTP 200 {"result":"error","message":"Authorization failed"}
  if (!res.ok || json?.result !== "success") {
    const msg = json?.message || json?.error || json?.data?.message;
    throw new StarhomeError(msg ? String(msg) : `StarHome rejected the request (${json?.result || `HTTP ${res.status}`})`);
  }
  return json;
}

/** `refresh_data` — the whole account, one entry per slot. Also validates the credentials. */
export async function fetchAccountData(creds: StarhomeCredentials): Promise<StarhomeAccountData> {
  const json = await starhomeRequest(creds, "refresh_data");
  const data = json.data || {};

  // remaining_ip_updates: [{ port, limits: { "Static Residential": 20, "Static Datacenter": 500 } }]
   
  const limitsBySlot = new Map<number, Record<string, any>>();
  for (const u of data.remaining_ip_updates || []) {
    const n = Number(u?.port);
    if (Number.isFinite(n)) limitsBySlot.set(n, u.limits || {});
  }

  const slots: StarhomeSlotData[] = [];
  for (const s of data.ip_types || []) {
    const n = Number(s?.port);
    if (!Number.isFinite(n)) continue;
    // Pick the quota that matches the slot type ("Static Residential IP" → "Static Residential")
    const limits = limitsBySlot.get(n) || {};
    const ipType = s.ip_type ? String(s.ip_type) : null;
    const key = Object.keys(limits).find((k) => ipType?.startsWith(k)) ?? Object.keys(limits)[0];
    const remaining = key != null && limits[key] != null ? Number(limits[key]) : null;

    slots.push({
      slot_number: n,
      port: STARHOME_PROXY_PORT_BASE + n,
      ip_type: ipType,
      country: s.country ? String(s.country) : null,
      region: s.region ? String(s.region) : null,
      isp: s.isp ? String(s.isp) : null,
      vpn_username: s.vpnusername ? String(s.vpnusername) : null,
      vpn_password: s.vpnpassword ? String(s.vpnpassword) : null,
      remaining_updates: Number.isFinite(remaining as number) ? remaining : null,
      raw: s,
    });
  }
  slots.sort((a, b) => a.slot_number - b.slot_number);

  return {
    package: data.package ? String(data.package) : null,
    status: data.status ? String(data.status) : null,
    next_due_date: data.next_due_date ? String(data.next_due_date) : null,
    total_slots: data.total_slots != null && Number.isFinite(Number(data.total_slots)) ? Number(data.total_slots) : slots.length,
    slots,
  };
}

/**
 * "Update IP Now" — asks StarHome for a fresh IP on one slot.
 * TODO: the dashboard's generated command for this function hasn't been
 * captured yet, so the command name and the slot field are unknown. Fill
 * ROTATE_COMMAND / ROTATE_SLOT_FIELD in and the route + UI already work.
 */
const ROTATE_COMMAND: string | null = null;
const ROTATE_SLOT_FIELD = "port";

export async function rotateSlotIp(creds: StarhomeCredentials, slotNumber: number): Promise<void> {
  if (!ROTATE_COMMAND) {
    throw new StarhomeError("IP rotation isn't wired to StarHome yet");
  }
  await starhomeRequest(creds, ROTATE_COMMAND, { [ROTATE_SLOT_FIELD]: slotNumber });
}

// ---------------------------------------------------------------------------
// Database rows
// ---------------------------------------------------------------------------

export interface StarhomeAccountRow extends StarhomeCredentials {
  id: string;
  router_id: string;
  owner_user_id: string;
  label: string;
  proxy_host: string;
  package: string | null;
  status: string | null;
  next_due_date: string | null;
  total_slots: number | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  /** Override of STARHOME_WG_SERVER_PUBLIC_KEY, for the day the provider rotates its key. */
  wg_server_public_key: string | null;
  /** v35: our linux-ssh server that relays the slots' WireGuard (null = clients go direct, no on/off). */
  relay_router_id: string | null;
  /** The wg.starzone.io address the DNAT rules currently point at. */
  relay_target_ip: string | null;
  created_at: string;
}

export interface StarhomeSlotRow {
  id: string;
  account_id: string;
  slot_number: number;
  port: number;
  ip_type: string | null;
  country: string | null;
  region: string | null;
  isp: string | null;
  vpn_username: string | null;
  vpn_password: string | null;
  remaining_updates: number | null;
  raw: Record<string, unknown> | null;
  name: string | null;
  assigned_user_id: string | null;
  assigned_at: string | null;
  expires_at: string | null;
  last_rotated_at: string | null;
  /** v35: relay switched off for this slot (only meaningful with a relay server). */
  disabled: boolean;
}

export const ACCOUNT_COLS = "id, router_id, owner_user_id, label, email, auth_token, proxy_host, package, status, next_due_date, total_slots, last_synced_at, last_sync_error, wg_server_public_key, relay_router_id, relay_target_ip, created_at";
export const SLOT_COLS = "id, account_id, slot_number, port, ip_type, country, region, isp, vpn_username, vpn_password, remaining_updates, raw, name, assigned_user_id, assigned_at, expires_at, last_rotated_at, disabled";

export interface Viewer {
  userId: string;
  isAdmin: boolean;
}

export function canManageAccount(account: StarhomeAccountRow, viewer: Viewer): boolean {
  return viewer.isAdmin || account.owner_user_id === viewer.userId;
}

export async function accountForRouter(admin: SupabaseClient, routerId: string): Promise<StarhomeAccountRow | null> {
  const { data } = await admin.from("starhome_accounts").select(ACCOUNT_COLS).eq("router_id", routerId).maybeSingle();
  return (data as StarhomeAccountRow | null) || null;
}

/**
 * Writes what refresh_data returned into starhome_accounts / starhome_slots.
 * The slot upsert only carries provider columns, so assignments and timers
 * survive every sync.
 */
export async function storeAccountData(admin: SupabaseClient, accountId: string, data: StarhomeAccountData): Promise<void> {
  const now = new Date().toISOString();

  if (data.slots.length > 0) {
    const rows = data.slots.map((s) => ({ ...s, account_id: accountId, updated_at: now }));
    const { error } = await admin.from("starhome_slots").upsert(rows, { onConflict: "account_id,slot_number" });
    if (error) throw new Error(error.message);
  }

  const { error } = await admin
    .from("starhome_accounts")
    .update({
      package: data.package,
      status: data.status,
      next_due_date: data.next_due_date,
      total_slots: data.total_slots,
      last_synced_at: now,
      last_sync_error: null,
    })
    .eq("id", accountId);
  if (error) throw new Error(error.message);
}

/** Fetch + store. A failure is recorded in last_sync_error and re-thrown; the old rows stay. */
export async function syncAccount(
  admin: SupabaseClient,
  account: { id: string } & StarhomeCredentials
): Promise<StarhomeAccountData> {
  try {
    const data = await fetchAccountData(account);
    await storeAccountData(admin, account.id, data);
    return data;
  } catch (e) {
    await admin
      .from("starhome_accounts")
      .update({ last_sync_error: (e as Error).message })
      .eq("id", account.id);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Who sees which slots
// ---------------------------------------------------------------------------

/**
 * The account owner and admins see every slot; anyone else only the slots
 * assigned to them. Expired assignments are dropped first (timers are enforced
 * lazily: there is no cron for StarVPN slots).
 */
export async function visibleSlots(
  admin: SupabaseClient,
  account: StarhomeAccountRow,
  viewer: Viewer
): Promise<{ slots: StarhomeSlotRow[]; emails: Map<string, string> }> {
  await expireSlotAssignments(admin);

  let q = admin.from("starhome_slots").select(SLOT_COLS).eq("account_id", account.id).order("slot_number");
  if (!canManageAccount(account, viewer)) q = q.eq("assigned_user_id", viewer.userId);
  const slots = ((await q).data || []) as StarhomeSlotRow[];

  const ids = new Set<string>([account.owner_user_id]);
  for (const s of slots) if (s.assigned_user_id) ids.add(s.assigned_user_id);
  const emails = new Map<string, string>();
  const { data: profiles } = await admin.from("profiles").select("id, email").in("id", [...ids]);
  for (const p of profiles || []) emails.set(p.id, p.email);

  return { slots, emails };
}

/** "US-fl6 · comcast" — what the panel shows where a public IP would normally go. */
export function slotLocation(slot: Pick<StarhomeSlotRow, "country" | "region" | "isp">): string {
  const place = [slot.country?.toUpperCase(), slot.region].filter(Boolean).join("-");
  return [place, slot.isp].filter(Boolean).join(" · ");
}

export interface RelayStats {
  rx: number;
  tx: number;
  lastSeen: number | null;
}

/**
 * Dashboard view: a slot as a WireGuard peer. `endpointHost` = the tenant's
 * white-label name, `relayHost` = the relay server when the account has one
 * (then the port is the slot's relay port and the stats come from that server).
 */
export function slotAsPeer(
  slot: StarhomeSlotRow,
  account: StarhomeAccountRow,
  emails: Map<string, string>,
  endpointHost: string | null,
  relay?: { host: string; stats?: RelayStats } | null
): WireGuardPeer {
  const privateKey = typeof slot.raw?.wg_private_key === "string" ? (slot.raw.wg_private_key as string) : null;
  const wgIpv4 = typeof slot.raw?.wg_ipv4 === "string" ? (slot.raw.wg_ipv4 as string) : null;
  const wgIpv6 = typeof slot.raw?.wg_ipv6 === "string" ? (slot.raw.wg_ipv6 as string) : null;
  // Both addresses, as StarVPN's own config has them; the dashboard emits one Address line each
  const addresses = [wgIpv4 ? `${wgIpv4}/32` : null, wgIpv6 ? `${wgIpv6}/128` : null].filter(Boolean).join(",");
  const who = slot.assigned_user_id || account.owner_user_id;
  return {
    ".id": `*sh:${slot.id}`,
    // The slot number is fixed and shown in its own column; name is the tenant's internal label
    name: slot.name || "",
    slot_number: slot.slot_number,
    interface: STARHOME_WG_INTERFACE,
    "public-key": (privateKey && publicKeyFromPrivate(privateKey)) || `starhome:${slot.id}`,
    "private-key": privateKey || undefined,
    "allowed-address": addresses,
    // comment is the public IP column; StarVPN doesn't report the slot's IP
    comment: "",
    location: slotLocation(slot),
    // Without a relay nothing can switch the slot off, so it is always "enabled"
    disabled: relay ? slot.disabled : false,
    "endpoint-port": relay ? relayPortForSlot(slot.slot_number) : STARHOME_WG_PORT,
    ...(relay?.stats
      ? {
          rx: relay.stats.rx,
          tx: relay.stats.tx,
          "last-handshake": relay.stats.lastSeen ? String(relay.stats.lastSeen) : "0",
        }
      : {}),
    created_by_email: emails.get(who) || null,
    created_by_user_id: who,
    created_at: slot.assigned_at || account.created_at,
    endpoint_host: endpointHost || (relay ? relay.host : STARHOME_WG_ENDPOINT),
    expires_at: slot.expires_at,
  };
}

/** Slots of an account keyed by the public key the Dashboard shows for them (derived from wg_private_key). */
export async function starhomeSlotsByPublicKey(admin: SupabaseClient, accountId: string): Promise<Map<string, StarhomeSlotRow>> {
  const { data } = await admin.from("starhome_slots").select(SLOT_COLS).eq("account_id", accountId);
  const byKey = new Map<string, StarhomeSlotRow>();
  for (const s of (data || []) as StarhomeSlotRow[]) {
    const privateKey = typeof s.raw?.wg_private_key === "string" ? (s.raw.wg_private_key as string) : null;
    byKey.set((privateKey && publicKeyFromPrivate(privateKey)) || `starhome:${s.id}`, s);
  }
  return byKey;
}

/**
 * The Dashboard polls every ~3 s; the provider is re-read at most once a minute
 * per account (or on Force Refresh). Changes made on StarVPN's site — a new
 * region, or a username change that REGENERATES the slot's WireGuard key — show
 * up within that minute instead of waiting for someone to open Profile.
 */
const PEERS_SYNC_TTL_MS = 60_000;
const syncInFlight = new Map<string, Promise<void>>();

async function syncIfStale(admin: SupabaseClient, account: StarhomeAccountRow, force: boolean): Promise<void> {
  const age = account.last_synced_at ? Date.now() - new Date(account.last_synced_at).getTime() : Infinity;
  if (!force && age < PEERS_SYNC_TTL_MS) return;
  let p = syncInFlight.get(account.id);
  if (!p) {
    p = syncAccount(admin, account)
      .then(() => undefined)
      .catch((e) => console.error(`[starhome] sync of ${account.label} failed:`, (e as Error).message))
      .finally(() => syncInFlight.delete(account.id));
    syncInFlight.set(account.id, p);
  }
  await p;
}

export async function starhomePeersForRouter(
  admin: SupabaseClient,
  routerId: string,
  viewer: Viewer,
  opts?: { forceSync?: boolean }
): Promise<WireGuardPeer[]> {
  const account = await accountForRouter(admin, routerId);
  if (!account) return [];
  await syncIfStale(admin, account, Boolean(opts?.forceSync));
  const { slots, emails } = await visibleSlots(admin, account, viewer);

  // White-label (v26): <slug>.<tenant domain>, which the tenant points at
  // wg.starzone.io with a CNAME. No domain → the provider host itself.
  const { data: router } = await admin
    .from("routers")
    .select("id, name, endpoint_slug, endpoint_domain")
    .eq("id", routerId)
    .maybeSingle();
  const resolveEndpoint = await buildEndpointResolver(admin, router || {});

  // Relay: the peers point at our server and its counters/conntrack give traffic + presence
  let relay: { host: string; stats: Map<number, RelayStats> } | null = null;
  const relayRouter = await relayRouterFor(admin, account);
  if (relayRouter) {
    const ports = slots.map((s) => relayPortForSlot(s.slot_number));
    const read = await cachedRouterRead(`starhome-relay:${relayRouter.id}`, () =>
      relayClient(relayRouter).getUdpRelayStats(ports)
    ).catch(() => null);
    relay = { host: relayRouter.endpoint_ip || relayRouter.host, stats: read?.data || new Map() };
  }

  return slots.map((s) =>
    slotAsPeer(
      s,
      account,
      emails,
      resolveEndpoint(s.assigned_user_id || account.owner_user_id),
      relay ? { host: relay.host, stats: relay.stats.get(relayPortForSlot(s.slot_number)) } : null
    )
  );
}

// ---------------------------------------------------------------------------
// Relay server (v35)
// ---------------------------------------------------------------------------

export function relayClient(router: Router): LinuxWireGuardClient {
  return new LinuxWireGuardClient({
    host: router.host,
    port: router.ssh_port || 22,
    username: router.username,
    password: router.password,
    privateKey: router.ssh_key || undefined,
    authMethod: (router.ssh_auth_method as AuthMethod) || "password",
    wgInterface: router.wg_interface || "wg0",
    outInterface: router.out_interface || "ens192",
  });
}

export async function relayRouterFor(admin: SupabaseClient, account: StarhomeAccountRow): Promise<Router | null> {
  if (!account.relay_router_id) return null;
  const { data } = await admin.from("routers").select("*").eq("id", account.relay_router_id).maybeSingle();
  return (data as Router | null) || null;
}

/** Current addresses of the provider's WireGuard ingress (a CNAME to a pool of ~16 IPs, TTL 300). */
export async function resolveIngressIps(): Promise<string[]> {
  const ips = await dns.resolve4(STARHOME_WG_ENDPOINT);
  if (!ips.length) throw new StarhomeError(`${STARHOME_WG_ENDPOINT} did not resolve`);
  return ips.sort();
}

/**
 * (Re)writes the DNAT rules of every slot on the relay server: enabled slots get
 * their rule, disabled ones get it removed. Also picks a fresh ingress IP when
 * the stored one dropped out of DNS.
 */
export async function applyRelay(admin: SupabaseClient, account: StarhomeAccountRow): Promise<{ target: string; slots: number }> {
  const router = await relayRouterFor(admin, account);
  if (!router) throw new StarhomeError("This account has no relay server");

  const ips = await resolveIngressIps();
  const target = account.relay_target_ip && ips.includes(account.relay_target_ip) ? account.relay_target_ip : ips[0];
  if (target !== account.relay_target_ip) {
    await admin.from("starhome_accounts").update({ relay_target_ip: target }).eq("id", account.id);
  }

  const { data: slots } = await admin.from("starhome_slots").select("slot_number, disabled").eq("account_id", account.id);
  const client = relayClient(router);
  for (const s of (slots || []) as Array<{ slot_number: number; disabled: boolean }>) {
    const port = relayPortForSlot(s.slot_number);
    if (s.disabled) await client.removeUdpRelay(port, { persist: false });
    else await client.setUdpRelay(port, target, STARHOME_WG_PORT, { persist: false });
  }
  await client.persistIptables();
  return { target, slots: slots?.length || 0 };
}

/** Removes every rule this account put on its relay server (relay switched off or moved). */
export async function clearRelay(admin: SupabaseClient, account: StarhomeAccountRow): Promise<void> {
  const router = await relayRouterFor(admin, account);
  if (!router) return;
  const { data: slots } = await admin.from("starhome_slots").select("slot_number").eq("account_id", account.id);
  const client = relayClient(router);
  for (const s of (slots || []) as Array<{ slot_number: number }>) {
    await client.removeUdpRelay(relayPortForSlot(s.slot_number), { persist: false });
  }
  await client.persistIptables();
}

/** Switches one slot's relay on or off and records it. Throws when the account has no relay. */
export async function setSlotRelayEnabled(admin: SupabaseClient, account: StarhomeAccountRow, slot: StarhomeSlotRow, enabled: boolean): Promise<void> {
  const router = await relayRouterFor(admin, account);
  if (!router) throw new StarhomeError("Set a relay server for this account in Profile → StarHome accounts to switch slots on and off");
  const client = relayClient(router);
  const port = relayPortForSlot(slot.slot_number);
  if (enabled) {
    const ips = await resolveIngressIps();
    const target = account.relay_target_ip && ips.includes(account.relay_target_ip) ? account.relay_target_ip : ips[0];
    await client.setUdpRelay(port, target, STARHOME_WG_PORT);
  } else {
    await client.removeUdpRelay(port);
  }
  await admin.from("starhome_slots").update({ disabled: !enabled }).eq("id", slot.id);
}

/**
 * Cron hook: when the ingress address an account relays to disappears from DNS,
 * move its rules to one that is still announced. Cheap when nothing changed.
 */
export async function ensureRelayTargets(admin: SupabaseClient): Promise<void> {
  const { data: accounts } = await admin.from("starhome_accounts").select(ACCOUNT_COLS).not("relay_router_id", "is", null);
  if (!accounts?.length) return;
  const ips = await resolveIngressIps().catch(() => null);
  if (!ips) return;
  for (const account of accounts as StarhomeAccountRow[]) {
    if (account.relay_target_ip && ips.includes(account.relay_target_ip)) continue;
    try {
      await applyRelay(admin, account);
    } catch (e) {
      console.error(`[starhome] relay repair failed for ${account.label}:`, (e as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------
// Server access bookkeeping
// ---------------------------------------------------------------------------

/**
 * The Dashboard lists a non-admin's servers from user_routers, so the owner and
 * every assignee need a row there to see the StarVPN server at all.
 */
export async function grantServerAccess(admin: SupabaseClient, routerId: string, userId: string): Promise<void> {
  await admin.from("user_routers").upsert({ user_id: userId, router_id: routerId }, { onConflict: "user_id,router_id", ignoreDuplicates: true });
}

/** Drops the access rows once a user has no slot left on the account (never for the owner). */
export async function revokeServerAccessIfUnused(admin: SupabaseClient, account: StarhomeAccountRow, userId: string | null): Promise<void> {
  if (!userId || userId === account.owner_user_id) return;
  const { count } = await admin
    .from("starhome_slots")
    .select("id", { count: "exact", head: true })
    .eq("account_id", account.id)
    .eq("assigned_user_id", userId);
  if ((count || 0) > 0) return;
  await admin.from("user_routers").delete().eq("user_id", userId).eq("router_id", account.router_id);
}

/**
 * Expired slots: the assignment is dropped and, when the account relays through
 * our server, the relay is switched off (that is the auto-disable). Without a
 * relay the date just stays so the Dashboard shows "Expired" until renewed.
 */
export async function expireSlotAssignments(admin: SupabaseClient): Promise<void> {
  const { data: expired } = await admin
    .from("starhome_slots")
    .select(SLOT_COLS)
    .lt("expires_at", new Date().toISOString())
    .or("assigned_user_id.not.is.null,disabled.eq.false");
  if (!expired?.length) return;

  const accounts = new Map<string, StarhomeAccountRow | null>();
  for (const s of expired as StarhomeSlotRow[]) {
    if (!accounts.has(s.account_id)) {
      const { data } = await admin.from("starhome_accounts").select(ACCOUNT_COLS).eq("id", s.account_id).maybeSingle();
      accounts.set(s.account_id, (data as StarhomeAccountRow | null) || null);
    }
    const account = accounts.get(s.account_id);
    if (!account) continue;

    const changes: Record<string, unknown> = {};
    if (s.assigned_user_id) Object.assign(changes, { assigned_user_id: null, assigned_at: null });
    if (account.relay_router_id && !s.disabled) {
      try {
        await relayClient((await relayRouterFor(admin, account))!).removeUdpRelay(relayPortForSlot(s.slot_number));
        changes.disabled = true;
      } catch (e) {
        console.error(`[starhome] auto-disable of slot ${s.slot_number} failed:`, (e as Error).message);
      }
    }
    if (Object.keys(changes).length === 0) continue;

    await admin.from("starhome_slots").update(changes).eq("id", s.id);
    if (s.assigned_user_id) await revokeServerAccessIfUnused(admin, account, s.assigned_user_id);
    await logActivity({
      supabase: admin,
      userId: null,
      routerId: account.router_id,
      action: "disable",
      entityType: "starhome_slot",
      entityId: s.id,
      entityName: s.name || `Slot ${s.slot_number}`,
      details: { reason: "expired", unassignedUserId: s.assigned_user_id, relayOff: changes.disabled === true },
    });
  }
}
