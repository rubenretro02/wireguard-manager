import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { Socks5ProxyClient } from "@/lib/socks5-proxy";
import { logActivity } from "@/lib/activity-logger";
import type { AuthMethod } from "@/lib/types";

// Force Node.js runtime for ssh2 native modules
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Database type for socks5_proxies table
interface Socks5ProxyDB {
  id: string;
  router_id: string;
  username: string;
  password: string;
  public_ip: string;
  port: number;
  max_connections: number;
  enabled: boolean;
  created_at: string;
  created_by: string;
  name: string | null;
  expires_at: string | null;
  scheduled_enable: string | null;
  bytes_sent: number;
  bytes_received: number;
  last_connected_at: string | null;
}

// GET: Fetch proxies from database
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const routerId = searchParams.get("routerId");

  if (!routerId) {
    return NextResponse.json({ error: "Router ID required" }, { status: 400 });
  }

  // Get user profile to check role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role?.toLowerCase() === "admin";

  let query = supabase
    .from("socks5_proxies")
    .select("*")
    .eq("router_id", routerId)
    .order("created_at", { ascending: false });

  const { data: proxies, error } = await query;

  if (error) {
    console.error("[Socks5] Error fetching proxies:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ proxies: proxies || [], isAdmin });
}

// POST: Handle various actions
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action, routerId } = body;

  if (!routerId) {
    return NextResponse.json({ error: "Router ID required" }, { status: 400 });
  }

  // Get router details for SSH connection
  const { data: router, error: routerError } = await supabase
    .from("routers")
    .select("*")
    .eq("id", routerId)
    .single();

  if (routerError || !router) {
    return NextResponse.json({ error: "Router not found" }, { status: 404 });
  }

  // Create SOCKS5 client
  const socks5Client = new Socks5ProxyClient({
    host: router.host,
    port: router.ssh_port || 22,
    username: router.ssh_username || "root",
    password: router.ssh_password,
    privateKey: router.ssh_private_key,
    authMethod: (router.ssh_auth_method || "password") as AuthMethod,
  });

  switch (action) {
    case "getStatus": {
      try {
        const status = await socks5Client.getStatus();
        return NextResponse.json(status);
      } catch (error) {
        const err = error as Error;
        console.error("[Socks5] Status check error:", err.message);
        return NextResponse.json({
          installed: false,
          running: false,
          connectionError: err.message
        });
      }
    }

    case "install": {
      try {
        const result = await socks5Client.install3proxy();
        if (result.success) {
          await logActivity({
            supabase,
            userId: user.id,
            routerId,
            action: "create",
            entityType: "socks5_service",
            entityId: null,
            entityName: "3proxy",
            details: { message: "Installed 3proxy service" }
          });
        }
        return NextResponse.json(result);
      } catch (error) {
        const err = error as Error;
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    case "start": {
      try {
        const result = await socks5Client.start();
        return NextResponse.json(result);
      } catch (error) {
        const err = error as Error;
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    case "stop": {
      try {
        const result = await socks5Client.stop();
        return NextResponse.json(result);
      } catch (error) {
        const err = error as Error;
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    case "syncFromServer": {
      // SMART SYNC: Bidirectional sync - never deletes, only adds
      // 1. Proxies on server but not in DB → Add to DB
      // 2. Proxies in DB but not on server → Create on server

      const serverProxies = await socks5Client.getServerProxies();
      const { data: dbProxies } = await supabase
        .from("socks5_proxies")
        .select("*")
        .eq("router_id", routerId);

      const dbProxiesByIp = new Map((dbProxies || []).map((p: Socks5ProxyDB) => [p.public_ip, p]));
      const serverProxiesByIp = new Map(serverProxies.map(p => [p.publicIp, p]));

      // 1. Add to DB: proxies on server but not in database
      const addedToDb: string[] = [];
      for (const serverProxy of serverProxies) {
        if (!dbProxiesByIp.has(serverProxy.publicIp)) {
          await supabase.from("socks5_proxies").insert({
            router_id: routerId,
            username: serverProxy.username,
            password: serverProxy.password,
            public_ip: serverProxy.publicIp,
            port: 1080,
            enabled: true,
            created_by: user.id,
          });
          addedToDb.push(serverProxy.publicIp);
        }
      }

      // 2. Add to Server: proxies in DB but not on server
      const addedToServer: string[] = [];
      const enabledDbProxies = (dbProxies || []).filter((p: Socks5ProxyDB) => p.enabled);
      const missingOnServer = enabledDbProxies.filter((p: Socks5ProxyDB) => !serverProxiesByIp.has(p.public_ip));

      if (missingOnServer.length > 0) {
        // Rebuild server config with ALL proxies (existing + missing)
        const allProxiesForServer = [
          ...serverProxies.map(p => ({
            username: p.username,
            password: p.password,
            publicIp: p.publicIp,
            port: 1080,
            enabled: true,
            maxConnections: 0,
          })),
          ...missingOnServer.map((p: Socks5ProxyDB) => ({
            username: p.username,
            password: p.password,
            publicIp: p.public_ip,
            port: 1080,
            enabled: true,
            maxConnections: p.max_connections || 0,
          }))
        ];

        const rebuildResult = await socks5Client.rebuildConfig(allProxiesForServer);

        if (rebuildResult.success) {
          for (const proxy of missingOnServer) {
            addedToServer.push(proxy.public_ip);
          }
        }
      }

      return NextResponse.json({
        success: true,
        addedToDb: addedToDb.length,
        addedToServer: addedToServer.length,
        totalInDb: (dbProxies || []).length + addedToDb.length,
        totalOnServer: serverProxies.length + addedToServer.length,
        details: {
          addedToDbIps: addedToDb,
          addedToServerIps: addedToServer,
        }
      });
    }

    case "createProxy": {
      const { username, password, publicIp, port, maxConnections, name, expiresAt, scheduledEnable } = body;

      if (!username || !password || !publicIp) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      try {
        // First, get all existing proxies to rebuild config
        const { data: existingProxies } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("router_id", routerId)
          .eq("enabled", true);

        // Add new proxy to config
        const allProxies = [
          ...(existingProxies || []).map((p: Socks5ProxyDB) => ({
            username: p.username,
            password: p.password,
            publicIp: p.public_ip,
            port: p.port || 1080,
            enabled: true,
            maxConnections: p.max_connections || 0,
          })),
          {
            username,
            password,
            publicIp,
            port: parseInt(port) || 1080,
            enabled: true,
            maxConnections: parseInt(maxConnections) || 0,
          }
        ];

        const result = await socks5Client.rebuildConfig(allProxies);

        if (!result.success) {
          return NextResponse.json({ success: false, message: result.message }, { status: 500 });
        }

        // Save to database
        const { data: newProxy, error: insertError } = await supabase
          .from("socks5_proxies")
          .insert({
            router_id: routerId,
            username,
            password,
            public_ip: publicIp,
            port: parseInt(port) || 1080,
            max_connections: parseInt(maxConnections) || 0,
            enabled: true,
            created_by: user.id,
            name: name || null,
            expires_at: expiresAt || null,
            scheduled_enable: scheduledEnable || null,
          })
          .select()
          .single();

        if (insertError) {
          console.error("[Socks5] Insert error:", insertError);
          return NextResponse.json({ error: insertError.message }, { status: 500 });
        }

        await logActivity({
          supabase,
          userId: user.id,
          routerId,
          action: "create",
          entityType: "socks5_proxy",
          entityId: newProxy.id,
          entityName: `${username}@${publicIp}`,
          details: { port, maxConnections }
        });

        return NextResponse.json({ success: true, proxy: newProxy });
      } catch (error) {
        const err = error as Error;
        console.error("[Socks5] Create error:", err.message);
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    case "updateProxy": {
      const { proxyId, name, password, maxConnections } = body;

      if (!proxyId) {
        return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
      }

      try {
        // Get current proxy
        const { data: currentProxy } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("id", proxyId)
          .single();

        if (!currentProxy) {
          return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
        }

        const updates: Record<string, unknown> = {};
        if (name !== undefined) updates.name = name;
        if (password !== undefined) updates.password = password;
        if (maxConnections !== undefined) updates.max_connections = parseInt(maxConnections) || 0;

        // Update database
        const { data: updatedProxy, error: updateError } = await supabase
          .from("socks5_proxies")
          .update(updates)
          .eq("id", proxyId)
          .select()
          .single();

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // If password changed, rebuild config
        if (password !== undefined && password !== currentProxy.password) {
          const { data: allProxies } = await supabase
            .from("socks5_proxies")
            .select("*")
            .eq("router_id", routerId)
            .eq("enabled", true);

          await socks5Client.rebuildConfig(
            (allProxies || []).map((p: Socks5ProxyDB) => ({
              username: p.username,
              password: p.password,
              publicIp: p.public_ip,
              port: p.port || 1080,
              enabled: true,
              maxConnections: p.max_connections || 0,
            }))
          );
        }

        return NextResponse.json({ success: true, proxy: updatedProxy });
      } catch (error) {
        const err = error as Error;
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    case "deleteProxy": {
      const { proxyId } = body;

      if (!proxyId) {
        return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
      }

      try {
        // Get proxy info before deletion
        const { data: proxyToDelete } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("id", proxyId)
          .single();

        if (!proxyToDelete) {
          return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
        }

        // Delete from database
        const { error: deleteError } = await supabase
          .from("socks5_proxies")
          .delete()
          .eq("id", proxyId);

        if (deleteError) {
          return NextResponse.json({ error: deleteError.message }, { status: 500 });
        }

        // Rebuild config without deleted proxy
        const { data: remainingProxies } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("router_id", routerId)
          .eq("enabled", true);

        await socks5Client.rebuildConfig(
          (remainingProxies || []).map((p: Socks5ProxyDB) => ({
            username: p.username,
            password: p.password,
            publicIp: p.public_ip,
            port: p.port || 1080,
            enabled: true,
            maxConnections: p.max_connections || 0,
          }))
        );

        await logActivity({
          supabase,
          userId: user.id,
          routerId,
          action: "delete",
          entityType: "socks5_proxy",
          entityId: proxyId,
          entityName: `${proxyToDelete.username}@${proxyToDelete.public_ip}`,
          details: {}
        });

        return NextResponse.json({ success: true });
      } catch (error) {
        const err = error as Error;
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    case "toggleProxy": {
      const { proxyId, enabled } = body;

      if (!proxyId || enabled === undefined) {
        return NextResponse.json({ error: "Proxy ID and enabled status required" }, { status: 400 });
      }

      try {
        // Update in database
        const { data: updatedProxy, error: updateError } = await supabase
          .from("socks5_proxies")
          .update({ enabled })
          .eq("id", proxyId)
          .select()
          .single();

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Rebuild config with only enabled proxies
        const { data: enabledProxies } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("router_id", routerId)
          .eq("enabled", true);

        await socks5Client.rebuildConfig(
          (enabledProxies || []).map((p: Socks5ProxyDB) => ({
            username: p.username,
            password: p.password,
            publicIp: p.public_ip,
            port: p.port || 1080,
            enabled: true,
            maxConnections: p.max_connections || 0,
          }))
        );

        await logActivity({
          supabase,
          userId: user.id,
          routerId,
          action: "update",
          entityType: "socks5_proxy",
          entityId: proxyId,
          entityName: `${updatedProxy.username}@${updatedProxy.public_ip}`,
          details: { enabled }
        });

        return NextResponse.json({ success: true, proxy: updatedProxy });
      } catch (error) {
        const err = error as Error;
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    case "renewProxy": {
      const { proxyId, expiresAt } = body;

      if (!proxyId) {
        return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
      }

      try {
        const { data: updatedProxy, error: updateError } = await supabase
          .from("socks5_proxies")
          .update({ expires_at: expiresAt })
          .eq("id", proxyId)
          .select()
          .single();

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, proxy: updatedProxy });
      } catch (error) {
        const err = error as Error;
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    case "updateExpiration": {
      const { proxyId, expiresAt, scheduledEnable } = body;

      if (!proxyId) {
        return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
      }

      try {
        const updates: Record<string, unknown> = {
          expires_at: expiresAt || null,
          scheduled_enable: scheduledEnable || null,
        };

        const { data: updatedProxy, error: updateError } = await supabase
          .from("socks5_proxies")
          .update(updates)
          .eq("id", proxyId)
          .select()
          .single();

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, proxy: updatedProxy });
      } catch (error) {
        const err = error as Error;
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    case "testProxy": {
      const { proxyId } = body;

      if (!proxyId) {
        return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
      }

      try {
        // Get proxy details
        const { data: proxy } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("id", proxyId)
          .single();

        if (!proxy) {
          return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
        }

        const result = await socks5Client.testProxy(
          proxy.public_ip,
          proxy.port || 1080,
          proxy.username,
          proxy.password
        );

        return NextResponse.json(result);
      } catch (error) {
        const err = error as Error;
        return NextResponse.json({
          success: false,
          error: err.message
        });
      }
    }

    case "getActiveConnections": {
      try {
        const connections = await socks5Client.getActiveConnections();
        return NextResponse.json({ connections });
      } catch (error) {
        const err = error as Error;
        console.error("[Socks5] Get connections error:", err.message);
        return NextResponse.json({ connections: {} });
      }
    }

    case "getPeers": {
      try {
        // Get WireGuard peers for IP usage info
        const { data: peers } = await supabase
          .from("wireguard_peers")
          .select("id, name, address, disabled, public_ip")
          .eq("router_id", routerId);

        return NextResponse.json({ peers: peers || [] });
      } catch (error) {
        const err = error as Error;
        return NextResponse.json({ peers: [], error: err.message });
      }
    }

    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
}

// DELETE: Delete a proxy
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const proxyId = searchParams.get("id");
  const routerId = searchParams.get("routerId");

  if (!proxyId || !routerId) {
    return NextResponse.json({ error: "Proxy ID and Router ID required" }, { status: 400 });
  }

  // Get router for SSH connection
  const { data: router } = await supabase
    .from("routers")
    .select("*")
    .eq("id", routerId)
    .single();

  if (!router) {
    return NextResponse.json({ error: "Router not found" }, { status: 404 });
  }

  // Get proxy info
  const { data: proxyToDelete } = await supabase
    .from("socks5_proxies")
    .select("*")
    .eq("id", proxyId)
    .single();

  if (!proxyToDelete) {
    return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
  }

  // Delete from database
  const { error: deleteError } = await supabase
    .from("socks5_proxies")
    .delete()
    .eq("id", proxyId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // Rebuild config
  const socks5Client = new Socks5ProxyClient({
    host: router.host,
    port: router.ssh_port || 22,
    username: router.ssh_username || "root",
    password: router.ssh_password,
    privateKey: router.ssh_private_key,
    authMethod: (router.ssh_auth_method || "password") as AuthMethod,
  });

  const { data: remainingProxies } = await supabase
    .from("socks5_proxies")
    .select("*")
    .eq("router_id", routerId)
    .eq("enabled", true);

  await socks5Client.rebuildConfig(
    (remainingProxies || []).map((p: Socks5ProxyDB) => ({
      username: p.username,
      password: p.password,
      publicIp: p.public_ip,
      port: p.port || 1080,
      enabled: true,
      maxConnections: p.max_connections || 0,
    }))
  );

  await logActivity({
    supabase,
    userId: user.id,
    routerId,
    action: "delete",
    entityType: "socks5_proxy",
    entityId: proxyId,
    entityName: `${proxyToDelete.username}@${proxyToDelete.public_ip}`,
    details: {}
  });

  return NextResponse.json({ success: true });
}
