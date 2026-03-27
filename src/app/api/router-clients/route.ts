import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { RouterOSClient } from "routeros-client";
import type { RouterClient, VpnPeerConfig } from "@/lib/types";

// Generate the WireGuard VPN script for MikroTik
function generateVpnScript(config: VpnPeerConfig, routerName: string): string {
  return `
# ╔════════════════════════════════════════════════════════════════╗
# ║  WIREGUARD TRAVEL ROUTER v4.0                                 ║
# ║  Generated for: ${routerName}                                 ║
# ╚════════════════════════════════════════════════════════════════╝

:local privateKey "${config.privateKey}"
:local address "${config.address}"
:local peerPublicKey "${config.peerPublicKey}"
:local endpointIP "${config.endpointIP}"
:local endpointPort ${config.endpointPort}
:local dns1 "${config.dns1}"
:local dns2 "${config.dns2}"
:local mtu ${config.mtu}
:local keepalive ${config.keepalive}

:local baseIf "wgvpn"
:local basePeer "vpn"
:local startPort 51820

:put "Iniciando configuración..."

:local wanInterface ""
:foreach dhcp in=[/ip dhcp-client find status=bound] do={
    :set wanInterface [/ip dhcp-client get \\$dhcp interface]
}
:if (\\$wanInterface = "") do={
    :foreach n in={"ether1";"ether2";"wan";"sfp1"} do={
        :if ([:len [/interface find name=\\$n running=yes]] > 0 && \\$wanInterface = "") do={
            :set wanInterface \\$n
        }
    }
}
:if (\\$wanInterface = "") do={ :error "ERROR: WAN no detectada" }

:local lanInterface ""
:foreach br in=[/interface bridge find] do={
    :set lanInterface [/interface bridge get \\$br name]
}
:if (\\$lanInterface = "") do={
    :foreach iface in=[/interface ethernet find running=yes] do={
        :local n [/interface ethernet get \\$iface name]
        :if (\\$n != \\$wanInterface && \\$lanInterface = "") do={ :set lanInterface \\$n }
    }
}

:put ("WAN: " . \\$wanInterface . " | LAN: " . \\$lanInterface)

:local mssIPv4 (\\$mtu - 40)

:local ifName \\$baseIf
:local i 0
:while ([:len [/interface wireguard find name=\\$ifName]] > 0) do={
    :set i (\\$i + 1)
    :set ifName (\\$baseIf . \\$i)
}

:local peerName \\$basePeer
:local j 0
:while ([:len [/interface wireguard peers find comment=\\$peerName]] > 0) do={
    :set j (\\$j + 1)
    :set peerName (\\$basePeer . \\$j)
}

:local port \\$startPort
:while ([:len [/interface wireguard find listen-port=\\$port]] > 0) do={
    :set port (\\$port + 1)
}

:put ("Interfaz: " . \\$ifName . " | Peer: " . \\$peerName . " | Puerto: " . \\$port)

:foreach rule in=[/ip firewall filter find action=fasttrack-connection] do={
    /ip firewall filter disable \\$rule
}

/interface wireguard add name=\\$ifName listen-port=\\$port private-key=\\$privateKey mtu=\\$mtu
/ip address add address=\\$address interface=\\$ifName comment=\\$peerName

/interface wireguard peers add \\
    interface=\\$ifName \\
    public-key=\\$peerPublicKey \\
    endpoint-address=\\$endpointIP \\
    endpoint-port=\\$endpointPort \\
    allowed-address=0.0.0.0/0,::/0 \\
    persistent-keepalive=\\$keepalive \\
    comment=\\$peerName

/ip route add dst-address=(\\$endpointIP . "/32") gateway=\\$wanInterface distance=1 comment=\\$peerName
/ip route add dst-address=0.0.0.0/0 gateway=\\$ifName distance=1 comment=\\$peerName

:foreach dhcp in=[/ip dhcp-client find interface=\\$wanInterface] do={
    /ip dhcp-client set \\$dhcp use-peer-dns=no add-default-route=yes default-route-distance=10
}

/ip dns set servers=(\\$dns1 . "," . \\$dns2) allow-remote-requests=yes

/ip firewall mangle add chain=forward protocol=tcp tcp-flags=syn out-interface=\\$ifName action=change-mss new-mss=\\$mssIPv4 passthrough=yes comment=("MSS " . \\$peerName)
/ip firewall mangle add chain=forward protocol=tcp tcp-flags=syn in-interface=\\$ifName action=change-mss new-mss=\\$mssIPv4 passthrough=yes comment=("MSS " . \\$peerName)

/ip firewall nat add chain=srcnat out-interface=\\$ifName action=masquerade comment=\\$peerName
/ip firewall nat add chain=srcnat out-interface=\\$wanInterface action=masquerade comment=\\$peerName

/ip firewall filter add chain=input connection-state=established,related action=accept comment=\\$peerName
/ip firewall filter add chain=input connection-state=invalid action=drop comment=\\$peerName
/ip firewall filter add chain=input protocol=icmp action=accept comment=\\$peerName
/ip firewall filter add chain=input protocol=udp dst-port=\\$port action=accept comment=\\$peerName
:if (\\$lanInterface != "") do={
    /ip firewall filter add chain=input in-interface=\\$lanInterface action=accept comment=\\$peerName
}
/ip firewall filter add chain=input in-interface=\\$ifName action=accept comment=\\$peerName

/ip firewall filter add chain=forward connection-state=established,related action=accept comment=\\$peerName
/ip firewall filter add chain=forward connection-state=invalid action=drop comment=\\$peerName
/ip firewall filter add chain=forward protocol=icmp action=accept comment=\\$peerName
:if (\\$lanInterface != "") do={
    /ip firewall filter add chain=forward in-interface=\\$lanInterface out-interface=\\$ifName action=accept comment=\\$peerName
    /ip firewall filter add chain=forward in-interface=\\$ifName out-interface=\\$lanInterface action=accept comment=\\$peerName
}

/ip firewall filter add chain=forward out-interface=\\$wanInterface dst-address=("!" . \\$endpointIP) action=drop log=yes log-prefix="KS:" comment=("KILL " . \\$peerName)

:put "Configuración completada"
:put ("Interfaz: " . \\$ifName)
:put ("Peer: " . \\$peerName)
`;
}

