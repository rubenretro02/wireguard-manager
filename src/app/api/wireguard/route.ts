import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { MikroTikClient, clearClientCacheForRouter } from "@/lib/mikrotik";
import { LinuxWireGuardClient } from "@/lib/linux-wireguard";
import { logActivity } from "@/lib/activity-logger";
import type { ConnectionType, AuthMethod } from "@/lib/types";

// Force Node.js runtime for ssh2 native modules
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { action, routerId, data, forceRefresh } = body;

  console.log(`[WireGuard API] Action: ${action}, RouterId: ${routerId}, ForceRefresh: ${forceRefresh || false}`);

  // Get user profile with capabilities for permission checks
  const { data: userProfile } = await supabase
    .from("profiles")
    .select("role, capabilities")
    .eq("id", user.id)
    .single();

  const isAdmin = userProfile?.role === "admin";
  const canDelete = isAdmin || userProfile?.capabilities?.can_delete === true;

  // Check delete permission for delete actions
  if (action === "deletePeer" && !canDelete) {
    return NextResponse.json({ error: "You don't have permission to delete peers" }, { status: 403 });
  }

  // No demo mode - require real router
  if (!routerId || routerId === "demo") {
    return NextResponse.json({ error: "Please select a router" }, { status: 400 });
  }

  const { data: router, error: routerError } = await supabase.from("routers").select("*").eq("id", routerId).single();
  if (routerError || !router) {
    console.error("[WireGuard API] Router not found:", routerError);
    return NextResponse.json({ error: "Router not found" }, { status: 404 });
  }

  const connectionType: ConnectionType = router.connection_type || "api";
  const isLinux = connectionType === "linux-ssh";

  // =====================================================
  // LINUX SSH HANDLING
  // =====================================================
  if (isLinux) {
    console.log(`[WireGuard API] Using Linux SSH connection to ${router.host}:${router.ssh_port || 22}`);

    const linuxClient = new LinuxWireGuardClient({
      host: router.host,
      port: router.ssh_port || 22,
      username: router.username,
      password: router.password,
      privateKey: router.ssh_key || undefined,
      authMethod: (router.ssh_auth_method as AuthMethod) || "password",
      wgInterface: router.wg_interface || "wg1",
      outInterface: router.out_interface || "ens192",
      publicIpPrefix: router.public_ip_prefix || undefined,
      internalPrefix: router.internal_prefix || "10.10",
    });

    try {
      switch (action) {
        case "testConnection": {
          const result = await linuxClient.testConnection();
          console.log(`[WireGuard API] Linux connection test result:`, result);
          return NextResponse.json({
            connected: result.success,
            error: result.error,
            details: result.details,
            sudoRequired: result.sudoRequired
          });
        }

        case "getInterfaces": {
          const info = await linuxClient.getInterfaceInfo();
          if (info) {
            return NextResponse.json({
              interfaces: [{
                ".id": "*1",
                name: router.wg_interface || "wg1",
                "public-key": info.publicKey,
                "listen-port": info.listenPort,
                disabled: false,
                running: true,
              }]
            });
          }
          return NextResponse.json({ interfaces: [] });
        }

        case "getPeers": {
          // Get live peers from WireGuard
          const livePeers = await linuxClient.getPeers();

          // Get stored peer metadata from database
          const { data: storedPeers } = await supabase
            .from("linux_peers")
            .select("*")
            .eq("router_id", routerId);

          interface StoredLinuxPeer {
            id: string;
            public_key: string;
            private_key?: string;
            name?: string;
            comment?: string;
            public_ip?: string;
            allowed_ips?: string;
            disabled?: boolean;
            created_by_user_id?: string;
            created_by_email?: string;
          }

          const storedPeersMap = new Map<string, StoredLinuxPeer>(
            (storedPeers || []).map((p: StoredLinuxPeer) => [p.public_key, p])
          );

          // Merge live peers with stored metadata
          const formattedPeers = livePeers.map((peer, index) => {
            const stored = storedPeersMap.get(peer.publicKey) as StoredLinuxPeer | undefined;
            return {
              ".id": stored?.id || `*${index + 1}`,
              "public-key": peer.publicKey,
              "private-key": stored?.private_key || undefined,
              "allowed-address": peer.allowedIps,
              "current-endpoint-address": peer.endpoint?.split(":")[0],
              "current-endpoint-port": peer.endpoint?.split(":")[1],
              "last-handshake": peer.latestHandshake,
              rx: peer.transfer?.rx,
              tx: peer.transfer?.tx,
              interface: router.wg_interface || "wg1",
              disabled: false,
              name: stored?.name || "",
              comment: stored?.comment || stored?.public_ip || "",
            };
          });

          // Also include disabled peers (stored but not in WireGuard)
          const livePeerKeys = new Set(livePeers.map(p => p.publicKey));
          const disabledPeers = (storedPeers || [])
            .filter((p: any) => p.disabled && !livePeerKeys.has(p.public_key))
            .map((stored: any) => ({
              ".id": stored.id,
              "public-key": stored.public_key,
              "private-key": stored.private_key || undefined,
              "allowed-address": stored.allowed_ips,
              "current-endpoint-address": undefined,
              "current-endpoint-port": undefined,
              "last-handshake": undefined,
              rx: 0,
              tx: 0,
              interface: router.wg_interface || "wg1",
              disabled: true,
              name: stored.name || "",
              comment: stored.comment || stored.public_ip || "",
            }));

          return NextResponse.json({ peers: [...formattedPeers, ...disabledPeers] });
        }

        case "createMikroTikRules": {
          const { ip_number } = data;
          if (!ip_number) {
            return NextResponse.json({ error: "Missing ip_number" }, { status: 400 });
          }

          const results = await linuxClient.createMikroTikRules(
            ip_number,
            router.public_ip_mask || "/24"
          );

          if (results.wg_ip_created || results.ip_address_created || results.nat_rule_created) {
            await supabase
              .from("public_ips")
              .update({
                wg_ip_created: results.wg_ip_created,
                ip_address_created: results.ip_address_created,
                nat_rule_created: results.nat_rule_created,
              })
              .eq("router_id", routerId)
              .eq("ip_number", ip_number);
          }

          return NextResponse.json({
            success: results.errors.length === 0,
            ...results,
          });
        }

        case "deleteMikroTikRules": {
          const { ip_number: delIpNumber } = data;
          if (!delIpNumber) {
            return NextResponse.json({ error: "Missing ip_number" }, { status: 400 });
          }

          const results = await linuxClient.deleteMikroTikRules(delIpNumber);
          return NextResponse.json({
            success: results.errors.length === 0,
            ...results,
          });
        }

        case "createPeerSimplified": {
          // Simplified peer creation for Linux: user selects public IP, system auto-assigns internal IP
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

          // Get next available IP in the subnet
          const nextIp = await linuxClient.getNextAvailableIp(publicIp.ip_number);
          if (!nextIp) {
            return NextResponse.json({ error: "No available IPs in this subnet" }, { status: 400 });
          }

          const allowedAddress = `${publicIp.internal_subnet}.${nextIp}/32`;

          // Generate keys for the peer
          const { generateKeyPair } = await import("@/lib/wireguard-keys");
          const keyPair = generateKeyPair();

          console.log("[WireGuard API] Creating Linux peer:", {
            interface: wgInterface,
            name,
            allowedAddress,
            publicIp: publicIp.public_ip
          });

          try {
            // Add peer to WireGuard
            const success = await linuxClient.addPeer(keyPair.publicKey, allowedAddress);

            if (!success) {
              return NextResponse.json({ error: "Failed to add peer to WireGuard" }, { status: 500 });
            }

            // Store peer data in linux_peers table for persistence
            const { data: storedPeer, error: storeError } = await supabase
              .from("linux_peers")
              .insert({
                router_id: routerId,
                public_key: keyPair.publicKey,
                private_key: keyPair.privateKey,
                allowed_ips: allowedAddress,
                name: name,
                comment: publicIp.public_ip,
                public_ip: publicIp.public_ip,
                disabled: false,
                created_by_user_id: user.id,
                created_by_email: user.email,
              })
              .select()
              .single();

            if (storeError) {
              console.warn("[WireGuard API] Failed to store peer metadata:", storeError);
            }

            // Log activity
            await logActivity({
              supabase,
              userId: user.id,
              routerId,
              action: "create",
              entityType: "peer",
              entityId: storedPeer?.id || keyPair.publicKey.substring(0, 8),
              entityName: name,
              details: { allowedAddress, publicIp: publicIp.public_ip, interface: wgInterface }
            });

            console.log("[WireGuard API] Linux peer created successfully");

            return NextResponse.json({
              peer: {
                ".id": storedPeer?.id || `*${Date.now()}`,
                name,
                "public-key": keyPair.publicKey,
                "private-key": keyPair.privateKey,
                "allowed-address": allowedAddress,
                interface: wgInterface,
                comment: publicIp.public_ip,
                disabled: false,
              },
              assignedIp: allowedAddress,
              publicIp: publicIp.public_ip
            });
          } catch (createErr) {
            const createErrMsg = createErr instanceof Error ? createErr.message : "Unknown error";
            console.error("[WireGuard API] Failed to create Linux peer:", createErrMsg);
            return NextResponse.json({ error: `Failed to create peer: ${createErrMsg}` }, { status: 500 });
          }
        }

        case "createPeer": {
          console.log("[WireGuard API] Creating Linux peer with data:", JSON.stringify(data, null, 2));
          try {
            const { "public-key": publicKey, "allowed-address": allowedAddress } = data;

            if (!publicKey || !allowedAddress) {
              return NextResponse.json({ error: "Missing public-key or allowed-address" }, { status: 400 });
            }

            const success = await linuxClient.addPeer(publicKey, allowedAddress);

            if (!success) {
              return NextResponse.json({ error: "Failed to add peer" }, { status: 500 });
            }

            console.log("[WireGuard API] Linux peer created successfully");
            return NextResponse.json({
              peer: {
                ".id": `*${Date.now()}`,
                ...data,
              }
            });
          } catch (createErr) {
            const createErrMsg = createErr instanceof Error ? createErr.message : "Unknown error";
            console.error("[WireGuard API] Failed to create Linux peer:", createErrMsg);
            return NextResponse.json({ error: `Failed to create peer: ${createErrMsg}` }, { status: 500 });
          }
        }

        case "deletePeer": {
          console.log("[WireGuard API] Deleting Linux peer:", data.id);
          try {
            // For Linux, we need the public key to delete
            // The data.id might be the public key or we need to find it
            const publicKey = data["public-key"] || data.publicKey || data.id;

            if (!publicKey || publicKey.startsWith("*")) {
              return NextResponse.json({ error: "Public key required to delete peer on Linux" }, { status: 400 });
            }

            const success = await linuxClient.removePeer(publicKey);

            if (!success) {
              return NextResponse.json({ error: "Failed to remove peer" }, { status: 500 });
            }

            // Also delete from linux_peers table
            await supabase
              .from("linux_peers")
              .delete()
              .eq("router_id", routerId)
              .eq("public_key", publicKey);

            // Log activity
            await logActivity({
              supabase,
              userId: user.id,
              routerId,
              action: "delete",
              entityType: "peer",
              entityId: publicKey.substring(0, 8),
              entityName: data.name || null,
              details: {}
            });

            console.log("[WireGuard API] Linux peer deleted");
            return NextResponse.json({ success: true });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            console.error("[WireGuard API] Failed to delete Linux peer:", errMsg);
            return NextResponse.json({ error: errMsg }, { status: 500 });
          }
        }

        case "disablePeer": {
          // Disable = remove from WireGuard but keep in database
          console.log("[WireGuard API] Disabling Linux peer:", data.id);
          try {
            const publicKey = data["public-key"] || data.publicKey;

            if (!publicKey) {
              // Try to get public key from database using ID
              const { data: storedPeer } = await supabase
                .from("linux_peers")
                .select("public_key")
                .eq("id", data.id)
                .single();

              if (!storedPeer) {
                return NextResponse.json({ error: "Peer not found in database" }, { status: 404 });
              }

              // Remove from WireGuard
              await linuxClient.removePeer(storedPeer.public_key);

              // Update database to mark as disabled
              await supabase
                .from("linux_peers")
                .update({ disabled: true })
                .eq("id", data.id);
            } else {
              // Remove from WireGuard
              await linuxClient.removePeer(publicKey);

              // Update database to mark as disabled
              await supabase
                .from("linux_peers")
                .update({ disabled: true })
                .eq("router_id", routerId)
                .eq("public_key", publicKey);
            }

            // Log activity
            await logActivity({
              supabase,
              userId: user.id,
              routerId,
              action: "disable",
              entityType: "peer",
              entityId: data.id || publicKey?.substring(0, 8),
              entityName: data.name || null,
              details: {}
            });

            console.log("[WireGuard API] Linux peer disabled (removed from WG, kept in DB)");
            return NextResponse.json({ success: true });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            console.error("[WireGuard API] Failed to disable Linux peer:", errMsg);
            return NextResponse.json({ error: errMsg }, { status: 500 });
          }
        }

        case "enablePeer": {
          // Enable = add peer back to WireGuard from database
          console.log("[WireGuard API] Enabling Linux peer:", data.id);
          try {
            // Get peer data from database
            let storedPeer;

            if (data.id && !data.id.startsWith("*")) {
              const { data: peer } = await supabase
                .from("linux_peers")
                .select("*")
                .eq("id", data.id)
                .single();
              storedPeer = peer;
            } else if (data["public-key"] || data.publicKey) {
              const publicKey = data["public-key"] || data.publicKey;
              const { data: peer } = await supabase
                .from("linux_peers")
                .select("*")
                .eq("router_id", routerId)
                .eq("public_key", publicKey)
                .single();
              storedPeer = peer;
            }

            if (!storedPeer) {
              return NextResponse.json({ error: "Peer not found in database. Cannot enable." }, { status: 404 });
            }

            // Add peer back to WireGuard
            const success = await linuxClient.addPeer(storedPeer.public_key, storedPeer.allowed_ips);

            if (!success) {
              return NextResponse.json({ error: "Failed to add peer to WireGuard" }, { status: 500 });
            }

            // Update database to mark as enabled
            await supabase
              .from("linux_peers")
              .update({ disabled: false })
              .eq("id", storedPeer.id);

            // Log activity
            await logActivity({
              supabase,
              userId: user.id,
              routerId,
              action: "enable",
              entityType: "peer",
              entityId: storedPeer.id,
              entityName: storedPeer.name || null,
              details: {}
            });

            console.log("[WireGuard API] Linux peer enabled (added back to WG)");
            return NextResponse.json({ success: true });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            console.error("[WireGuard API] Failed to enable Linux peer:", errMsg);
            return NextResponse.json({ error: errMsg }, { status: 500 });
          }
        }

        case "updatePeer": {
          // Update peer name/comment in database
          console.log("[WireGuard API] Updating Linux peer:", data.id);
          try {
            const updates: Record<string, unknown> = {};
            if (data.name !== undefined) updates.name = data.name;
            if (data.comment !== undefined) updates.comment = data.comment;
            if (data["allowed-address"] !== undefined) updates.allowed_ips = data["allowed-address"];

            if (Object.keys(updates).length === 0) {
              return NextResponse.json({ success: true, message: "No updates to apply" });
            }

            // Update in database
            if (data.id && !data.id.startsWith("*")) {
              await supabase
                .from("linux_peers")
                .update(updates)
                .eq("id", data.id);
            } else if (data["public-key"] || data.publicKey) {
              const publicKey = data["public-key"] || data.publicKey;
              await supabase
                .from("linux_peers")
                .update(updates)
                .eq("router_id", routerId)
                .eq("public_key", publicKey);
            }

            // If allowed-address changed and peer is enabled, update in WireGuard
            if (data["allowed-address"] && data["public-key"]) {
              // Remove old peer and add with new address
              await linuxClient.removePeer(data["public-key"]);
              await linuxClient.addPeer(data["public-key"], data["allowed-address"]);
            }

            console.log("[WireGuard API] Linux peer updated");
            return NextResponse.json({ success: true });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            console.error("[WireGuard API] Failed to update Linux peer:", errMsg);
            return NextResponse.json({ error: errMsg }, { status: 500 });
          }
        }

        case "_oldEnableDisable": {
          // Old handler - no longer used
          console.log(`[WireGuard API] Old ${action} handler called`);
          return NextResponse.json({
            error: "Use the new enable/disable handlers",
            success: false
          }, { status: 400 });
        }

        case "getResources": {
          // Get Linux system resources
          const resources = await linuxClient.getResources();
          return NextResponse.json({
            success: true,
            resources: {
              cpuLoad: Math.round(resources.cpuLoad),
              freeMemory: resources.freeMemory,
              totalMemory: resources.totalMemory,
              uptime: resources.uptime,
              version: resources.version,
              boardName: resources.hostname,
              architecture: "Linux",
              cpuCount: "N/A",
              cpuFrequency: "N/A",
            }
          });
        }

        case "getSystemInterfaces": {
          // Get network and WireGuard interfaces from Linux
          console.log("[WireGuard API] Getting interfaces from Linux...");
          try {
            const [networkInterfaces, wgInterfaces] = await Promise.all([
              linuxClient.getNetworkInterfaces(),
              linuxClient.getWireGuardInterfaces(),
            ]);

            return NextResponse.json({
              success: true,
              networkInterfaces,
              wgInterfaces,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            console.error("[WireGuard API] Failed to get interfaces:", errMsg);
            return NextResponse.json({
              success: false,
              error: errMsg,
              networkInterfaces: [],
              wgInterfaces: [],
            });
          }
        }

        case "getNatRuleTraffic": {
          // Get NAT traffic statistics from iptables
          console.log("[WireGuard API] Getting NAT traffic from Linux iptables...");
          try {
            const traffic = await linuxClient.getNatTraffic();
            const natRules = await linuxClient.getNatRules();

            return NextResponse.json({
              traffic: traffic,
              totalRules: natRules.length,
            });
          } catch (err) {
            console.error("[WireGuard API] Failed to get NAT traffic:", err);
            return NextResponse.json({
              traffic: [],
              totalRules: 0,
            });
          }
        }

        case "importPublicIps": {
          // For Linux, import based on iptables SNAT rules
          console.log("[WireGuard API] Importing public IPs from Linux iptables...");

          // This is a basic implementation - could be improved
          const natRules = await linuxClient.getNatRules();
          const internalPrefix = router.internal_prefix || "10.10";
          const publicIpPrefix = router.public_ip_prefix || "";

          const detectedIps: Array<{
            ip_number: number;
            public_ip: string;
            internal_subnet: string;
            has_nat_rule: boolean;
            has_ip_address: boolean;
            has_wg_ip: boolean;
          }> = [];

          // Parse NAT rules to find configured IPs
          for (const rule of natRules) {
            if (rule.target && publicIpPrefix && rule.target.startsWith(publicIpPrefix)) {
              const parts = rule.target.split(".");
              if (parts.length === 4) {
                const ipNumber = parseInt(parts[3], 10);
                if (!isNaN(ipNumber)) {
                  detectedIps.push({
                    ip_number: ipNumber,
                    public_ip: rule.target,
                    internal_subnet: `${internalPrefix}.${ipNumber}`,
                    has_nat_rule: true,
                    has_ip_address: true, // Assume if NAT exists, IP exists
                    has_wg_ip: true, // Assume WG IP exists
                  });
                }
              }
            }
          }

          // Get already saved IPs
          const { data: existingIps } = await supabase
            .from("public_ips")
            .select("ip_number")
            .eq("router_id", routerId);

          const existingIpNumbers = new Set((existingIps || []).map((ip: { ip_number: number }) => ip.ip_number));
          const newDetectedIps = detectedIps.filter(ip => !existingIpNumbers.has(ip.ip_number));

          return NextResponse.json({
            detectedIps: newDetectedIps,
            partiallyConfiguredIps: [],
            alreadySavedCount: detectedIps.length - newDetectedIps.length,
          });
        }

        case "saveImportedIps": {
          // Save detected IPs to database (same logic as MikroTik)
          const { ips } = data;
          if (!ips || !Array.isArray(ips) || ips.length === 0) {
            return NextResponse.json({ error: "No IPs to save" }, { status: 400 });
          }

          const savedIps = [];
          const errors = [];

          for (const ip of ips) {
            try {
              const { data: savedIp, error } = await supabase
                .from("public_ips")
                .insert({
                  router_id: routerId,
                  ip_number: ip.ip_number,
                  public_ip: ip.public_ip,
                  internal_subnet: ip.internal_subnet,
                  enabled: true,
                  nat_rule_created: ip.has_nat_rule || false,
                  ip_address_created: ip.has_ip_address || false,
                  wg_ip_created: ip.has_wg_ip || false,
                })
                .select()
                .single();

              if (error) {
                if (error.code !== "23505") {
                  errors.push({ ip: ip.public_ip, error: error.message });
                }
              } else {
                savedIps.push(savedIp);
              }
            } catch (saveErr) {
              const errMsg = saveErr instanceof Error ? saveErr.message : "Unknown error";
              errors.push({ ip: ip.public_ip, error: errMsg });
            }
          }

          return NextResponse.json({
            success: true,
            savedCount: savedIps.length,
            errors,
            savedIps,
          });
        }

        default:
          return NextResponse.json({ error: `Action '${action}' not fully supported for Linux yet` }, { status: 400 });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Linux operation failed";
      console.error(`[WireGuard API] Linux error:`, errorMessage);
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
  }

  // =====================================================
  // MIKROTIK HANDLING
  // =====================================================

  // Clear cache if force refresh is requested
  if (forceRefresh) {
    console.log(`[WireGuard API] Force refresh requested, clearing cache for router ${router.host}`);
    await clearClientCacheForRouter(router.host, router.api_port || 8728, router.username);
  }

  // Determine actual connection type and ports based on connection_type
  const isApiConnection = connectionType === "api" || connectionType === "api-ssl";
  const useApiSsl = connectionType === "api-ssl";
  const apiPort = connectionType === "api-ssl" ? (router.api_port || 8729) : (router.api_port || 8728);
  const restPort = connectionType === "rest-8443" ? (router.port || 8443) : (router.port || 443);

  // Map new connection types to base types for MikroTikClient
  const baseConnectionType = isApiConnection ? "api" : "rest";

  console.log(`[WireGuard API] Connecting to ${router.host}:${isApiConnection ? apiPort : restPort} using ${connectionType} (base: ${baseConnectionType})`);

  const client = new MikroTikClient({
    host: router.host,
    port: restPort,
    apiPort: apiPort,
    username: router.username,
    password: router.password,
    useSsl: useApiSsl,
    connectionType: baseConnectionType as "api" | "rest",
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

          // Log activity
          await logActivity({
            supabase,
            userId: user.id,
            routerId,
            action: "create",
            entityType: "peer",
            entityId: peer[".id"],
            entityName: name,
            details: { allowedAddress, publicIp: publicIp.public_ip, interface: wgInterface }
          });

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
      case "getNatRuleTraffic": {
        // Get traffic statistics from NAT rules
        console.log("[WireGuard API] Getting NAT rule traffic...");
        try {
          const natRules = await client.executeCommand("/ip/firewall/nat/print");
          const internalPrefix = router.internal_prefix || "10.10";
          const publicIpPrefix = router.public_ip_prefix || "";

          const trafficByIpNumber: Record<number, {
            ip_number: number;
            public_ip: string;
            internal_subnet: string;
            bytes: number;
            packets: number;
            nat_rule_id: string;
          }> = {};

          if (Array.isArray(natRules)) {
            for (const rule of natRules) {
              const ruleAction = String(rule.action || "");
              const toAddr = String(rule["to-addresses"] || rule["toAddresses"] || rule.toAddresses || "");
              const srcAddr = String(rule["src-address"] || rule["srcAddress"] || rule.srcAddress || "");
              const ruleId = String(rule[".id"] || rule.id || "");
              const bytes = parseInt(String(rule.bytes || "0"), 10);
              const packets = parseInt(String(rule.packets || "0"), 10);

              // Look for src-nat rules
              if (ruleAction === "src-nat" && toAddr && publicIpPrefix && toAddr.startsWith(publicIpPrefix + ".")) {
                const publicParts = toAddr.split(".");
                if (publicParts.length === 4) {
                  const ipNumber = parseInt(publicParts[3], 10);
                  if (!isNaN(ipNumber)) {
                    const expectedSrcPrefix = `${internalPrefix}.${ipNumber}`;
                    if (srcAddr.startsWith(expectedSrcPrefix)) {
                      trafficByIpNumber[ipNumber] = {
                        ip_number: ipNumber,
                        public_ip: toAddr,
                        internal_subnet: `${internalPrefix}.${ipNumber}`,
                        bytes,
                        packets,
                        nat_rule_id: ruleId,
                      };
                    }
                  }
                }
              }
            }
          }

          const trafficData = Object.values(trafficByIpNumber);
          console.log(`[WireGuard API] Got traffic for ${trafficData.length} NAT rules`);

          return NextResponse.json({
            traffic: trafficData,
            totalRules: Array.isArray(natRules) ? natRules.length : 0,
          });
        } catch (trafficErr) {
          const trafficErrMsg = trafficErr instanceof Error ? trafficErr.message : "Unknown error";
          console.error("[WireGuard API] Failed to get NAT traffic:", trafficErrMsg);
          return NextResponse.json({ error: `Failed to get NAT traffic: ${trafficErrMsg}` }, { status: 500 });
        }
      }
      case "createMikroTikRules": {
        // Create WG IP, Public IP on interface, and NAT rule in MikroTik
        const { ip_number } = data;
        if (!ip_number) {
          return NextResponse.json({ error: "Missing ip_number" }, { status: 400 });
        }

        const internalPrefix = router.internal_prefix || "10.10";
        const publicIpPrefix = router.public_ip_prefix || "";
        const publicIpMask = router.public_ip_mask || "/25";
        const outInterface = router.out_interface || "ether2";
        const wgInterface = router.wg_interface || "wg0";

        if (!publicIpPrefix) {
          return NextResponse.json({ error: "Router public_ip_prefix not configured" }, { status: 400 });
        }

        const results = {
          wg_ip_created: false,
          ip_address_created: false,
          nat_rule_created: false,
          errors: [] as string[],
        };

        // 1. Create WireGuard internal IP (10.10.x.1/24 on wg0)
        const wgIpAddress = `${internalPrefix}.${ip_number}.1/24`;
        try {
          console.log(`[WireGuard API] Creating WG IP: ${wgIpAddress} on ${wgInterface}`);
          await client.executeCommand("/ip/address/add", {
            address: wgIpAddress,
            interface: wgInterface,
          });
          results.wg_ip_created = true;
          console.log(`[WireGuard API] WG IP created successfully`);
        } catch (wgErr) {
          const errMsg = wgErr instanceof Error ? wgErr.message : "Unknown error";
          if (errMsg.includes("already have") || errMsg.includes("exists")) {
            results.wg_ip_created = true;
            console.log(`[WireGuard API] WG IP already exists`);
          } else {
            results.errors.push(`WG IP: ${errMsg}`);
            console.error(`[WireGuard API] Failed to create WG IP:`, errMsg);
          }
        }

        // 2. Create public IP on out-interface (76.245.59.x/25 on ether2)
        const publicIpAddress = `${publicIpPrefix}.${ip_number}${publicIpMask}`;
        try {
          console.log(`[WireGuard API] Creating public IP: ${publicIpAddress} on ${outInterface}`);
          await client.executeCommand("/ip/address/add", {
            address: publicIpAddress,
            interface: outInterface,
          });
          results.ip_address_created = true;
          console.log(`[WireGuard API] Public IP created successfully`);
        } catch (ipErr) {
          const errMsg = ipErr instanceof Error ? ipErr.message : "Unknown error";
          if (errMsg.includes("already have") || errMsg.includes("exists")) {
            results.ip_address_created = true;
            console.log(`[WireGuard API] Public IP already exists`);
          } else {
            results.errors.push(`Public IP: ${errMsg}`);
            console.error(`[WireGuard API] Failed to create public IP:`, errMsg);
          }
        }

        // 3. Create NAT rule (srcnat 10.10.x.0/24 -> 76.245.59.x)
        const srcAddress = `${internalPrefix}.${ip_number}.0/24`;
        const toAddress = `${publicIpPrefix}.${ip_number}`;
        try {
          // First, find if there's a masquerade rule to place before it
          // Masquerade rules capture all traffic, so our specific rules must be before them
          let placeBefore: string | undefined;
          try {
            const existingNatRules = await client.executeCommand("/ip/firewall/nat/print");
            if (Array.isArray(existingNatRules)) {
              // Find the first masquerade rule on srcnat chain
              const masqueradeRule = existingNatRules.find((rule) => {
                const ruleChain = String(rule.chain || "");
                const ruleAction = String(rule.action || "");
                return ruleChain === "srcnat" && ruleAction === "masquerade";
              });
              if (masqueradeRule) {
                placeBefore = String(masqueradeRule[".id"] || masqueradeRule.id || "");
                console.log(`[WireGuard API] Found masquerade rule ${placeBefore}, will place new rule before it`);
              }
            }
          } catch (findErr) {
            console.log(`[WireGuard API] Could not find masquerade rule, will add to end:`, findErr);
          }

          console.log(`[WireGuard API] Creating NAT rule: ${srcAddress} -> ${toAddress}`);
          const natParams: Record<string, unknown> = {
            chain: "srcnat",
            action: "src-nat",
            "src-address": srcAddress,
            "out-interface": outInterface,
            "to-addresses": toAddress,
            comment: `IP ${ip_number}`,
          };

          // Add place-before if we found a masquerade rule
          if (placeBefore) {
            natParams["place-before"] = placeBefore;
          }

          await client.executeCommand("/ip/firewall/nat/add", natParams);
          results.nat_rule_created = true;
          console.log(`[WireGuard API] NAT rule created successfully with comment 'IP ${ip_number}'${placeBefore ? ` before rule ${placeBefore}` : ""}`);
        } catch (natErr) {
          const errMsg = natErr instanceof Error ? natErr.message : "Unknown error";
          if (errMsg.includes("already have") || errMsg.includes("exists")) {
            results.nat_rule_created = true;
            console.log(`[WireGuard API] NAT rule already exists`);
          } else {
            results.errors.push(`NAT rule: ${errMsg}`);
            console.error(`[WireGuard API] Failed to create NAT rule:`, errMsg);
          }
        }

        // Update the public_ips table with the results
        if (results.wg_ip_created || results.ip_address_created || results.nat_rule_created) {
          await supabase
            .from("public_ips")
            .update({
              wg_ip_created: results.wg_ip_created,
              ip_address_created: results.ip_address_created,
              nat_rule_created: results.nat_rule_created,
            })
            .eq("router_id", routerId)
            .eq("ip_number", ip_number);
        }

        return NextResponse.json({
          success: results.errors.length === 0,
          ...results,
        });
      }
      case "importPublicIps": {
        // Read NAT rules, IP addresses and WG addresses from MikroTik
        // Only show IPs that have ALL 3 conditions:
        // 1. WireGuard internal IP (10.10.x.1/24 on wg interface)
        // 2. Public IP on out-interface (76.245.59.x/25 on ether2)
        // 3. NAT rule to route traffic through that public IP
        console.log("[WireGuard API] Importing public IPs from MikroTik...");

        try {
          // Get NAT rules
          const natRules = await client.executeCommand("/ip/firewall/nat/print");
          console.log(`[WireGuard API] Got ${Array.isArray(natRules) ? natRules.length : 0} NAT rules`);

          // Get IP addresses from interfaces
          const ipAddresses = await client.executeCommand("/ip/address/print");
          console.log(`[WireGuard API] Got ${Array.isArray(ipAddresses) ? ipAddresses.length : 0} IP addresses`);

          // Get WireGuard interface name
          const wgInterface = router.wg_interface || "wg0";
          const outInterface = router.out_interface || "ether2";
          const internalPrefix = router.internal_prefix || "10.10";
          const publicIpPrefix = router.public_ip_prefix || "";

          // Map to store detected configurations
          const ipConfigs = new Map<number, {
            ip_number: number;
            public_ip: string;
            internal_subnet: string;
            has_nat_rule: boolean;
            has_ip_address: boolean;
            has_wg_ip: boolean;
            nat_rule_id: string;
            ip_address_id: string;
            wg_ip_id: string;
            nat_bytes: number;
            nat_packets: number;
          }>();

          // 1. Check for WireGuard internal IPs (e.g., 10.10.200.1/24 on wg0)
          if (Array.isArray(ipAddresses)) {
            for (const addr of ipAddresses) {
              const addressRaw = String(addr.address || "");
              const interfaceName = String(addr.interface || "");
              const addrId = String(addr[".id"] || addr.id || "");
              const addressParts = addressRaw.split("/");
              const address = addressParts[0];
              const mask = addressParts[1] || "";

              // Check for WireGuard internal IPs (10.10.x.1/24)
              if (interfaceName === wgInterface && address.startsWith(internalPrefix + ".")) {
                const parts = address.split(".");
                if (parts.length === 4 && parts[3] === "1" && (mask === "24" || mask === "/24")) {
                  const ipNumber = parseInt(parts[2], 10);
                  if (!isNaN(ipNumber)) {
                    const existing = ipConfigs.get(ipNumber) || {
                      ip_number: ipNumber,
                      public_ip: publicIpPrefix ? `${publicIpPrefix}.${ipNumber}` : "",
                      internal_subnet: `${internalPrefix}.${ipNumber}`,
                      has_nat_rule: false,
                      has_ip_address: false,
                      has_wg_ip: true,
                      nat_rule_id: "",
                      ip_address_id: "",
                      wg_ip_id: addrId,
                      nat_bytes: 0,
                      nat_packets: 0,
                    };
                    existing.has_wg_ip = true;
                    existing.wg_ip_id = addrId;
                    ipConfigs.set(ipNumber, existing);
                    console.log(`[WireGuard API] Found WG IP: ${address} -> IP number ${ipNumber}`);
                  }
                }
              }

              // Check for public IPs on out-interface (76.245.59.x on ether2)
              if (interfaceName === outInterface && publicIpPrefix && address.startsWith(publicIpPrefix + ".")) {
                const parts = address.split(".");
                if (parts.length === 4) {
                  const ipNumber = parseInt(parts[3], 10);
                  if (!isNaN(ipNumber)) {
                    const existing = ipConfigs.get(ipNumber) || {
                      ip_number: ipNumber,
                      public_ip: address,
                      internal_subnet: `${internalPrefix}.${ipNumber}`,
                      has_nat_rule: false,
                      has_ip_address: true,
                      has_wg_ip: false,
                      nat_rule_id: "",
                      ip_address_id: addrId,
                      wg_ip_id: "",
                      nat_bytes: 0,
                      nat_packets: 0,
                    };
                    existing.has_ip_address = true;
                    existing.ip_address_id = addrId;
                    existing.public_ip = address;
                    ipConfigs.set(ipNumber, existing);
                    console.log(`[WireGuard API] Found Public IP: ${address} on ${interfaceName} -> IP number ${ipNumber}`);
                  }
                }
              }
            }
          }

          // 2. Check NAT rules for srcnat with to-addresses
          if (Array.isArray(natRules)) {
            for (const rule of natRules) {
              const ruleAction = String(rule.action || "");
              const toAddr = String(rule["to-addresses"] || rule["toAddresses"] || rule.toAddresses || "");
              const srcAddr = String(rule["src-address"] || rule["srcAddress"] || rule.srcAddress || "");
              const ruleId = String(rule[".id"] || rule.id || "");
              const bytes = parseInt(String(rule.bytes || "0"), 10);
              const packets = parseInt(String(rule.packets || "0"), 10);

              // Look for src-nat rules that map internal subnets to public IPs
              if (ruleAction === "src-nat" && toAddr && publicIpPrefix && toAddr.startsWith(publicIpPrefix + ".")) {
                const publicParts = toAddr.split(".");
                if (publicParts.length === 4) {
                  const ipNumber = parseInt(publicParts[3], 10);
                  if (!isNaN(ipNumber)) {
                    // Verify src-address matches internal subnet
                    const expectedSrcPrefix = `${internalPrefix}.${ipNumber}`;
                    if (srcAddr.startsWith(expectedSrcPrefix)) {
                      const existing = ipConfigs.get(ipNumber) || {
                        ip_number: ipNumber,
                        public_ip: toAddr,
                        internal_subnet: `${internalPrefix}.${ipNumber}`,
                        has_nat_rule: true,
                        has_ip_address: false,
                        has_wg_ip: false,
                        nat_rule_id: ruleId,
                        ip_address_id: "",
                        wg_ip_id: "",
                        nat_bytes: bytes,
                        nat_packets: packets,
                      };
                      existing.has_nat_rule = true;
                      existing.nat_rule_id = ruleId;
                      existing.nat_bytes = bytes;
                      existing.nat_packets = packets;
                      if (!existing.public_ip) existing.public_ip = toAddr;
                      ipConfigs.set(ipNumber, existing);
                      console.log(`[WireGuard API] Found NAT rule: ${srcAddr} -> ${toAddr} (${bytes} bytes) -> IP number ${ipNumber}`);
                    }
                  }
                }
              }
            }
          }

          // Convert to array and filter for IPs that have all 3 conditions
          const allDetected = Array.from(ipConfigs.values());
          const fullyConfigured = allDetected.filter(ip => ip.has_wg_ip && ip.has_ip_address && ip.has_nat_rule);
          const partiallyConfigured = allDetected.filter(ip => !ip.has_wg_ip || !ip.has_ip_address || !ip.has_nat_rule);

          console.log(`[WireGuard API] Detected ${fullyConfigured.length} fully configured IPs, ${partiallyConfigured.length} partially configured`);

          // Get already saved IPs to avoid duplicates
          const { data: existingIps } = await supabase
            .from("public_ips")
            .select("ip_number")
            .eq("router_id", routerId);

          const existingIpNumbers = new Set((existingIps || []).map((ip: any) => ip.ip_number));

          const newFullyConfigured = fullyConfigured.filter(ip => !existingIpNumbers.has(ip.ip_number));
          const newPartiallyConfigured = partiallyConfigured.filter(ip => !existingIpNumbers.has(ip.ip_number));

          return NextResponse.json({
            detectedIps: newFullyConfigured,
            partiallyConfiguredIps: newPartiallyConfigured,
            alreadySavedCount: fullyConfigured.length - newFullyConfigured.length,
            routerConfig: {
              public_ip_prefix: router.public_ip_prefix,
              internal_prefix: router.internal_prefix,
              out_interface: router.out_interface,
              wg_interface: router.wg_interface,
            },
            natRulesCount: Array.isArray(natRules) ? natRules.length : 0,
            ipAddressesCount: Array.isArray(ipAddresses) ? ipAddresses.length : 0,
          });
        } catch (importErr) {
          const importErrMsg = importErr instanceof Error ? importErr.message : "Unknown error";
          console.error("[WireGuard API] Failed to import public IPs:", importErrMsg);
          return NextResponse.json({ error: `Failed to import: ${importErrMsg}` }, { status: 500 });
        }
      }
      case "saveImportedIps": {
        // Save detected IPs to Supabase
        const { ips } = data;
        if (!ips || !Array.isArray(ips) || ips.length === 0) {
          return NextResponse.json({ error: "No IPs to save" }, { status: 400 });
        }

        console.log(`[WireGuard API] Saving ${ips.length} imported IPs to database...`);

        const savedIps = [];
        const errors = [];

        for (const ip of ips) {
          try {
            const { data: savedIp, error } = await supabase
              .from("public_ips")
              .insert({
                router_id: routerId,
                ip_number: ip.ip_number,
                public_ip: ip.public_ip,
                internal_subnet: ip.internal_subnet,
                enabled: true,
                nat_rule_created: ip.has_nat_rule || false,
                ip_address_created: ip.has_ip_address || false,
                wg_ip_created: ip.has_wg_ip || false,
              })
              .select()
              .single();

            if (error) {
              if (error.code === "23505") {
                console.log(`[WireGuard API] IP ${ip.public_ip} already exists, skipping`);
              } else {
                errors.push({ ip: ip.public_ip, error: error.message });
              }
            } else {
              savedIps.push(savedIp);
            }
          } catch (saveErr) {
            const errMsg = saveErr instanceof Error ? saveErr.message : "Unknown error";
            errors.push({ ip: ip.public_ip, error: errMsg });
          }
        }

        console.log(`[WireGuard API] Saved ${savedIps.length} IPs, ${errors.length} errors`);

        return NextResponse.json({
          success: true,
          savedCount: savedIps.length,
          errors,
          savedIps,
        });
      }
      case "updatePeer": {
        console.log("[WireGuard API] Updating peer:", data.id);
        try {
          const updateData: Record<string, unknown> = {};
          if (data.name !== undefined) updateData.name = data.name;
          if (data["allowed-address"] !== undefined) updateData["allowed-address"] = data["allowed-address"];
          if (data.comment !== undefined) updateData.comment = data.comment;

          await client.updateWireGuardPeer(data.id, updateData);
          console.log("[WireGuard API] Peer updated successfully");
          return NextResponse.json({ success: true });
        } catch (updateErr) {
          const updateErrMsg = updateErr instanceof Error ? updateErr.message : "Unknown error";
          console.error("[WireGuard API] Failed to update peer:", updateErrMsg);
          return NextResponse.json({ error: `Failed to update peer: ${updateErrMsg}` }, { status: 500 });
        }
      }
      case "updatePeerWithKeys": {
        console.log("[WireGuard API] Updating peer with keys:", data.id);
        try {
          const updateData: Record<string, unknown> = {};
          if (data.name !== undefined) updateData.name = data.name;
          if (data["allowed-address"] !== undefined) updateData["allowed-address"] = data["allowed-address"];
          if (data.comment !== undefined) updateData.comment = data.comment;

          if (data["public-key"]) {
            const allPeers = await client.getWireGuardPeers();
            const existingPeerWithKey = allPeers.find(p =>
              p["public-key"] === data["public-key"] && p[".id"] !== data.id
            );
            if (existingPeerWithKey) {
              return NextResponse.json({
                error: "Public key already exists on another peer",
                existingPeerId: existingPeerWithKey[".id"]
              }, { status: 400 });
            }
            updateData["public-key"] = data["public-key"];
          }
          if (data["private-key"]) updateData["private-key"] = data["private-key"];

          await client.updateWireGuardPeer(data.id, updateData);

          await logActivity({
            supabase,
            userId: user.id,
            routerId,
            action: "update",
            entityType: "peer",
            entityId: data.id,
            entityName: data.name || null,
            details: { updatedFields: Object.keys(updateData), keyChanged: !!data["public-key"] }
          });

          console.log("[WireGuard API] Peer updated with keys successfully");
          return NextResponse.json({ success: true });
        } catch (updateErr) {
          const updateErrMsg = updateErr instanceof Error ? updateErr.message : "Unknown error";
          console.error("[WireGuard API] Failed to update peer with keys:", updateErrMsg);
          return NextResponse.json({ error: `Failed to update peer: ${updateErrMsg}` }, { status: 500 });
        }
      }
      case "deletePeer": {
        console.log("[WireGuard API] Deleting peer:", data.id);
        await client.deleteWireGuardPeer(data.id);
        console.log("[WireGuard API] Peer deleted, logging activity...");
        // Log activity
        await logActivity({
          supabase,
          userId: user.id,
          routerId,
          action: "delete",
          entityType: "peer",
          entityId: data.id,
          entityName: data.name || null,
          details: {}
        });
        console.log("[WireGuard API] Activity logged for delete");
        return NextResponse.json({ success: true });
      }
      case "enablePeer": {
        console.log("[WireGuard API] Enabling peer:", data.id);
        await client.enableWireGuardPeer(data.id);
        console.log("[WireGuard API] Peer enabled, logging activity...");
        // Log activity
        await logActivity({
          supabase,
          userId: user.id,
          routerId,
          action: "enable",
          entityType: "peer",
          entityId: data.id,
          entityName: data.name || null,
          details: {}
        });
        console.log("[WireGuard API] Activity logged for enable");
        return NextResponse.json({ success: true });
      }
      case "disablePeer": {
        console.log("[WireGuard API] Disabling peer:", data.id);
        await client.disableWireGuardPeer(data.id);
        console.log("[WireGuard API] Peer disabled, logging activity...");
        // Log activity
        await logActivity({
          supabase,
          userId: user.id,
          routerId,
          action: "disable",
          entityType: "peer",
          entityId: data.id,
          entityName: data.name || null,
          details: {}
        });
        console.log("[WireGuard API] Activity logged for disable");
        return NextResponse.json({ success: true });
      }
      case "deleteMikroTikRules": {
        // Delete WG IP, Public IP on interface, and NAT rule from MikroTik
        const { ip_number: deleteIpNumber } = data;
        if (!deleteIpNumber) {
          return NextResponse.json({ error: "Missing ip_number" }, { status: 400 });
        }

        const deleteInternalPrefix = router.internal_prefix || "10.10";
        const deletePublicIpPrefix = router.public_ip_prefix || "";
        const deleteOutInterface = router.out_interface || "ether2";
        const deleteWgInterface = router.wg_interface || "wg0";

        const deleteResults = {
          wg_ip_deleted: false,
          ip_address_deleted: false,
          nat_rule_deleted: false,
          errors: [] as string[],
        };

        // 1. Delete NAT rule
        try {
          const natRules = await client.executeCommand("/ip/firewall/nat/print");
          if (Array.isArray(natRules)) {
            const targetSrcAddress = `${deleteInternalPrefix}.${deleteIpNumber}.0/24`;
            const targetToAddress = `${deletePublicIpPrefix}.${deleteIpNumber}`;

            for (const rule of natRules) {
              const srcAddr = String(rule["src-address"] || rule.srcAddress || "");
              const toAddr = String(rule["to-addresses"] || rule.toAddresses || "");
              const ruleId = String(rule[".id"] || rule.id || "");

              if (srcAddr === targetSrcAddress || toAddr === targetToAddress) {
                console.log(`[WireGuard API] Deleting NAT rule ${ruleId}`);
                await client.executeCommand("/ip/firewall/nat/remove", { id: ruleId });
                deleteResults.nat_rule_deleted = true;
                console.log(`[WireGuard API] NAT rule deleted successfully`);
                break;
              }
            }
          }
          if (!deleteResults.nat_rule_deleted) {
            console.log(`[WireGuard API] NAT rule not found, marking as deleted`);
            deleteResults.nat_rule_deleted = true;
          }
        } catch (natErr) {
          const errMsg = natErr instanceof Error ? natErr.message : "Unknown error";
          deleteResults.errors.push(`NAT rule: ${errMsg}`);
          console.error(`[WireGuard API] Failed to delete NAT rule:`, errMsg);
        }

        // 2. Delete public IP from out-interface
        try {
          const ipAddresses = await client.executeCommand("/ip/address/print");
          if (Array.isArray(ipAddresses)) {
            const targetPublicIp = `${deletePublicIpPrefix}.${deleteIpNumber}`;

            for (const addr of ipAddresses) {
              const address = String(addr.address || "").split("/")[0];
              const interfaceName = String(addr.interface || "");
              const addrId = String(addr[".id"] || addr.id || "");

              if (address === targetPublicIp && interfaceName === deleteOutInterface) {
                console.log(`[WireGuard API] Deleting public IP ${addrId}`);
                await client.executeCommand("/ip/address/remove", { id: addrId });
                deleteResults.ip_address_deleted = true;
                console.log(`[WireGuard API] Public IP deleted successfully`);
                break;
              }
            }
          }
          if (!deleteResults.ip_address_deleted) {
            console.log(`[WireGuard API] Public IP not found, marking as deleted`);
            deleteResults.ip_address_deleted = true;
          }
        } catch (ipErr) {
          const errMsg = ipErr instanceof Error ? ipErr.message : "Unknown error";
          deleteResults.errors.push(`Public IP: ${errMsg}`);
          console.error(`[WireGuard API] Failed to delete public IP:`, errMsg);
        }

        // 3. Delete WireGuard internal IP
        try {
          const ipAddresses = await client.executeCommand("/ip/address/print");
          if (Array.isArray(ipAddresses)) {
            const targetWgIp = `${deleteInternalPrefix}.${deleteIpNumber}.1`;

            for (const addr of ipAddresses) {
              const address = String(addr.address || "").split("/")[0];
              const interfaceName = String(addr.interface || "");
              const addrId = String(addr[".id"] || addr.id || "");

              if (address === targetWgIp && interfaceName === deleteWgInterface) {
                console.log(`[WireGuard API] Deleting WG IP ${addrId}`);
                await client.executeCommand("/ip/address/remove", { id: addrId });
                deleteResults.wg_ip_deleted = true;
                console.log(`[WireGuard API] WG IP deleted successfully`);
                break;
              }
            }
          }
          if (!deleteResults.wg_ip_deleted) {
            console.log(`[WireGuard API] WG IP not found, marking as deleted`);
            deleteResults.wg_ip_deleted = true;
          }
        } catch (wgErr) {
          const errMsg = wgErr instanceof Error ? wgErr.message : "Unknown error";
          deleteResults.errors.push(`WG IP: ${errMsg}`);
          console.error(`[WireGuard API] Failed to delete WG IP:`, errMsg);
        }

        return NextResponse.json({
          success: deleteResults.errors.length === 0,
          ...deleteResults,
        });
      }
      case "testConnection": {
        console.log(`[WireGuard API] Testing connection to ${router.host}...`);
        // Always clear cache before testing to ensure fresh connection
        await clearClientCacheForRouter(router.host, apiPort, router.username);

        // Create a new client after clearing cache
        const freshClient = new MikroTikClient({
          host: router.host,
          port: restPort,
          apiPort: apiPort,
          username: router.username,
          password: router.password,
          useSsl: useApiSsl,
          connectionType: baseConnectionType as "api" | "rest",
        });

        try {
          const connected = await freshClient.testConnection();
          console.log(`[WireGuard API] Connection test result: ${connected}`);
          return NextResponse.json({ connected });
        } catch (testErr) {
          const testErrMsg = testErr instanceof Error ? testErr.message : "Unknown error";
          console.error(`[WireGuard API] Connection test failed:`, testErrMsg);
          // Clear cache again on failure
          await clearClientCacheForRouter(router.host, apiPort, router.username);
          return NextResponse.json({ connected: false, error: testErrMsg });
        }
      }
      case "getSystemInterfaces": {
        // Get network and WireGuard interfaces from MikroTik
        console.log("[WireGuard API] Getting interfaces from MikroTik...");
        try {
          // Get all interfaces
          const allInterfaces = await client.executeCommand("/interface/print");
          const networkInterfaces: string[] = [];

          if (Array.isArray(allInterfaces)) {
            for (const iface of allInterfaces) {
              const name = String(iface.name || "");
              const type = String(iface.type || "");
              // Include ethernet, bridge, vlan, bonding interfaces
              if (name && ["ether", "bridge", "vlan", "bonding", "sfp"].some(t => type.includes(t) || name.includes(t))) {
                networkInterfaces.push(name);
              }
            }
          }

          // Get WireGuard interfaces
          const wgInterfacesRaw = await client.getWireGuardInterfaces();
          const wgInterfaces = wgInterfacesRaw.map(wg => wg.name);

          return NextResponse.json({
            success: true,
            networkInterfaces,
            wgInterfaces,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          console.error("[WireGuard API] Failed to get interfaces:", errMsg);
          return NextResponse.json({
            success: false,
            error: errMsg,
            networkInterfaces: [],
            wgInterfaces: [],
          });
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
