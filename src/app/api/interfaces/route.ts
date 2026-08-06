import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { buildLinuxClient } from "@/lib/tg-store";
import { publicKeyFromPrivate } from "@/lib/wireguard-keys";
import type { Router } from "@/lib/types";

// ssh2 needs native modules — not available on Edge
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const admin = createAdminClient();
  if (!admin) return { error: NextResponse.json({ error: "Service role not configured" }, { status: 500 }) };

  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role?.toLowerCase() !== "admin") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { admin };
}

/** GET — the saved interface backup (one row per host+interface). */
export async function GET() {
  const { admin, error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await admin
    .from("wg_interfaces")
    .select("*")
    .order("host")
    .order("interface_name");

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ interfaces: data || [] });
}

/**
 * POST { action: "sync", routerId? } — reads /etc/wireguard/*.conf on every
 * linux-ssh server (or just one) and upserts name/port/keys/address. This is
 * what makes the interface private keys survive a server format.
 */
export async function POST(request: Request) {
  const { admin, error } = await requireAdmin();
  if (error) return error;

  const { action, routerId } = await request.json();
  if (action !== "sync") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  let query = admin.from("routers").select("*").eq("connection_type", "linux-ssh");
  if (routerId) query = query.eq("id", routerId);
  const { data: routers } = await query;

  // Several router rows can point at the same host (one config per interface):
  // read each physical host only once.
  const byHost = new Map<string, Router>();
  for (const r of (routers || []) as Router[]) if (!byHost.has(r.host)) byHost.set(r.host, r);

  const results: Array<{ host: string; name: string; ok: boolean; interfaces?: number; error?: string }> = [];
  let saved = 0;

  for (const router of byHost.values()) {
    try {
      const client = buildLinuxClient(router);
      const configs = await client.getInterfaceConfigs();

      for (const cfg of configs) {
        const row = {
          router_id: router.id,
          host: router.host,
          interface_name: cfg.name,
          listen_port: cfg.listenPort,
          private_key: cfg.privateKey,
          public_key: cfg.privateKey ? publicKeyFromPrivate(cfg.privateKey) : null,
          address: cfg.address,
          running: cfg.running,
          peer_count: cfg.peerCount,
          source: "sync",
          last_synced_at: new Date().toISOString(),
        };
        const { error: upsertError } = await admin
          .from("wg_interfaces")
          .upsert(row, { onConflict: "host,interface_name" });
        if (upsertError) throw new Error(upsertError.message);
        saved++;
      }
      results.push({ host: router.host, name: router.name, ok: true, interfaces: configs.length });
    } catch (err) {
      results.push({
        host: router.host,
        name: router.name,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ saved, servers: results });
}
