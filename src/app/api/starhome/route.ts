import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-logger";
import { isValidKey } from "@/lib/wireguard-keys";
import {
  ACCOUNT_COLS,
  SLOT_COLS,
  STARHOME_PROXY_HOST,
  StarhomeError,
  applyRelay,
  canManageAccount,
  clearRelay,
  fetchAccountData,
  getLocationOptions,
  grantServerAccess,
  probeSlotSoon,
  refreshExitIps,
  revokeServerAccessIfUnused,
  rotateSlotIp,
  storeAccountData,
  syncAccount,
  updateSlotLocation,
  type StarhomeAccountRow,
  type StarhomeSlotRow,
} from "@/lib/starhome";

export const dynamic = "force-dynamic";

/** A page load re-reads the provider when the last sync is older than this. */
const SYNC_TTL_MS = 15 * 60 * 1000;

interface Ctx {
  userId: string;
  isAdmin: boolean;
  /** Admins and semi-admins (can_create_users) connect accounts; everyone else only sees assigned slots. */
  canManage: boolean;
   
  admin: any;
}

async function context(): Promise<{ ctx?: Ctx; error?: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const admin = createAdminClient();
  if (!admin) return { error: NextResponse.json({ error: "Service role not configured" }, { status: 500 }) };

  const { data: profile } = await admin.from("profiles").select("role, capabilities").eq("id", user.id).single();
  const isAdmin = profile?.role?.toLowerCase() === "admin";
  return {
    ctx: {
      userId: user.id,
      isAdmin,
      canManage: isAdmin || profile?.capabilities?.can_create_users === true,
      admin,
    },
  };
}

function publicAccount(a: StarhomeAccountRow) {
   
  const { auth_token, ...rest } = a;
  return rest;
}

/** Slot + its account, only when the caller may manage it (owner or admin). */
async function loadOwnedSlot(ctx: Ctx, slotId: unknown) {
  if (!slotId || typeof slotId !== "string") return { error: NextResponse.json({ error: "Missing slotId" }, { status: 400 }) };
  const { data: slot } = await ctx.admin.from("starhome_slots").select(SLOT_COLS).eq("id", slotId).maybeSingle();
  if (!slot) return { error: NextResponse.json({ error: "Slot not found" }, { status: 404 }) };
  const { data: account } = await ctx.admin.from("starhome_accounts").select(ACCOUNT_COLS).eq("id", slot.account_id).maybeSingle();
  if (!account || !canManageAccount(account, ctx)) {
    return { error: NextResponse.json({ error: "Slot not found" }, { status: 404 }) };
  }
  return { slot: slot as StarhomeSlotRow, account: account as StarhomeAccountRow };
}

async function loadOwnedAccount(ctx: Ctx, accountId: unknown) {
  if (!accountId || typeof accountId !== "string") return { error: NextResponse.json({ error: "Missing accountId" }, { status: 400 }) };
  const { data: account } = await ctx.admin.from("starhome_accounts").select(ACCOUNT_COLS).eq("id", accountId).maybeSingle();
  if (!account || !canManageAccount(account, ctx)) {
    return { error: NextResponse.json({ error: "Account not found" }, { status: 404 }) };
  }
  return { account: account as StarhomeAccountRow };
}

function parseExpiry(value: unknown): { expiresAt: string | null } | { error: NextResponse } {
  if (value == null || value === "") return { expiresAt: null };
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return { error: NextResponse.json({ error: "Invalid expiresAt" }, { status: 400 }) };
  if (d.getTime() <= Date.now()) return { error: NextResponse.json({ error: "expiresAt must be in the future" }, { status: 400 }) };
  return { expiresAt: d.toISOString() };
}

/**
 * GET — the accounts the caller manages (refreshed from StarHome when stale)
 * and the users they can assign slots to. /profile lists the accounts; /socks5
 * uses `users` for its assign dialog.
 */
