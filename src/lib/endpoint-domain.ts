/**
 * White-label endpoints (v26).
 *
 * A peer's Endpoint is `<router.endpoint_slug>.<tenant domain>` — a single DNS
 * name can only answer with one IP, so every server needs its own record under
 * the tenant's base domain. The tenant configures the base domain once.
 *
 * Domain resolution walks the ownership chain so a semi-admin's users inherit
 * their brand without configuring anything:
 *   creator → creator's parent → ... → router default → null (falls back to IP)
 */

interface ProfileDomainRow {
  id: string;
  endpoint_domain: string | null;
  created_by_user_id: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/** Strip protocol/path/spaces and lowercase: "HTTPS://Zone.Home.com/" → "zone.home.com" */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/\\].*$/, "")
    .replace(/^\.+|\.+$/g, "");
}

/** Accepts hostnames like zone.homevpn.com (at least two labels, no wildcards). */
export function isValidDomain(domain: string): boolean {
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain);
}

/** DNS label for a server: "TX Server 12.164.34.2" → "tx-server" (fallback when no slug is set). */
export function slugFromRouterName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\d+\.\d+\.\d+\.\d+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return slug || "vpn";
}

/** `tx` + `zone.homevpn.com` → `tx.zone.homevpn.com`. Null domain = use the public IP. */
export function buildEndpointHost(slug: string | null | undefined, domain: string | null | undefined): string | null {
  if (!domain) return null;
  const base = normalizeDomain(domain);
  if (!base) return null;
  const prefix = (slug || "").trim().toLowerCase();
  return prefix ? `${prefix}.${base}` : base;
}

// The peer list is polled every ~3s; the tenant table is tiny and changes rarely.
let profileCache: { at: number; rows: Map<string, ProfileDomainRow> } | null = null;
const PROFILE_CACHE_MS = 30_000;

export function invalidateEndpointDomainCache() {
  profileCache = null;
}

async function loadProfiles(admin: AnyClient): Promise<Map<string, ProfileDomainRow>> {
  if (profileCache && Date.now() - profileCache.at < PROFILE_CACHE_MS) return profileCache.rows;

  const { data } = await admin.from("profiles").select("id, endpoint_domain, created_by_user_id");
  const rows = new Map<string, ProfileDomainRow>();
  for (const row of (data || []) as ProfileDomainRow[]) rows.set(row.id, row);
  profileCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Returns `(creatorUserId) => endpointHost | null` for one router. Loads the
 * tenant table once so a whole peer list costs a single query.
 */
export async function buildEndpointResolver(
  admin: AnyClient,
  router: { endpoint_slug?: string | null; endpoint_domain?: string | null; name?: string }
): Promise<(creatorUserId?: string | null) => string | null> {
  const profiles = await loadProfiles(admin);
  const slug = router.endpoint_slug || slugFromRouterName(router.name || "");
  const routerDefault = router.endpoint_domain || null;

  return (creatorUserId?: string | null) => {
    let current = creatorUserId ? profiles.get(creatorUserId) : undefined;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.endpoint_domain) return buildEndpointHost(slug, current.endpoint_domain);
      seen.add(current.id);
      current = current.created_by_user_id ? profiles.get(current.created_by_user_id) : undefined;
    }
    return buildEndpointHost(slug, routerDefault);
  };
}