// Test connection to a MikroTik router
async function testRouterConnection(
  host: string,
  port: number,
  username: string,
  password: string,
  useSsl: boolean
): Promise<{ success: boolean; error?: string; info?: Record<string, unknown> }> {
  const client = new RouterOSClient({
    host,
    port,
    user: username,
    password,
    tls: useSsl ? {} : undefined,
    timeout: 15,
  });

  try {
    const api = await client.connect();
    const resource = await api.menu("/system/resource").getOne();
    const identity = await api.menu("/system/identity").getOne();
    await client.close();

    return {
      success: true,
      info: {
        model: resource.boardName || resource["board-name"] || "Unknown",
        version: resource.version || "Unknown",
        uptime: resource.uptime || "Unknown",
        cpuLoad: resource.cpuLoad || resource["cpu-load"] || 0,
        freeMemory: resource.freeMemory || resource["free-memory"] || 0,
        totalMemory: resource.totalMemory || resource["total-memory"] || 0,
        identity: identity.name || "Unknown",
      },
    };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

// Execute script on MikroTik router
async function executeScriptOnRouter(
  host: string,
  port: number,
  username: string,
  password: string,
  useSsl: boolean,
  script: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  const client = new RouterOSClient({
    host,
    port,
    user: username,
    password,
    tls: useSsl ? {} : undefined,
    timeout: 60,
  });

  try {
    const api = await client.connect();

    // Create a temporary script
    const scriptName = `vpn_setup_${Date.now()}`;
    await api.menu("/system/script").add({
      name: scriptName,
      source: script,
    });

    // Run the script
    const result = await api.menu("/system/script").run(scriptName);

    // Delete the temporary script
    const scripts = await api.menu("/system/script").getAll();
    const scriptToDelete = scripts.find((s: Record<string, unknown>) => s.name === scriptName);
    if (scriptToDelete && scriptToDelete.id) {
      await api.menu("/system/script").where({ ".id": scriptToDelete.id as string }).remove();
    }

    await client.close();

    return { success: true, output: JSON.stringify(result) };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}

// Check VPN status on router
async function checkVpnStatus(
  host: string,
  port: number,
  username: string,
  password: string,
  useSsl: boolean
): Promise<{
  configured: boolean;
  connected: boolean;
  interfaceName?: string;
  lastHandshake?: string;
  error?: string
}> {
  const client = new RouterOSClient({
    host,
    port,
    user: username,
    password,
    tls: useSsl ? {} : undefined,
    timeout: 15,
  });

  try {
    const api = await client.connect();

    // Check for WireGuard interfaces
    const interfaces = await api.menu("/interface/wireguard").getAll();
    if (!interfaces || interfaces.length === 0) {
      await client.close();
      return { configured: false, connected: false };
    }

    // Check for peers
    const peers = await api.menu("/interface/wireguard/peers").getAll();
    const vpnPeer = peers.find((p: Record<string, unknown>) =>
      (p.comment as string)?.includes("vpn") || (p.allowedAddress as string)?.includes("0.0.0.0/0")
    );

    await client.close();

    if (!vpnPeer) {
      return { configured: false, connected: false };
    }

    const lastHandshake = vpnPeer.lastHandshake || vpnPeer["last-handshake"];
    const isConnected = lastHandshake && lastHandshake !== "never" && lastHandshake !== "";

    return {
      configured: true,
      connected: !!isConnected,
      interfaceName: interfaces[0].name as string,
      lastHandshake: lastHandshake as string,
    };
  } catch (error) {
    const err = error as Error;
    return { configured: false, connected: false, error: err.message };
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const action = searchParams.get("action");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // If specific ID requested
  if (id) {
    const { data: routerClient, error } = await supabase
      .from("router_clients")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !routerClient) {
      return NextResponse.json({ error: "Router client not found" }, { status: 404 });
    }

    // Check VPN status if requested
    if (action === "check-status") {
      const status = await checkVpnStatus(
        routerClient.host,
        routerClient.api_port,
        routerClient.username,
        routerClient.password,
        routerClient.use_ssl
      );

      // Update router client with status
      await supabase
        .from("router_clients")
        .update({
          vpn_configured: status.configured,
          vpn_connected: status.connected,
          vpn_interface_name: status.interfaceName || null,
          vpn_last_handshake: status.lastHandshake ? new Date().toISOString() : null,
        })
        .eq("id", id);

      return NextResponse.json({ status });
    }

    return NextResponse.json({ routerClient });
  }

  // Get all router clients
  let query = supabase.from("router_clients").select("*");

  // If not admin, only show own router clients
  if (profile.role !== "admin") {
    query = query.eq("created_by", user.id);
  }

  const { data: routerClients, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ routerClients: routerClients || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const body = await request.json();
  const { action, data } = body;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  switch (action) {
    case "create": {
      const { name, host, api_port, username, password, use_ssl, notes, tags } = data;

      // Test connection first
      const testResult = await testRouterConnection(host, api_port, username, password, use_ssl);

      const insertData: Partial<RouterClient> = {
        name,
        host,
        api_port: api_port || 8729,
        username,
        password,
        use_ssl: use_ssl ?? true,
        notes,
        tags,
        created_by: user.id,
        is_online: testResult.success,
        last_seen: testResult.success ? new Date().toISOString() : null,
        last_error: testResult.error || null,
        router_model: testResult.info?.model as string || null,
        router_os_version: testResult.info?.version as string || null,
        uptime: testResult.info?.uptime as string || null,
        cpu_load: testResult.info?.cpuLoad as number || null,
        memory_total: testResult.info?.totalMemory as number || null,
        memory_used: (testResult.info?.totalMemory as number || 0) - (testResult.info?.freeMemory as number || 0) || null,
      };

      const { data: routerClient, error } = await supabase
        .from("router_clients")
        .insert(insertData)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Log the action
      await supabase.from("router_client_logs").insert({
        router_client_id: routerClient.id,
        action: "create",
        status: "success",
        details: `Router client "${name}" created`,
        executed_by: user.id,
      });

      return NextResponse.json({
        routerClient,
        connectionTest: testResult,
      });
    }

    case "test-connection": {
      const { host, api_port, username, password, use_ssl } = data;
      const result = await testRouterConnection(host, api_port, username, password, use_ssl);
      return NextResponse.json(result);
    }

    case "check-online": {
      const { id } = data;

      const { data: routerClient } = await supabase
        .from("router_clients")
        .select("*")
        .eq("id", id)
        .single();

      if (!routerClient) {
        return NextResponse.json({ error: "Router not found" }, { status: 404 });
      }

      const result = await testRouterConnection(
        routerClient.host,
        routerClient.api_port,
        routerClient.username,
        routerClient.password,
        routerClient.use_ssl
      );

      // Update status in database
      await supabase
        .from("router_clients")
        .update({
          is_online: result.success,
          last_seen: result.success ? new Date().toISOString() : routerClient.last_seen,
          last_error: result.error || null,
          router_model: result.info?.model as string || routerClient.router_model,
          router_os_version: result.info?.version as string || routerClient.router_os_version,
          uptime: result.info?.uptime as string || routerClient.uptime,
          cpu_load: result.info?.cpuLoad as number || routerClient.cpu_load,
          memory_total: result.info?.totalMemory as number || routerClient.memory_total,
          memory_used: result.info?.totalMemory
            ? (result.info.totalMemory as number) - (result.info.freeMemory as number)
            : routerClient.memory_used,
        })
        .eq("id", id);

      return NextResponse.json({
        success: result.success,
        error: result.error,
        info: result.info,
      });
    }

    case "deploy-vpn": {
      const { id, vpnConfig } = data as { id: string; vpnConfig: VpnPeerConfig };

      const { data: routerClient } = await supabase
        .from("router_clients")
        .select("*")
        .eq("id", id)
        .single();

      if (!routerClient) {
        return NextResponse.json({ error: "Router not found" }, { status: 404 });
      }

      // Generate the script
      const script = generateVpnScript(vpnConfig, routerClient.name);

      // Log pending
      await supabase.from("router_client_logs").insert({
        router_client_id: id,
        action: "deploy-vpn",
        status: "pending",
        details: `Deploying VPN to ${routerClient.name}`,
        executed_by: user.id,
      });

      // Execute on router
      const result = await executeScriptOnRouter(
        routerClient.host,
        routerClient.api_port,
        routerClient.username,
        routerClient.password,
        routerClient.use_ssl,
        script
      );

      // Update router client with VPN config
      if (result.success) {
        await supabase
          .from("router_clients")
          .update({
            vpn_configured: true,
            vpn_private_key: vpnConfig.privateKey,
            vpn_address: vpnConfig.address,
            vpn_peer_public_key: vpnConfig.peerPublicKey,
            vpn_endpoint_ip: vpnConfig.endpointIP,
            vpn_endpoint_port: vpnConfig.endpointPort,
            vpn_dns1: vpnConfig.dns1,
            vpn_dns2: vpnConfig.dns2,
            vpn_mtu: vpnConfig.mtu,
          })
          .eq("id", id);
      }

      // Log result
      await supabase.from("router_client_logs").insert({
        router_client_id: id,
        action: "deploy-vpn",
        status: result.success ? "success" : "error",
        details: result.success ? "VPN deployed successfully" : result.error,
        executed_by: user.id,
      });

      return NextResponse.json(result);
    }

    case "execute-command": {
      const { id, command } = data;

      const { data: routerClient } = await supabase
        .from("router_clients")
        .select("*")
        .eq("id", id)
        .single();

      if (!routerClient) {
        return NextResponse.json({ error: "Router not found" }, { status: 404 });
      }

      const client = new RouterOSClient({
        host: routerClient.host,
        port: routerClient.api_port,
        user: routerClient.username,
        password: routerClient.password,
        tls: routerClient.use_ssl ? {} : undefined,
        timeout: 30,
      });

      try {
        const api = await client.connect();

        // Parse command and execute
        // Example: /interface/print or /system/resource/print
        const result = await api.menu(command.replace(/\/print$/, "")).getAll();
        await client.close();

        // Log the command
        await supabase.from("router_client_logs").insert({
          router_client_id: id,
          action: "execute-command",
          status: "success",
          details: command,
          executed_by: user.id,
        });

        return NextResponse.json({ success: true, result });
      } catch (error) {
        const err = error as Error;

        await supabase.from("router_client_logs").insert({
          router_client_id: id,
          action: "execute-command",
          status: "error",
          details: `${command}: ${err.message}`,
          executed_by: user.id,
        });

        return NextResponse.json({ success: false, error: err.message });
      }
    }

    case "update": {
      const { id, ...updateData } = data;

      const { error } = await supabase
        .from("router_clients")
        .update(updateData)
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      await supabase.from("router_client_logs").insert({
        router_client_id: id,
        action: "update",
        status: "success",
        details: `Router client updated`,
        executed_by: user.id,
      });

      return NextResponse.json({ success: true });
    }

    case "delete": {
      const { id } = data;

      const { error } = await supabase
        .from("router_clients")
        .delete()
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
}