export async function GET() {
  const { ctx, error } = await context();
  if (error || !ctx) return error!;
  const { admin } = ctx;

  let accounts: StarhomeAccountRow[] = [];
   
  let users: any[] = [];
  if (ctx.canManage) {
    let q = admin.from("starhome_accounts").select(ACCOUNT_COLS).order("created_at");
    if (!ctx.isAdmin) q = q.eq("owner_user_id", ctx.userId);
    accounts = ((await q).data || []) as StarhomeAccountRow[];

    for (const a of accounts) {
      const age = a.last_synced_at ? Date.now() - new Date(a.last_synced_at).getTime() : Infinity;
      if (age > SYNC_TTL_MS) {
        try {
          const data = await syncAccount(admin, a);
          a.last_synced_at = new Date().toISOString();
          a.last_sync_error = null;
          a.package = data.package;
          a.status = data.status;
          a.next_due_date = data.next_due_date;
          a.total_slots = data.total_slots;
        } catch (e) {
          a.last_sync_error = (e as Error).message;
        }
      }
    }

    let uq = admin.from("profiles").select("id, email").order("email");
    uq = ctx.isAdmin ? uq.neq("id", ctx.userId) : uq.eq("created_by_user_id", ctx.userId);
    users = (await uq).data || [];
  }

  // Linux servers the caller can relay through (v35)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let relayOptions: any[] = [];
  if (ctx.canManage) {
    let rq = admin.from("routers").select("id, name").eq("connection_type", "linux-ssh").order("name");
    if (!ctx.isAdmin) {
      const { data: access } = await admin.from("user_routers").select("router_id").eq("user_id", ctx.userId);
      rq = rq.in("id", (access || []).map((a: { router_id: string }) => a.router_id));
    }
    relayOptions = (await rq).data || [];
  }

  return NextResponse.json({
    canManage: ctx.canManage,
    isAdmin: ctx.isAdmin,
    accounts: accounts.map(publicAccount),
    users,
    relayOptions,
  });
}

