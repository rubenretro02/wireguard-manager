import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { MikroTikClient } from "@/lib/mikrotik";
import { LinuxWireGuardClient } from "@/lib/linux-wireguard";
import type { ConnectionType, AuthMethod } from "@/lib/types";

// Force Node.js runtime for ssh2 native modules
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Helper to get value from object with multiple possible keys
function getValue(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return String(obj[key]);
    }
  }
  return "";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { routerId } = body;

  if (!routerId) {
    return NextResponse.json({ error: "Router ID required" }, { status: 400 });
  }

  // Get router details
  const { data: router, error: routerError } = await supabase
    .from("routers")
    .select("*")
    .eq("id", routerId)
    .single();

  if (routerError || !router) {
    return NextResponse.json({ error: "Router not found" }, { status: 404 });
  }

  const connectionType: ConnectionType = router.connection_type || "api";

  // Handle Linux SSH servers
  if (connectionType === "linux-ssh") {
    console.log(`[Router Resources] Connecting to Linux server ${router.host}:${router.ssh_port || 22}`);

    const linuxClient = new LinuxWireGuardClient({
      host: router.host,
      port: router.ssh_port || 22,
      username: router.username,
      password: router.password,
      privateKey: router.ssh_key || undefined,
      authMethod: (router.ssh_auth_method as AuthMethod) || "password",
      wgInterface: router.wg_interface || "wg1",
      outInterface: router.out_interface || "ens192",
    });

    try {
      const resources = await linuxClient.getResources();

      return NextResponse.json({
        success: true,
        resources: {
          cpuLoad: Math.round(resources.cpuLoad),
          freeMemory: resources.freeMemory,
          totalMemory: resources.totalMemory,
          uptime: resources.uptime || "-",
          version: resources.version || "-",
          boardName: resources.hostname || "Linux Server",
          architecture: "Linux",
          cpuCount: "N/A",
          cpuFrequency: "N/A",
        }
      });
    } catch (error) {
      console.error("[Router Resources] Linux error:", error);
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Failed to get resources from Linux server"
      }, { status: 500 });
    }
  }

  // Handle MikroTik routers
  const isApiConnection = connectionType === "api" || connectionType === "api-ssl";
  const useApiSsl = connectionType === "api-ssl";
  const apiPort = connectionType === "api-ssl" ? (router.api_port || 8729) : (router.api_port || 8728);
  const restPort = connectionType === "rest-8443" ? (router.port || 8443) : (router.port || 443);
  const baseConnectionType = isApiConnection ? "api" : "rest";

  console.log(`[Router Resources] Connecting to ${router.host} using ${connectionType}`);

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
    // Get system resources
    const resources = await client.executeCommand("/system/resource/print");
    console.log("[Router Resources] Raw response:", JSON.stringify(resources, null, 2));

    const resource = (Array.isArray(resources) ? resources[0] : resources) || {};

    // Handle both kebab-case (API) and camelCase (REST) formats
    const cpuLoadStr = getValue(resource, "cpu-load", "cpuLoad");
    const freeMemoryStr = getValue(resource, "free-memory", "freeMemory");
    const totalMemoryStr = getValue(resource, "total-memory", "totalMemory");
    const uptimeStr = getValue(resource, "uptime");
    const versionStr = getValue(resource, "version");
    const boardNameStr = getValue(resource, "board-name", "boardName");
    const architectureStr = getValue(resource, "architecture-name", "architectureName");
    const cpuCountStr = getValue(resource, "cpu-count", "cpuCount");
    const cpuFrequencyStr = getValue(resource, "cpu-frequency", "cpuFrequency");

    // Parse memory values (MikroTik returns bytes)
    const freeMemory = parseInt(freeMemoryStr || "0", 10);
    const totalMemory = parseInt(totalMemoryStr || "0", 10);
    const cpuLoad = parseInt(cpuLoadStr || "0", 10);

    console.log("[Router Resources] Parsed values:", {
      cpuLoad,
      freeMemory,
      totalMemory,
      uptime: uptimeStr,
      version: versionStr,
    });

    return NextResponse.json({
      success: true,
      resources: {
        cpuLoad,
        freeMemory,
        totalMemory,
        uptime: uptimeStr || "-",
        version: versionStr || "-",
        boardName: boardNameStr || "-",
        architecture: architectureStr || "-",
        cpuCount: cpuCountStr || "1",
        cpuFrequency: cpuFrequencyStr || "-",
      }
    });
  } catch (error) {
    console.error("[Router Resources] Error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to get resources"
    }, { status: 500 });
  }
}
