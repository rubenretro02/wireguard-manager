/**
 * Server-side access scope.
 *
 * The panel filters peers in the browser (dashboard/page.tsx): the API returns
 * every peer of a router and React hides the ones you may not see. That is fine
 * for a page but useless for an API key, so this module resolves the same rules
 * server-side — which servers a caller may touch, which public IPs, and which
 * peers are theirs.
 */
import type { UserCapabilities } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export interface ScopeOwner {
  userId: string;
  email: string;
  isAdmin: boolean;
  capabilities: UserCapabilities;
}

export interface PeerScope {
  /** No filtering: admin or can_see_all_peers */
  seesEverything: boolean;
  /** Creators whose peers this caller may see (self + managed users + group) */
  creatorIds: Set<string>;
  /** Public IPs this caller has been granted (user_ip_access) */
  allowedPublicIps: Set<string>;
  owner: ScopeOwner;
}

/** Servers the caller may use. `null` = every server (admin). */
export async function allowedRouterIds(admin: AnyClient, owner: ScopeOwner): Promise<Set<string> | null> {
  if (owner.isAdmin) return null;
  const { data } = await admin.from("user_routers").select("router_id").eq("user_id", owner.userId);
  return new Set((data || []).map((r: { router_id: string }) => r.router_id));
}

export async function canUseRouter(admin: AnyClient, owner: ScopeOwner, routerId: string): Promise<boolean> {
  const allowed = await allowedRouterIds(admin, owner);
  return allowed === null || allowed.has(routerId);
}

/**
 * Builds the peer filter for one router: who the caller may see peers from and
 * which public IPs they have access to.
 */
export async function buildPeerScope(admin: AnyClient, owner: ScopeOwner, routerId: string): Promise<PeerScope> {
  const seesEverything = Boolean(owner.isAdmin || owner.capabilities.can_see_all_peers);
  const creatorIds = new Set<string>([owner.userId]);
  const allowedPublicIps = new Set<string>();

  if (seesEverything) return { seesEverything, creatorIds, allowedPublicIps, owner };

  // Semi-admin: peers created by the users they created
  if (owner.capabilities.can_create_users) {
    const { data } = await admin.from("profiles").select("id").eq("created_by_user_id", owner.userId);
    for (const u of data || []) creatorIds.add(u.id);
  }

  // can_see_group_peers: parent + siblings
  if (owner.capabilities.can_see_group_peers) {
    const { data: me } = await admin
      .from("profiles")
      .select("created_by_user_id")
      .eq("id", owner.userId)
      .single();
    const parentId = me?.created_by_user_id;
    if (parentId) {
      creatorIds.add(parentId);
      const { data: siblings } = await admin.from("profiles").select("id").eq("created_by_user_id", parentId);
      for (const u of siblings || []) creatorIds.add(u.id);
    }
  }

  // IP access grants
  const { data: grants } = await admin
    .from("user_ip_access")
    .select("ip_id, can_use")
    .eq("user_id", owner.userId);
  const grantedIds = (grants || []).filter((g: { can_use: boolean }) => g.can_use).map((g: { ip_id: string }) => g.ip_id);
  if (grantedIds.length > 0) {
    const { data: ips } = await admin
      .from("public_ips")
      .select("public_ip")
      .eq("router_id", routerId)
      .in("id", grantedIds);
    for (const ip of ips || []) allowedPublicIps.add(ip.public_ip);
  }

  return { seesEverything, creatorIds, allowedPublicIps, owner };
}

/** Same rule as the dashboard: creator match OR granted IP. */
export function peerInScope(
  scope: PeerScope,
  peer: { created_by_user_id?: string | null; created_by_email?: string | null; comment?: string | null }
): boolean {
  if (scope.seesEverything) return true;

  const creator = peer.created_by_user_id || "";
  const ownPeer = creator === scope.owner.userId || peer.created_by_email === scope.owner.email;
  const managedPeer = creator !== "" && scope.creatorIds.has(creator);
  if (!ownPeer && !managedPeer) {
    // Peers with no creator on record belong to nobody the caller manages
    return false;
  }

  // Own and managed peers stay visible even if the IP was never granted; the IP
  // grant is what widens visibility to peers created by others on that IP.
  if (ownPeer || managedPeer) return true;
  return scope.allowedPublicIps.has(peer.comment || "");
}

/** Public IPs the caller may create peers on. */
export async function allowedPublicIpsForRouter(
  admin: AnyClient,
  owner: ScopeOwner,
  routerId: string
): Promise<Array<{ id: string; public_ip: string; internal_subnet: string; ip_number: number; wg_interface: string | null }>> {
  const { data: all } = await admin
    .from("public_ips")
    .select("id, public_ip, internal_subnet, ip_number, wg_interface, enabled")
    .eq("router_id", routerId)
    .order("ip_number");

  const enabled = (all || []).filter((ip: { enabled: boolean }) => ip.enabled);
  if (owner.isAdmin) return enabled;

  const { data: grants } = await admin
    .from("user_ip_access")
    .select("ip_id, can_use")
    .eq("user_id", owner.userId);
  const granted = new Set(
    (grants || []).filter((g: { can_use: boolean }) => g.can_use).map((g: { ip_id: string }) => g.ip_id)
  );
  return enabled.filter((ip: { id: string }) => granted.has(ip.id));
}
