import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  buildEndpointHost,
  invalidateEndpointDomainCache,
  isValidDomain,
  normalizeDomain,
  slugForTenant,
} from "@/lib/endpoint-domain";
import { ensurePanelDomain, removePanelDomain } from "@/lib/dokploy";
import { STARHOME_WG_ENDPOINT } from "@/lib/starhome";

// node:dns is not available on Edge
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  isAdmin: boolean;
  canConfigure: boolean;
}

async function context(): Promise<{ ctx?: Ctx; error?: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const admin = createAdminClient();
  if (!admin) return { error: NextResponse.json({ error: "Service role not configured" }, { status: 500 }) };

  const { data: profile } = await admin
    .from("profiles")
    .select("role, capabilities")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role?.toLowerCase() === "admin";
  // Semi-admins (those who manage their own users) get their own white label
  const canConfigure = isAdmin || profile?.capabilities?.can_create_users === true;
  return { ctx: { userId: user.id, admin, isAdmin, canConfigure } };
}

/**
 * GET — current domains plus the exact DNS records the tenant has to create:
 * one A record per server, since a hostname resolves to a single IP.
 */
export async function GET() {
  const { ctx, error } = await context();
  if (error || !ctx) return error!;

  const { data: profile } = await ctx.admin
    .from("profiles")
    .select("panel_domain, endpoint_domain, brand_name, endpoint_slugs")
    .eq("id", ctx.userId)
    .single();

  // Only the servers this tenant actually has: never leak other tenants' hosts
  let routerQuery = ctx.admin
    .from("routers")
    .select("id, name, host, endpoint_ip, endpoint_slug, endpoint_domain, connection_type, created_by")
    .order("name");
  if (!ctx.isAdmin) {
    const { data: access } = await ctx.admin
      .from("user_routers")
      .select("router_id")
      .eq("user_id", ctx.userId);
    const ids = (access || []).map((a: { router_id: string }) => a.router_id);
    if (ids.length === 0) {
      return NextResponse.json({
        canConfigure: ctx.canConfigure,
        panelDomain: profile?.panel_domain || null,
        endpointDomain: profile?.endpoint_domain || null,
        brandName: profile?.brand_name || null,
        records: [],
      });
    }
    routerQuery = routerQuery.in("id", ids);
  }
  const { data: routers } = await routerQuery;

  const endpointDomain = profile?.endpoint_domain || null;

  // StarVPN accounts with a relay (v35): the name points at OUR relay server, not the provider
  const relayByRouter = new Map<string, string>();
  {
    const { data: accounts } = await ctx.admin
      .from("starhome_accounts")
      .select("router_id, relay_router_id")
      .not("relay_router_id", "is", null);
    const rows = (accounts || []) as Array<{ router_id: string; relay_router_id: string }>;
    const relayIds = [...new Set(rows.map((a) => a.relay_router_id))];
    if (relayIds.length) {
      const { data: relays } = await ctx.admin.from("routers").select("id, host, endpoint_ip").in("id", relayIds);
      const target = new Map<string, string>(
        ((relays || []) as Array<{ id: string; host: string; endpoint_ip: string | null }>).map((r) => [r.id, r.endpoint_ip || r.host])
      );
      for (const a of rows) {
        const t = target.get(a.relay_router_id);
        if (t) relayByRouter.set(a.router_id, t);
      }
    }
  }

  // Router rows that share a host+slug (one config per interface) are the same
  // DNS record — list it once.
  const byHost = new Map<string, { routerId: string; routerName: string; slug: string; host: string | null; target: string; recordType: "A" | "CNAME"; editable: boolean }>();
  for (const r of (routers || []) as Array<{ id: string; name: string; host: string; endpoint_ip: string | null; endpoint_slug: string | null; endpoint_domain: string | null; connection_type: string | null; created_by: string | null }>) {
    // v34: the tenant's own label for this server, falling back to the router's slug
    const slug = slugForTenant(r, profile);
    const host = buildEndpointHost(slug, endpointDomain || r.endpoint_domain);
    if (!host || byHost.has(host)) continue;
    // endpoint_ip !== host on servers behind a CHR/gateway, where `host` is the
    // gateway (SSH arrives by port-forward) and WireGuard listens on the block's IPs.
    // StarVPN (v32) has no IP of ours: the name is a CNAME to the provider's WG ingress —
    // unless the account relays through one of our servers (v35), then it's that server's A.
    const isStarhome = r.connection_type === "starhome";
    const relayTarget = isStarhome ? relayByRouter.get(r.id) : undefined;
    byHost.set(host, {
      routerId: r.id,
      routerName: r.name,
      slug,
      host,
      target: relayTarget || (isStarhome ? STARHOME_WG_ENDPOINT : r.endpoint_ip || r.host),
      recordType: isStarhome && !relayTarget ? "CNAME" : "A",
      // The label is the tenant's own (v34), so anyone who configures domains can rename it
      editable: ctx.canConfigure,
    });
  }

  return NextResponse.json({
    canConfigure: ctx.canConfigure,
    panelDomain: profile?.panel_domain || null,
    endpointDomain,
    brandName: profile?.brand_name || null,
    records: Array.from(byHost.values()),
  });
}

