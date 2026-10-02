import type { SupabaseClient } from "@supabase/supabase-js";
import type { WireGuardPeer } from "@/lib/types";
import { publicKeyFromPrivate } from "@/lib/wireguard-keys";
import { logActivity } from "@/lib/activity-logger";
import { buildEndpointResolver } from "@/lib/endpoint-domain";

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
 * WireGuard: every slot connects to the same ingress (StarVPN's OpenWRT guide:
 * Endpoint wg.starzone.io:1276, AllowedIPs 0.0.0.0/0, keepalive 25, no PSK). The
 * slot's own PrivateKey/Address come from refresh_data (wg_private_key, wg_ipv4).
 * TODO: the server PublicKey only appears in a config downloaded from the StarVPN
 * member area ("Wireguard Config"); until it is filled in, the dashboard hides
 * download/QR/view config on StarVPN slots.
 */
export const STARHOME_WG_ENDPOINT = "wg.starzone.io";
export const STARHOME_WG_PORT = 1276;
export const STARHOME_WG_SERVER_PUBLIC_KEY: string | null = null;
/**
 * Interface name the Dashboard shows for these peers (generateConfig looks the
 * server key up by it). Neutral on purpose: tenants don't want the provider
 * visible to their users.
 */
export const STARHOME_WG_INTERFACE = "wg0";

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
}

export const ACCOUNT_COLS = "id, router_id, owner_user_id, label, email, auth_token, proxy_host, package, status, next_due_date, total_slots, last_synced_at, last_sync_error, created_at";
export const SLOT_COLS = "id, account_id, slot_number, port, ip_type, country, region, isp, vpn_username, vpn_password, remaining_updates, raw, name, assigned_user_id, assigned_at, expires_at, last_rotated_at";

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

/** Dashboard view: a slot as a read-only WireGuard peer. `endpointHost` = the tenant's white-label name, if any. */
export function slotAsPeer(
  slot: StarhomeSlotRow,
  account: StarhomeAccountRow,
  emails: Map<string, string>,
  endpointHost: string | null
): WireGuardPeer {
  const privateKey = typeof slot.raw?.wg_private_key === "string" ? (slot.raw.wg_private_key as string) : null;
  const wgIpv4 = typeof slot.raw?.wg_ipv4 === "string" ? (slot.raw.wg_ipv4 as string) : null;
  const who = slot.assigned_user_id || account.owner_user_id;
  return {
    ".id": `*sh:${slot.id}`,
    name: slot.name || `Slot ${slot.slot_number}`,
    interface: STARHOME_WG_INTERFACE,
    "public-key": (privateKey && publicKeyFromPrivate(privateKey)) || `starhome:${slot.id}`,
    "private-key": privateKey || undefined,
    "allowed-address": wgIpv4 ? `${wgIpv4}/32` : "",
    comment: slotLocation(slot),
    disabled: false,
    created_by_email: emails.get(who) || null,
    created_by_user_id: who,
    created_at: slot.assigned_at || account.created_at,
    endpoint_host: endpointHost || STARHOME_WG_ENDPOINT,
    expires_at: slot.expires_at,
  };
}

export async function starhomePeersForRouter(admin: SupabaseClient, routerId: string, viewer: Viewer): Promise<WireGuardPeer[]> {
  const account = await accountForRouter(admin, routerId);
  if (!account) return [];
  const { slots, emails } = await visibleSlots(admin, account, viewer);

  // White-label (v26): <slug>.<tenant domain>, which the tenant points at
  // wg.starzone.io with a CNAME. No domain → the provider host itself.
  const { data: router } = await admin
    .from("routers")
    .select("name, endpoint_slug, endpoint_domain")
    .eq("id", routerId)
    .maybeSingle();
  const resolveEndpoint = await buildEndpointResolver(admin, router || {});

  return slots.map((s) => slotAsPeer(s, account, emails, resolveEndpoint(s.assigned_user_id || account.owner_user_id)));
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

/** Unassigns every slot whose timer ran out. Nothing changes at StarHome. */
export async function expireSlotAssignments(admin: SupabaseClient): Promise<void> {
  const { data: expired } = await admin
    .from("starhome_slots")
    .select("id, slot_number, account_id, assigned_user_id")
    .not("assigned_user_id", "is", null)
    .lt("expires_at", new Date().toISOString());
  if (!expired?.length) return;

  await admin
    .from("starhome_slots")
    .update({ assigned_user_id: null, assigned_at: null, expires_at: null })
    .in("id", expired.map((s: { id: string }) => s.id));

  const accounts = new Map<string, StarhomeAccountRow>();
  for (const s of expired) {
    let account = accounts.get(s.account_id);
    if (!account) {
      const { data } = await admin.from("starhome_accounts").select(ACCOUNT_COLS).eq("id", s.account_id).maybeSingle();
      if (!data) continue;
      account = data as StarhomeAccountRow;
      accounts.set(s.account_id, account);
    }
    await revokeServerAccessIfUnused(admin, account, s.assigned_user_id);
    await logActivity({
      supabase: admin,
      userId: null,
      routerId: account.router_id,
      action: "disable",
      entityType: "starhome_slot",
      entityId: s.id,
      entityName: `Slot #${s.slot_number}`,
      details: { reason: "expired", unassignedUserId: s.assigned_user_id },
    });
  }
}
