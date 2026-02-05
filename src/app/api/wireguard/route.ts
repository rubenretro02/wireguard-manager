import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { MikroTikClient, DEMO_INTERFACES, DEMO_PEERS } from "@/lib/mikrotik";
import type { ConnectionType } from "@/lib/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { action, routerId, data } = body;

  console.log(`[WireGuard API] Action: ${action}, RouterId: ${routerId}`);

  if (routerId === "demo") return handleDemoMode(action, data);

  const { data: router, error: routerError } = await supabase.from("routers").select("*").eq("id", routerId).single();
  if (routerError || !router) {
    console.error("[WireGuard API] Router not found:", routerError);
    return NextResponse.json({ error: "Router not found" }, { status: 404 });
  }

  const connectionType: ConnectionType = router.connection_type || "api";
  console.log(`[WireGuard API] Connecting to ${router.host}:${connectionType === "api" ? router.api_port : router.port} using ${connectionType}`);

  const client = new MikroTikClient({
    host: router.host,
    port: router.port || 443,
    apiPort: router.api_port || 8728,
    username: router.username,
    password: router.password,
    useSsl: router.use_ssl ?? false,
    connectionType: connectionType,
  });

  try {
    switch (action) {
      case "getInterfaces": {
        const interfaces = await client.getWireGuardInterfaces();
        console.log(`[WireGuard API] Got ${interfaces.length} interfaces`);
        return NextResponse.json({ interfaces });
      }
      case "getPeers": {
        const peers = await client.getWireGuardPeers();
        console.log(`[WireGuard API] Got ${peers.length} peers`);
        return NextResponse.json({ peers });
      }
      case "createPeer": {
        console.log("[WireGuard API] Creating peer with data:", JSON.stringify(data, null, 2));
        try {
          const peer = await client.createWireGuardPeer(data);
          console.log("[WireGuard API] Peer created successfully:", peer[".id"]);
          return NextResponse.json({ peer });
        } catch (createErr) {
          const createErrMsg = createErr instanceof Error ? createErr.message : "Unknown error";
          console.error("[WireGuard API] Failed to create peer:", createErrMsg);
          return NextResponse.json({ error: `Failed to create peer: ${createErrMsg}` }, { status: 500 });
        }
      }
      case "deletePeer": {
        await client.deleteWireGuardPeer(data.id);
        return NextResponse.json({ success: true });
      }
      case "enablePeer": {
        await client.enableWireGuardPeer(data.id);
        return NextResponse.json({ success: true });
      }
      case "disablePeer": {
        await client.disableWireGuardPeer(data.id);
        return NextResponse.json({ success: true });
      }
      case "testConnection": {
        console.log(`[WireGuard API] Testing connection to ${router.host}...`);
        try {
          const connected = await client.testConnection();
          console.log(`[WireGuard API] Connection test result: ${connected}`);
          return NextResponse.json({ connected });
        } catch (testErr) {
          const testErrMsg = testErr instanceof Error ? testErr.message : "Unknown error";
          console.error(`[WireGuard API] Connection test failed:`, testErrMsg);
          return NextResponse.json({ connected: false, error: testErrMsg });
        }
      }
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Operation failed";
    console.error(`[WireGuard API] Error (${connectionType}):`, errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

function handleDemoMode(action: string, data: Record<string, unknown>) {
  switch (action) {
    case "getInterfaces":
      return NextResponse.json({ interfaces: DEMO_INTERFACES });
    case "getPeers":
      return NextResponse.json({ peers: DEMO_PEERS });
    case "createPeer":
      return NextResponse.json({ peer: { ".id": `*${Date.now()}`, ...data, disabled: false, rx: 0, tx: 0 } });
    case "deletePeer":
    case "enablePeer":
    case "disablePeer":
      return NextResponse.json({ success: true });
    case "testConnection":
      return NextResponse.json({ connected: true });
    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
}
