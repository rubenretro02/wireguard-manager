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
          console.log(`[WireGuard API] Creating NAT rule: ${srcAddress} -> ${toAddress}`);
          await client.executeCommand("/ip/firewall/nat/add", {
            chain: "srcnat",
            action: "src-nat",
            "src-address": srcAddress,
            "out-interface": outInterface,
            "to-addresses": toAddress,
          });
          results.nat_rule_created = true;
          console.log(`[WireGuard API] NAT rule created successfully`);
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

          const existingIpNumbers = new Set((existingIps || []).map(ip => ip.ip_number));

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
