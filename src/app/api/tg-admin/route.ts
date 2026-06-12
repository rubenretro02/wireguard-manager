import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity-logger";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  buildLinuxClient,
  buildMikroTikClient,
  deactivateCustomerPeer,
  getServiceClient,
  reactivateCustomerPeerOnServer,
  removeCustomerPeerFromServer,
  renewCustomerPeer,
  type TgCustomerPeer,
} from "@/lib/tg-store";
import { botForCustomerType, getMiniAppUrl } from "@/lib/telegram";
import type { Router } from "@/lib/types";

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
        const { name, description, price_usd, duration_days, router_id, public_ip_id, enabled, sort_order, is_dedicated_ip } = data;
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
            is_dedicated_ip: Boolean(is_dedicated_ip),
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
        const allowed = ["name", "description", "price_usd", "duration_days", "router_id", "public_ip_id", "enabled", "sort_order", "is_dedicated_ip"];
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

      case "setCustomerType": {
        const { id, type } = data;
        if (!id || !["client", "agent"].includes(type)) {
          return NextResponse.json({ error: "Invalid customer type" }, { status: 400 });
        }
        const { error } = await supabase
          .from("tg_customers")
          .update({ customer_type: type })
          .eq("id", id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ success: true });
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
          const { data: customer } = await supabase.from("tg_customers").select("telegram_id, customer_type").eq("id", peer.customer_id).single();
          if (customer) {
            await sendTelegramMessage(
              customer.telegram_id,
              `🎁 Your peer <b>${renewed.peer_name}</b> was extended until <b>${new Date(renewed.expires_at).toLocaleDateString("en-US")}</b>.`,
              {},
              botForCustomerType(customer.customer_type)
            );
          }
        }
        return NextResponse.json({ peer: renewed });
      }

      case "updatePeerRenewal": {
        // Precio/duración de renovación propios de un peer (NULL = usa planes)
        const { id, price, days } = data;
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        const { error } = await supabase
          .from("tg_customer_peers")
          .update({
            renewal_price_usd: price === null || price === "" || price === undefined ? null : Number(price),
            renewal_duration_days: days === null || days === "" || days === undefined ? null : Number(days),
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ success: true });
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

      case "assignPeerToCustomer": {
        // Vincula un peer YA existente en el servidor a un customer de Telegram.
        // El customer podrá verlo en la Mini App, ver su estado y renovarlo solo.
        const { customerId, routerId, publicKey, name, allowedAddress, wgInterface, comment, days, notify, renewalPriceUsd, renewalDurationDays } = data;
        if (!customerId || !routerId || !publicKey || !allowedAddress || !days) {
          return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const { data: customer } = await supabase.from("tg_customers").select("*").eq("id", customerId).single();
        if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

        const { data: assignRouter } = await supabase.from("routers").select("*").eq("id", routerId).single();
        if (!assignRouter) return NextResponse.json({ error: "Server not found" }, { status: 404 });

        // Evitar doble asignación del mismo peer
        const { data: existing } = await supabase
          .from("tg_customer_peers")
          .select("id")
          .eq("router_id", routerId)
          .eq("peer_public_key", publicKey)
          .maybeSingle();
        if (existing) {
          return NextResponse.json({ error: "This peer is already assigned to a customer" }, { status: 400 });
        }

        const isLinux = assignRouter.connection_type === "linux-ssh";
        const effectiveInterface = wgInterface || assignRouter.wg_interface || "wg0";

        // Server pubkey + listen port para armar la config del cliente, y la
        // private key del peer si la conocemos (Linux: linux_peers; MikroTik:
        // el router la guarda cuando el peer se creó desde la app)
        let serverPublicKey = "";
        let listenPort = 13231;
        let privateKey: string | null = null;
        if (isLinux) {
          const client = buildLinuxClient(assignRouter as Router, effectiveInterface);
          const info = await client.getInterfaceInfo();
          if (!info) throw new Error(`Could not read server info for ${effectiveInterface}`);
          serverPublicKey = info.publicKey;
          listenPort = info.listenPort;

          const { data: lp } = await supabase
            .from("linux_peers")
            .select("id, private_key")
            .eq("router_id", routerId)
            .eq("public_key", publicKey)
            .maybeSingle();
          privateKey = lp?.private_key || null;
        } else {
          const client = buildMikroTikClient(assignRouter as Router);
          const interfaces = await client.getWireGuardInterfaces();
          const iface = interfaces.find((i) => i.name === effectiveInterface);
          if (!iface) throw new Error(`Interface ${effectiveInterface} not found on router`);
          serverPublicKey = iface["public-key"];
          listenPort = iface["listen-port"] || 13231;

          const routerPeers = await client.getWireGuardPeers();
          const rp = routerPeers.find((p) => p["public-key"] === publicKey);
          privateKey = rp?.["private-key"] || null;
        }

        // IP pública: comment si es una IP, si no por subnet, si no el host
        const subnet = String(allowedAddress).split("/")[0].split(".").slice(0, 3).join(".");
        let publicIpStr: string | null = null;
        if (comment && /^\d+\.\d+\.\d+\.\d+$/.test(comment)) {
          publicIpStr = comment;
        } else {
          const { data: ipRow } = await supabase
            .from("public_ips")
            .select("public_ip")
            .eq("router_id", routerId)
            .eq("internal_subnet", subnet)
            .maybeSingle();
          publicIpStr = ipRow?.public_ip || assignRouter.host;
        }

        const expiresAt = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);

        const { count: peerCount } = await supabase
          .from("tg_customer_peers")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customerId);

        const { data: assigned, error: assignError } = await supabase
          .from("tg_customer_peers")
          .insert({
            customer_id: customerId,
            plan_id: null,
            router_id: routerId,
            peer_name: name || `peer-${String(publicKey).substring(0, 6)}`,
            display_name: `Peer ${(peerCount || 0) + 1}`,
            peer_public_key: publicKey,
            peer_private_key: privateKey,
            allowed_address: allowedAddress,
            wg_interface: effectiveInterface,
            public_ip: publicIpStr,
            server_public_key: serverPublicKey,
            listen_port: listenPort,
            status: "active",
            expires_at: expiresAt.toISOString(),
            renewal_price_usd: renewalPriceUsd === undefined || renewalPriceUsd === null || renewalPriceUsd === "" ? null : Number(renewalPriceUsd),
            renewal_duration_days: renewalDurationDays === undefined || renewalDurationDays === null || renewalDurationDays === "" ? null : Number(renewalDurationDays),
          })
          .select()
          .single();
        if (assignError || !assigned) throw new Error(assignError?.message || "Failed to assign peer");

        if (notify) {
          let appUrl = "";
          try { appUrl = getMiniAppUrl(); } catch { /* optional */ }
          const isAgentCustomer = customer.customer_type === "agent";
          await sendTelegramMessage(
            customer.telegram_id,
            `🔗 The peer <b>${assigned.peer_name}</b> was linked to your account.\n\nYou can now check its status${isAgentCustomer ? "" : " and renew it"} from the app.${privateKey ? "" : "\n\nNote: to download a fresh config, use <b>Rotate keys</b> in the app."}`,
            appUrl ? { reply_markup: { inline_keyboard: [[{ text: "🚀 Open App", web_app: { url: appUrl } }]] } } : {},
            botForCustomerType(customer.customer_type)
          );
        }

        await logActivity({
          supabase: authClient,
          userId: user.id,
          routerId,
          action: "update",
          entityType: "peer",
          entityId: assigned.id,
          entityName: assigned.peer_name,
          details: { assigned_to_telegram: customer.telegram_id, days },
        });

        return NextResponse.json({ peer: assigned });
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

      case "listForSaleIps": {
        // Todas las IPs marcadas for sale, de todos los servers
        const { data: ips, error } = await supabase
          .from("public_ips")
          .select("id, public_ip, ip_number, internal_subnet, enabled, restricted, for_sale, sale_dedicated, router_id, routers(name)")
          .eq("for_sale", true)
          .order("public_ip");
        if (error) throw new Error(error.message);
        return NextResponse.json({ ips });
      }

      case "listPublicIps": {
        if (!data.routerId) return NextResponse.json({ error: "Missing routerId" }, { status: 400 });
        const { data: ips, error } = await supabase
          .from("public_ips")
          .select("id, public_ip, ip_number, internal_subnet, enabled, restricted, wg_interface, for_sale, sale_dedicated")
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

      case "setIpDedicated": {
        const { id, dedicated } = data;
        if (!id) return NextResponse.json({ error: "Missing ip id" }, { status: 400 });
        const { error } = await supabase
          .from("public_ips")
          .update({ sale_dedicated: Boolean(dedicated) })
          .eq("id", id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ success: true });
      }

      case "unassignPeer": {
        // Quita la asignación al customer SIN tocar el peer en el servidor
        if (!data.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        const { data: peer } = await supabase.from("tg_customer_peers").select("*").eq("id", data.id).single();
        if (!peer) return NextResponse.json({ error: "Peer not found" }, { status: 404 });
        const { error } = await supabase.from("tg_customer_peers").delete().eq("id", peer.id);
        if (error) throw new Error(error.message);
        await logActivity({
          supabase: authClient,
          userId: user.id,
          routerId: peer.router_id,
          action: "update",
          entityType: "peer",
          entityId: peer.id,
          entityName: peer.peer_name,
          details: { telegram_unassigned: true },
        });
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
