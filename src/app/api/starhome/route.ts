import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-logger";
import { slugFromRouterName } from "@/lib/endpoint-domain";
import {
  ACCOUNT_COLS,
  SLOT_COLS,
  STARHOME_PROXY_HOST,
  StarhomeError,
  canManageAccount,
  fetchAccountData,
  grantServerAccess,
  revokeServerAccessIfUnused,
  rotateSlotIp,
  storeAccountData,
  syncAccount,
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

  return NextResponse.json({
    canManage: ctx.canManage,
    isAdmin: ctx.isAdmin,
    accounts: accounts.map(publicAccount),
    users,
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
        // The name doubles as the DNS label of the white-label endpoint (<slug>.<domain>)
        await admin
          .from("routers")
          .update({ name: label, endpoint_slug: slugFromRouterName(label) })
          .eq("id", r.account.router_id);
        await admin.from("starhome_accounts").update({ label }).eq("id", r.account.id);
        return NextResponse.json({ label });
      }

      case "deleteAccount": {
        const r = await loadOwnedAccount(ctx, body.accountId);
        if ("error" in r) return r.error;
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
        return NextResponse.json({ synced: true, slots: data.slots.length });
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

      case "rotateIp": {
        const r = await loadOwnedSlot(ctx, body.slotId);
        if ("error" in r) return r.error;
        await rotateSlotIp(r.account, r.slot.slot_number);
        await admin
          .from("starhome_slots")
          .update({
            last_rotated_at: new Date().toISOString(),
            remaining_updates: r.slot.remaining_updates != null ? Math.max(0, r.slot.remaining_updates - 1) : null,
          })
          .eq("id", r.slot.id);
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
    if (e instanceof StarhomeError) return NextResponse.json({ error: e.message }, { status: 502 });
    return NextResponse.json({ error: (e as Error).message || "Unexpected error" }, { status: 500 });
  }
}