/**
 * A records of `host`. DNS-over-HTTPS first: the container's resolver caches
 * negative answers, so a record created after the first check looks missing for
 * minutes even though it already resolves everywhere else. DoH also works where
 * outbound UDP/53 is blocked.
 */
async function resolveA(host: string): Promise<{ ips: string[]; notFound?: boolean }> {
  try {
    const res = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const json = (await res.json()) as { Status: number; Answer?: Array<{ type: number; data: string }> };
      const ips = (json.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
      if (ips.length > 0) return { ips };
      if (json.Status === 3) return { ips: [], notFound: true };
    }
  } catch {
    // fall through to the system resolver
  }

  try {
    return { ips: await dns.resolve4(host) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code || "";
    return { ips: [], notFound: code === "ENOTFOUND" || code === "NODATA" };
  }
}

/**
 * POST { panelDomain?, endpointDomain?, brandName? } — save the tenant's domains.
 * POST { action: "check", host, target? } — resolve a hostname and report the IPs it
 * answers (plus the target's IPs when the target is a hostname, i.e. a CNAME record).
 * POST { action: "setSlug", routerId, slug } — this tenant's DNS label for a server (v34).
 */
export async function POST(request: Request) {
  const { ctx, error } = await context();
  if (error || !ctx) return error!;

  const body = await request.json();

  if (body.action === "check") {
    const host = normalizeDomain(String(body.host || ""));
    if (!isValidDomain(host)) return NextResponse.json({ error: "Invalid hostname" }, { status: 400 });
    const result = await resolveA(host);
    // CNAME targets (StarVPN): the record is right when the name answers with
    // the same IPs the target currently has, so resolve the target too.
    const target = normalizeDomain(String(body.target || ""));
    if (target && !/^\d+\.\d+\.\d+\.\d+$/.test(target) && isValidDomain(target)) {
      return NextResponse.json({ host, ...result, targetIps: (await resolveA(target)).ips });
    }
    return NextResponse.json({ host, ...result });
  }

  if (body.action === "setSlug") {
    if (!ctx.canConfigure) {
      return NextResponse.json({ error: "You don't have permission to configure domains" }, { status: 403 });
    }
    const routerId = String(body.routerId || "");
    const slug = String(body.slug || "").trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$/.test(slug)) {
      return NextResponse.json({ error: "Use 1–24 letters, digits or dashes (e.g. residential)" }, { status: 400 });
    }
    // Only servers this tenant can see (admin: all)
    if (!ctx.isAdmin) {
      const { data: access } = await ctx.admin
        .from("user_routers")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("router_id", routerId)
        .maybeSingle();
      if (!access) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }
    // Stored on the tenant's own profile: other tenants' hostnames are untouched
    const { data: me } = await ctx.admin.from("profiles").select("endpoint_slugs").eq("id", ctx.userId).single();
    const slugs = { ...((me?.endpoint_slugs as Record<string, string> | null) || {}), [routerId]: slug };
    const { error: dbError } = await ctx.admin.from("profiles").update({ endpoint_slugs: slugs }).eq("id", ctx.userId);
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
    invalidateEndpointDomainCache();
    return NextResponse.json({ success: true, slug });
  }

  if (!ctx.canConfigure) {
    return NextResponse.json({ error: "You don't have permission to configure domains" }, { status: 403 });
  }

  const update: Record<string, string | null> = {};

  for (const field of ["panelDomain", "endpointDomain"] as const) {
    if (!(field in body)) continue;
    const raw = String(body[field] ?? "").trim();
    const column = field === "panelDomain" ? "panel_domain" : "endpoint_domain";
    if (!raw) {
      update[column] = null;
      continue;
    }
    const domain = normalizeDomain(raw);
    if (!isValidDomain(domain)) {
      return NextResponse.json({ error: `"${raw}" is not a valid domain` }, { status: 400 });
    }
    update[column] = domain;
  }

  if ("brandName" in body) {
    const brand = String(body.brandName ?? "").trim();
    update.brand_name = brand ? brand.slice(0, 60) : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // panel_domain is unique across tenants: it decides whose brand a request shows
  if (update.panel_domain) {
    const { data: taken } = await ctx.admin
      .from("profiles")
      .select("id")
      .ilike("panel_domain", update.panel_domain)
      .neq("id", ctx.userId)
      .limit(1);
    if (taken && taken.length > 0) {
      return NextResponse.json({ error: "That panel domain is already taken" }, { status: 409 });
    }
  }

  const { data: before } = await ctx.admin
    .from("profiles")
    .select("panel_domain")
    .eq("id", ctx.userId)
    .single();

  const { error: dbError } = await ctx.admin.from("profiles").update(update).eq("id", ctx.userId);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  // Peers resolve their endpoint through a short-lived cache of this table
  invalidateEndpointDomainCache();

  // Register the panel domain with Dokploy so it serves this app over HTTPS
  let panelDomainStatus: string | null = null;
  if ("panel_domain" in update && update.panel_domain !== before?.panel_domain) {
    if (before?.panel_domain) await removePanelDomain(before.panel_domain);
    if (update.panel_domain) {
      const res = await ensurePanelDomain(update.panel_domain);
      panelDomainStatus = res.ok
        ? res.message
        : `Saved, but the domain could not be registered automatically: ${res.message}`;
    }
  }

  return NextResponse.json({ success: true, ...update, panelDomainStatus });
}
