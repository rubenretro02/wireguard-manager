import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { MikroTikClient, clearClientCacheForRouter } from "@/lib/mikrotik";
import type { ConnectionType } from "@/lib/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { action, routerId, data, forceRefresh } = body;

  console.log(`[WireGuard API] Action: ${action}, RouterId: ${routerId}, ForceRefresh: ${forceRefresh || false}`);

  // No demo mode - require real router
  if (!routerId || routerId === "demo") {
    return NextResponse.json({ error: "Please select a router" }, { status: 400 });
  }

  const { data: router, error: routerError } = await supabase.from("routers").select("*").eq("id", routerId).single();
  if (routerError || !router) {
    console.error("[WireGuard API] Router not found:", routerError);
    return NextResponse.json({ error: "Router not found" }, { status: 404 });
  }

  // Clear cache if force refresh is requested
  if (forceRefresh) {
    console.log(`[WireGuard API] Force refresh requested, clearing cache for router ${router.host}`);
    await clearClientCacheForRouter(router.host, router.api_port || 8728, router.username);
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
        if (peers.length > 0) {
          const addresses = peers.slice(0, 5).map(p => p["allowed-address"]);
          console.log(`[WireGuard API] Sample addresses: ${addresses.join(", ")}`);
        }
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
      case "createPeerSimplified": {
        // Simplified peer creation: user selects public IP, system auto-assigns internal IP
        const { publicIpId, interface: wgInterface, name } = data;

        if (!publicIpId || !wgInterface || !name) {
          return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Get the public IP record
        const { data: publicIp, error: publicIpError } = await supabase
          .from("public_ips")
          .select("*")
          .eq("id", publicIpId)
          .single();

        if (publicIpError || !publicIp) {
          return NextResponse.json({ error: "Public IP not found" }, { status: 404 });
        }

        // Get all existing peers to find used IPs in this subnet
        const existingPeers = await client.getWireGuardPeers();
        const subnetPrefix = `${publicIp.internal_subnet}.`;

        // Find used IPs in this subnet (last octet)
        const usedIps = new Set<number>();
        for (const peer of existingPeers) {
          const addr = peer["allowed-address"]?.split("/")[0];
          if (addr && addr.startsWith(subnetPrefix)) {
            const lastOctet = parseInt(addr.split(".")[3], 10);
            if (!isNaN(lastOctet)) {
              usedIps.add(lastOctet);
            }
          }
        }

        // Find next available IP (starting from 2, as 1 is usually the gateway)
        let nextIp = 2;
        while (usedIps.has(nextIp) && nextIp < 255) {
          nextIp++;
        }

        if (nextIp >= 255) {
          return NextResponse.json({ error: "No available IPs in this subnet" }, { status: 400 });
        }

        const allowedAddress = `${publicIp.internal_subnet}.${nextIp}/32`;
        const comment = publicIp.public_ip; // Store public IP in comment

        console.log("[WireGuard API] Creating simplified peer:", {
          interface: wgInterface,
          name,
          allowedAddress,
          comment
        });

        try {
          const peer = await client.createWireGuardPeer({
            interface: wgInterface,
            name,
            "allowed-address": allowedAddress,
            comment,
          });
          console.log("[WireGuard API] Simplified peer created successfully:", peer[".id"]);
          return NextResponse.json({
            peer,
            assignedIp: allowedAddress,
            publicIp: publicIp.public_ip
          });
        } catch (createErr) {
          const createErrMsg = createErr instanceof Error ? createErr.message : "Unknown error";
          console.error("[WireGuard API] Failed to create simplified peer:", createErrMsg);
          return NextResponse.json({ error: `Failed to create peer: ${createErrMsg}` }, { status: 500 });
        }
      }
      case "updatePeer": {
        console.log("[WireGuard API] Updating peer:", data.id);
        try {
          await client.updateWireGuardPeer(data.id, { name: data.name });
          console.log("[WireGuard API] Peer updated successfully");
          return NextResponse.json({ success: true });
        } catch (updateErr) {
          const updateErrMsg = updateErr instanceof Error ? updateErr.message : "Unknown error";
          console.error("[WireGuard API] Failed to update peer:", updateErrMsg);
          return NextResponse.json({ error: `Failed to update peer: ${updateErrMsg}` }, { status: 500 });
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