/** POST { action, ... } — mutations. All of them require owning the account (or admin). */
export async function POST(request: Request) {
  const { ctx, error } = await context();
  if (error || !ctx) return error!;
  const { admin } = ctx;

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    switch (action) {
      case "addAccount": {
        if (!ctx.canManage) return NextResponse.json({ error: "Your account can't connect StarHome accounts" }, { status: 403 });
        const email = String(body.email || "").trim().toLowerCase();
        const authToken = String(body.authToken || "").trim();
        const label = String(body.label || "").trim();
        if (!email || !authToken) return NextResponse.json({ error: "Email and auth token are required" }, { status: 400 });

        const { data: existing } = await admin
          .from("starhome_accounts")
          .select("id")
          .eq("owner_user_id", ctx.userId)
          .eq("email", email)
          .maybeSingle();
        if (existing) return NextResponse.json({ error: "This StarHome account is already connected" }, { status: 409 });

        // Validate against StarHome before creating anything
        const data = await fetchAccountData({ email, auth_token: authToken });

        // The account is a "server": a routers row is what every selector lists.
        const name = (label || `StarVPN (${email})`).slice(0, 80);
        const { data: router, error: routerError } = await admin
          .from("routers")
          .insert({
            name,
            host: STARHOME_PROXY_HOST,
            port: 443,
            api_port: 8728,
            username: email,
            password: authToken,
            use_ssl: false,
            connection_type: "starhome",
            created_by: ctx.userId,
          })
          .select("id")
          .single();
        if (routerError) return NextResponse.json({ error: routerError.message }, { status: 500 });

        const { data: created, error: dbError } = await admin
          .from("starhome_accounts")
          .insert({ router_id: router.id, owner_user_id: ctx.userId, label: name, email, auth_token: authToken })
          .select("id, label")
          .single();
        if (dbError) {
          await admin.from("routers").delete().eq("id", router.id);
          return NextResponse.json({ error: dbError.message }, { status: 500 });
        }
        await storeAccountData(admin, created.id, data);
        await grantServerAccess(admin, router.id, ctx.userId);

        await logActivity({
          supabase: admin,
          userId: ctx.userId,
          routerId: router.id,
          action: "create",
          entityType: "starhome_account",
          entityId: created.id,
          entityName: name,
          details: { email, slots: data.slots.length, package: data.package },
        });
        return NextResponse.json({ accountId: created.id, routerId: router.id, slots: data.slots.length }, { status: 201 });
      }

      case "renameAccount": {
        const r = await loadOwnedAccount(ctx, body.accountId);
        if ("error" in r) return r.error;
        const label = String(body.label || "").trim().slice(0, 80);
        if (!label) return NextResponse.json({ error: "Name is required" }, { status: 400 });
        // The DNS label (endpoint_slug) is edited in Profile → DNS records, not here
        await admin.from("routers").update({ name: label }).eq("id", r.account.router_id);
        await admin.from("starhome_accounts").update({ label }).eq("id", r.account.id);
        return NextResponse.json({ label });
      }

      case "setWgServerKey": {
        const r = await loadOwnedAccount(ctx, body.accountId);
        if ("error" in r) return r.error;
        const key = String(body.publicKey || "").trim();
        if (key && !isValidKey(key)) {
          return NextResponse.json({ error: "That's not a WireGuard key (44 base64 characters)" }, { status: 400 });
        }
        // Empty = back to the built-in default
        await admin.from("starhome_accounts").update({ wg_server_public_key: key || null }).eq("id", r.account.id);
        return NextResponse.json({ publicKey: key || null });
      }

      case "deleteAccount": {
        const r = await loadOwnedAccount(ctx, body.accountId);
        if ("error" in r) return r.error;
        // Rules on the relay server don't cascade — best effort before the rows go
        if (r.account.relay_router_id) await clearRelay(admin, r.account).catch(() => {});
        // Cascades to starhome_accounts → starhome_slots and to both access tables
        await admin.from("routers").delete().eq("id", r.account.router_id);
        await logActivity({
          supabase: admin,
          userId: ctx.userId,
          action: "delete",
          entityType: "starhome_account",
          entityId: r.account.id,
          entityName: r.account.label,
          details: { email: r.account.email },
        });
        return NextResponse.json({ deleted: true });
      }

      case "sync": {
        const r = await loadOwnedAccount(ctx, body.accountId);
        if ("error" in r) return r.error;
        const data = await syncAccount(admin, r.account);
        // New slots need their relay rule; a moved ingress IP needs all of them rewritten
        if (r.account.relay_router_id) await applyRelay(admin, r.account);
        return NextResponse.json({ synced: true, slots: data.slots.length });
      }

      case "setRelay": {
        const r = await loadOwnedAccount(ctx, body.accountId);
        if ("error" in r) return r.error;
        const routerId = body.routerId ? String(body.routerId) : null;
        if (routerId) {
          const { data: router } = await admin.from("routers").select("id, connection_type").eq("id", routerId).maybeSingle();
          if (!router || router.connection_type !== "linux-ssh") {
            return NextResponse.json({ error: "The relay must be one of your Linux servers" }, { status: 400 });
          }
          if (!ctx.isAdmin) {
            const { data: access } = await admin
              .from("user_routers")
              .select("id")
              .eq("user_id", ctx.userId)
              .eq("router_id", routerId)
              .maybeSingle();
            if (!access) return NextResponse.json({ error: "Server not found" }, { status: 404 });
          }
        }
        if (routerId === r.account.relay_router_id) return NextResponse.json({ relayRouterId: routerId });

        // Leaving a relay: take its rules down first so nothing dangles there
        if (r.account.relay_router_id) await clearRelay(admin, r.account);
        await admin
          .from("starhome_accounts")
          .update({ relay_router_id: routerId, relay_target_ip: null })
          .eq("id", r.account.id);
        let applied: { target: string; slots: number } | null = null;
        if (routerId) {
          applied = await applyRelay(admin, { ...r.account, relay_router_id: routerId, relay_target_ip: null });
        }
        await logActivity({
          supabase: admin,
          userId: ctx.userId,
          routerId: r.account.router_id,
          action: "update",
          entityType: "starhome_account",
          entityId: r.account.id,
          entityName: r.account.label,
          details: { relayRouterId: routerId, relayTarget: applied?.target || null },
        });
        return NextResponse.json({ relayRouterId: routerId, ...(applied || {}) });
      }

      case "assignSlot": {
        const r = await loadOwnedSlot(ctx, body.slotId);
        if ("error" in r) return r.error;
        const userId = String(body.userId || "");
        if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

        // Semi-admins can only hand slots to the users they created
        const { data: target } = await admin.from("profiles").select("id, email, created_by_user_id").eq("id", userId).maybeSingle();
        if (!target || (!ctx.isAdmin && target.created_by_user_id !== ctx.userId)) {
          return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        const exp = parseExpiry(body.expiresAt);
        if ("error" in exp) return exp.error;

        const previous = r.slot.assigned_user_id;
        await admin
          .from("starhome_slots")
          .update({ assigned_user_id: target.id, assigned_at: new Date().toISOString(), expires_at: exp.expiresAt })
          .eq("id", r.slot.id);
        await grantServerAccess(admin, r.account.router_id, target.id);
        if (previous && previous !== target.id) await revokeServerAccessIfUnused(admin, r.account, previous);

        await logActivity({
          supabase: admin,
          userId: ctx.userId,
          routerId: r.account.router_id,
          action: "update",
          entityType: "starhome_slot",
          entityId: r.slot.id,
          entityName: `Slot #${r.slot.slot_number}`,
          details: { assignedTo: target.email, expiresAt: exp.expiresAt },
        });
        return NextResponse.json({ assigned: true });
      }

      case "unassignSlot": {
        const r = await loadOwnedSlot(ctx, body.slotId);
        if ("error" in r) return r.error;
        await admin
          .from("starhome_slots")
          .update({ assigned_user_id: null, assigned_at: null, expires_at: null })
          .eq("id", r.slot.id);
        await revokeServerAccessIfUnused(admin, r.account, r.slot.assigned_user_id);
        await logActivity({
          supabase: admin,
          userId: ctx.userId,
          routerId: r.account.router_id,
          action: "update",
          entityType: "starhome_slot",
          entityId: r.slot.id,
          entityName: `Slot #${r.slot.slot_number}`,
          details: { unassigned: r.slot.assigned_user_id },
        });
        return NextResponse.json({ unassigned: true });
      }

      case "getLocationOptions": {
        return NextResponse.json({ countries: await getLocationOptions() });
      }

      case "setSlotLocation": {
        const r = await loadOwnedSlot(ctx, body.slotId);
        if ("error" in r) return r.error;
        const countries = await getLocationOptions();
        const country = countries.find((c) => c.key === String(body.country || ""));
        const region = country?.regions.find((g) => g.key === String(body.region || ""));
        const isp = region?.isps.find((i) => i.key === String(body.isp || ""));
        if (!country || !region || !isp) return NextResponse.json({ error: "Pick a country, region and ISP" }, { status: 400 });
        await updateSlotLocation(r.account, r.slot, { country, region, isp });
        await syncAccount(admin, r.account).catch(() => {});
        // The provider moves the slot with a delay: re-probe this slot over the next minutes
        probeSlotSoon(admin, r.account, r.slot);
        await logActivity({
          supabase: admin,
          userId: ctx.userId,
          routerId: r.account.router_id,
          action: "update",
          entityType: "starhome_slot",
          entityId: r.slot.id,
          entityName: r.slot.name || `Slot ${r.slot.slot_number}`,
          details: { location: `${country.name} / ${region.name} / ${isp.name}` },
        });
        return NextResponse.json({ updated: true });
      }

      case "refreshExitIps": {
        const r = await loadOwnedAccount(ctx, body.accountId);
        if ("error" in r) return r.error;
        if (!r.account.relay_router_id) {
          return NextResponse.json({ error: "Set a relay server first — its IP is what StarVPN must authorize" }, { status: 400 });
        }
        const answered = await refreshExitIps(admin, r.account, { force: true });
        return NextResponse.json({ answered });
      }

      case "rotateIp": {
        const r = await loadOwnedSlot(ctx, body.slotId);
        if ("error" in r) return r.error;
        await rotateSlotIp(r.account, r.slot);
        await admin
          .from("starhome_slots")
          .update({
            last_rotated_at: new Date().toISOString(),
            remaining_updates: r.slot.remaining_updates != null ? Math.max(0, r.slot.remaining_updates - 1) : null,
          })
          .eq("id", r.slot.id);
        // The provider's counters show up on the next poll; the new IP takes a while, so keep probing this slot
        await syncAccount(admin, r.account).catch(() => {});
        probeSlotSoon(admin, r.account, r.slot);
        await logActivity({
          supabase: admin,
          userId: ctx.userId,
          routerId: r.account.router_id,
          action: "update",
          entityType: "starhome_slot",
          entityId: r.slot.id,
          entityName: `Slot #${r.slot.slot_number}`,
          details: { rotatedIp: true },
        });
        return NextResponse.json({ rotated: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    // Never 502/504 here: the panel sits behind Cloudflare, which swaps those for its own
    // HTML error page and the browser then fails to parse the JSON.
    if (e instanceof StarhomeError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: (e as Error).message || "Unexpected error" }, { status: 500 });
  }
}
