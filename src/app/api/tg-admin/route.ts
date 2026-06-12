import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-logger";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  deactivateCustomerPeer,
  getServiceClient,
  reactivateCustomerPeerOnServer,
  removeCustomerPeerFromServer,
  renewCustomerPeer,
  type TgCustomerPeer,
} from "@/lib/tg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin API del store de Telegram. Solo admins del dashboard.
 * POST { action, data }
 */
export async function POST(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { action, data = {} } = body;
  const supabase = getServiceClient();

  try {
    switch (action) {
      /* ================= PLANES ================= */
      case "listPlans": {
        const { data: plans, error } = await supabase
          .from("tg_plans")
          .select("*, routers(name), public_ips(public_ip)")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        return NextResponse.json({ plans });
      }

      case "createPlan": {
        const { name, description, price_usd, duration_days, router_id, public_ip_id, enabled, sort_order } = data;
        if (!name || price_usd == null || !duration_days || !router_id) {
          return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }
        const { data: plan, error } = await supabase
          .from("tg_plans")
          .insert({
            name,
            description: description || null,
            price_usd,
            duration_days,
            router_id,
            public_ip_id: public_ip_id || null,
            enabled: enabled ?? true,
            sort_order: sort_order ?? 0,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ plan });
      }

      case "updatePlan": {
        const { id, ...fields } = data;
        if (!id) return NextResponse.json({ error: "Missing plan id" }, { status: 400 });
        const allowed = ["name", "description", "price_usd", "duration_days", "router_id", "public_ip_id", "enabled", "sort_order"];
        const updates: Record<string, unknown> = {};
        for (const key of allowed) {
          if (key in fields) updates[key] = fields[key] === "" ? null : fields[key];
        }
        const { data: plan, error } = await supabase
          .from("tg_plans")
          .update(updates)
          .eq("id", id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ plan });
      }

      case "deletePlan": {
        if (!data.id) return NextResponse.json({ error: "Missing plan id" }, { status: 400 });
        const { error } = await supabase.from("tg_plans").delete().eq("id", data.id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ success: true });
      }

      /* ================= CLIENTES ================= */
      case "listCustomers": {
        const { data: customers, error } = await supabase
          .from("tg_customers")
          .select("*, tg_customer_peers(id, status)")
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        return NextResponse.json({ customers });
      }

      case "setCustomerBan": {
        const { id, banned } = data;
        if (!id) return NextResponse.json({ error: "Missing customer id" }, { status: 400 });
        const { error } = await supabase
          .from("tg_customers")
          .update({ is_banned: Boolean(banned) })
          .eq("id", id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ success: true });
      }

      /* ================= PEERS DE CLIENTES ================= */
      case "listCustomerPeers": {
        const { data: peers, error } = await supabase
          .from("tg_customer_peers")
          .select("*, tg_customers(telegram_id, username, first_name), tg_plans(name), routers(name)")
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        return NextResponse.json({ peers });
      }

      case "extendPeer": {
        const { id, days, notify } = data;
        if (!id || !days) return NextResponse.json({ error: "Missing id or days" }, { status: 400 });
        const { data: peer } = await supabase.from("tg_customer_peers").select("*").eq("id", id).single();
        if (!peer) return NextResponse.json({ error: "Peer not found" }, { status: 404 });

        const renewed = await renewCustomerPeer({ supabase, peer: peer as TgCustomerPeer, durationDays: Number(days) });

        await logActivity({
          supabase: authClient,
          userId: user.id,
          routerId: peer.router_id,
          action: "update",
          entityType: "peer",
          entityId: peer.id,
          entityName: peer.peer_name,
          details: { telegram_extend_days: days },
        });

        if (notify) {
          const { data: customer } = await supabase.from("tg_customers").select("telegram_id").eq("id", peer.customer_id).single();
          if (customer) {
            await sendTelegramMessage(
              customer.telegram_id,
              `🎁 Your peer <b>${renewed.peer_name}</b> was extended until <b>${new Date(renewed.expires_at).toLocaleDateString("en-US")}</b>.`
            );
          }
        }
        return NextResponse.json({ peer: renewed });
      }

      case "disableCustomerPeer": {
        if (!data.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        const { data: peer } = await supabase.from("tg_customer_peers").select("*").eq("id", data.id).single();
        if (!peer) return NextResponse.json({ error: "Peer not found" }, { status: 404 });
        await deactivateCustomerPeer({ supabase, peer: peer as TgCustomerPeer, status: "disabled" });
        return NextResponse.json({ success: true });
      }

      case "enableCustomerPeer": {
        if (!data.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        const { data: peer } = await supabase.from("tg_customer_peers").select("*").eq("id", data.id).single();
        if (!peer) return NextResponse.json({ error: "Peer not found" }, { status: 404 });
        if (new Date(peer.expires_at).getTime() < Date.now()) {
          return NextResponse.json({ error: "Peer is expired — use Extend instead" }, { status: 400 });
        }
        // re-agrega/enable-a en el servidor sin tocar la fecha de expiración
        await reactivateCustomerPeerOnServer(supabase, peer as TgCustomerPeer);
        await supabase.from("tg_customer_peers").update({ status: "active" }).eq("id", peer.id);
        return NextResponse.json({ success: true });
      }

      case "deleteCustomerPeer": {
        if (!data.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        const { data: peer } = await supabase.from("tg_customer_peers").select("*").eq("id", data.id).single();
        if (!peer) return NextResponse.json({ error: "Peer not found" }, { status: 404 });

        // sacar del servidor (Linux: remove SSH, MikroTik: delete)
        await removeCustomerPeerFromServer(supabase, peer as TgCustomerPeer);
        if (peer.linux_peer_id) {
          await supabase.from("linux_peers").delete().eq("id", peer.linux_peer_id);
        }
        const { error } = await supabase.from("tg_customer_peers").delete().eq("id", peer.id);
        if (error) throw new Error(error.message);

        await logActivity({
          supabase: authClient,
          userId: user.id,
          routerId: peer.router_id,
          action: "delete",
          entityType: "peer",
          entityId: peer.id,
          entityName: peer.peer_name,
          details: { telegram_customer_peer: true },
        });
        return NextResponse.json({ success: true });
      }

      /* ================= PAGOS ================= */
      case "listPayments": {
        const { data: payments, error } = await supabase
          .from("tg_payments")
          .select("*, tg_customers(telegram_id, username, first_name), tg_plans(name)")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw new Error(error.message);
        return NextResponse.json({ payments });
      }

      /* ================= AUXILIARES (formularios) ================= */
      case "listRouters": {
        const { data: routers, error } = await supabase
          .from("routers")
          .select("id, name, host, connection_type, wg_interface")
          .order("name");
        if (error) throw new Error(error.message);
        return NextResponse.json({ routers });
      }

      case "listPublicIps": {
        if (!data.routerId) return NextResponse.json({ error: "Missing routerId" }, { status: 400 });
        const { data: ips, error } = await supabase
          .from("public_ips")
          .select("id, public_ip, ip_number, internal_subnet, enabled, restricted, wg_interface, for_sale")
          .eq("router_id", data.routerId)
          .order("ip_number");
        if (error) throw new Error(error.message);
        return NextResponse.json({ ips });
      }

      case "setIpForSale": {
        const { id, forSale } = data;
        if (!id) return NextResponse.json({ error: "Missing ip id" }, { status: 400 });
        const { error } = await supabase
          .from("public_ips")
          .update({ for_sale: Boolean(forSale) })
          .eq("id", id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[TgAdmin] Action ${action} failed:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
