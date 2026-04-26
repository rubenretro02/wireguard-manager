import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { Socks5ProxyClient } from "@/lib/socks5-proxy";

// Type for SOCKS5 proxy from database
interface Socks5ProxyDB {
  id: string;
  router_id: string;
  username: string;
  password: string;
  public_ip: string;
  port: number;
  enabled: boolean;
  max_connections: number | null;
  name: string | null;
  expires_at: string | null;
  scheduled_enable: string | null;
  created_by: string;
  created_at: string;
  last_connected_at: string | null;
  bytes_sent: number;
  bytes_received: number;
  creator?: { email: string } | null;
}

// Helper function to check if user is admin (bypasses RLS using service role)
async function checkIsAdmin(userId: string): Promise<boolean> {
  const adminClient = createAdminClient();
  if (!adminClient) {
    console.error("[SOCKS5 API] No admin client - missing SUPABASE_SERVICE_ROLE_KEY");
    return false;
  }

  const { data: profile, error } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[SOCKS5 API] checkIsAdmin error:", error.message);
    return false;
  }

  const isAdmin = profile?.role?.toLowerCase() === "admin";
  console.log("[SOCKS5 API] checkIsAdmin:", userId, "role:", profile?.role, "isAdmin:", isAdmin);
  return isAdmin;
}

// Check if user has access to a SOCKS5 server
async function hasServerAccess(
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
  userId: string,
  routerId: string,
  isAdmin: boolean
): Promise<boolean> {
  console.log(`[SOCKS5 API] hasServerAccess check - userId: ${userId}, routerId: ${routerId}, isAdmin: ${isAdmin}`);

  if (isAdmin) {
    console.log("[SOCKS5 API] User is admin, granting access");
    return true;
  }

  const { data, error } = await supabase
    .from("user_socks5_server_access")
    .select("id")
    .eq("user_id", userId)
    .eq("router_id", routerId)
    .single();

  if (error) {
    console.log(`[SOCKS5 API] user_socks5_server_access query error: ${error.message}`);
  }

  const hasAccess = !!data;
  console.log(`[SOCKS5 API] User has server access: ${hasAccess}`);
  return hasAccess;
}

// GET - List SOCKS5 proxies for a router
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

  // Check user role using admin client (bypasses RLS)
  const isAdmin = await checkIsAdmin(user.id);

  // Check access to this server
  if (!await hasServerAccess(supabase, user.id, routerId, isAdmin)) {
    return NextResponse.json({ error: "No access to this server" }, { status: 403 });
  }

  // Get router info
  const { data: router, error: routerError } = await supabase
    .from("routers")
    .select("*")
    .eq("id", routerId)
    .single();

  if (routerError || !router) {
    return NextResponse.json({ error: "Router not found" }, { status: 404 });
  }

  // Get SOCKS5 proxies from database
  // Admin sees all, semi-admin sees their own + their created users' proxies
  // Users with can_see_all_proxies see their group's proxies
  let proxies: unknown[] = [];

  // Get current user's profile to check capabilities
  const { data: userProfile } = await supabase
    .from("profiles")
    .select("capabilities, created_by_user_id")
    .eq("id", user.id)
    .single();

  const canSeeAllProxies = userProfile?.capabilities?.can_see_all_proxies || false;
  const createdByUserId = userProfile?.created_by_user_id;

  if (isAdmin) {
    // Admin sees all proxies for this router
    const { data, error } = await supabase
      .from("socks5_proxies")
      .select("*")
      .eq("router_id", routerId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    proxies = data || [];
  } else if (canSeeAllProxies && createdByUserId) {
    // User has can_see_all_proxies - see proxies from their parent + siblings
    // Get all users created by the same parent (siblings)
    const { data: siblings } = await supabase
      .from("profiles")
      .select("id")
      .eq("created_by_user_id", createdByUserId);

    const siblingIds = siblings?.map((s: { id: string }) => s.id) || [];

    // Include: parent user + all siblings (including self)
    const groupUserIds = [createdByUserId, ...siblingIds];

    const { data, error } = await supabase
      .from("socks5_proxies")
      .select("*")
      .eq("router_id", routerId)
      .in("created_by", groupUserIds)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    proxies = data || [];
  } else {
    // Regular user or semi-admin without can_see_all_proxies
    // Get IDs of users created by current user (for semi-admins)
    const { data: createdUsers } = await supabase
      .from("profiles")
      .select("id")
      .eq("created_by_user_id", user.id);

    const createdUserIds = createdUsers?.map((u: { id: string }) => u.id) || [];

    // Include current user's ID
    const allowedCreatorIds = [user.id, ...createdUserIds];

    // Get proxies created by current user OR their created users
    const { data, error } = await supabase
      .from("socks5_proxies")
      .select("*")
      .eq("router_id", routerId)
      .in("created_by", allowedCreatorIds)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    proxies = data || [];
  }

  return NextResponse.json({ proxies: proxies || [] });
}

// POST - Create SOCKS5 proxy or perform actions
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check user role using admin client (bypasses RLS)
  const isAdmin = await checkIsAdmin(user.id);

  const body = await request.json();
  const { action, routerId, ...params } = body;

  if (!routerId) {
    return NextResponse.json({ error: "Router ID required" }, { status: 400 });
  }

  // Admin always has access to all actions
  // Non-admin needs server access for certain actions
  const adminOnlyActions = ["install", "start", "stop", "restart", "syncFromServer"];

  if (adminOnlyActions.includes(action) && !isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // Check can_delete capability for delete actions
  if (action === "deleteProxy" && !isAdmin) {
    // Get user profile to check capabilities
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("capabilities")
      .eq("id", user.id)
      .single();

    const canDelete = userProfile?.capabilities?.can_delete === true;
    if (!canDelete) {
      return NextResponse.json({ error: "You don't have permission to delete proxies" }, { status: 403 });
    }
  }

  // For non-admin users, check server access
  if (!isAdmin) {
    const requiresServerAccess = ["getStatus", "getPublicIps", "createProxy", "updateProxy", "deleteProxy", "listProxies", "toggleProxy", "renewProxy", "testProxy", "updateExpiration", "getActiveConnections"];
    if (requiresServerAccess.includes(action)) {
      if (!await hasServerAccess(supabase, user.id, routerId, isAdmin)) {
        return NextResponse.json({ error: "No access to this server" }, { status: 403 });
      }
    }
  }

  // Get router info with password
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
    username: router.username,
    password: router.password,
    privateKey: router.ssh_key,
    authMethod: router.ssh_auth_method || "password",
  });

  try {
    switch (action) {
      case "getStatus": {
        const status = await socks5Client.getStatus();

        // If there's a connection error, check if we have proxies in the database
        // If we do, assume 3proxy is installed (just connection issue)
        if (status.connectionError) {
          const { data: existingProxies } = await supabase
            .from("socks5_proxies")
            .select("id")
            .eq("router_id", routerId)
            .eq("enabled", true)
            .limit(1);

          if (existingProxies && existingProxies.length > 0) {
            // We have active proxies, so assume installed but connection failed
            return NextResponse.json({
              status: { running: true, installed: true },
              publicIps: [],
              warning: `SSH connection issue: ${status.connectionError}. Status shown is estimated based on existing proxies.`
            });
          }

          // No proxies, return the error
          return NextResponse.json({
            error: `SSH connection failed: ${status.connectionError}`,
            status: { running: false, installed: false },
            publicIps: []
          });
        }

        const publicIps = await socks5Client.getAvailablePublicIps();
        return NextResponse.json({ status, publicIps });
      }

      case "install": {
        const result = await socks5Client.install3proxy();
        return NextResponse.json(result);
      }

      case "start": {
        const result = await socks5Client.start();
        return NextResponse.json(result);
      }

      case "stop": {
        const result = await socks5Client.stop();
        return NextResponse.json(result);
      }

      case "restart": {
        const result = await socks5Client.restart();
        return NextResponse.json(result);
      }

      case "getPublicIps": {
        const publicIps = await socks5Client.getAvailablePublicIps();
        return NextResponse.json({ publicIps });
      }

      case "syncFromServer": {
        // Get proxies from server config
        const serverProxies = await socks5Client.getServerProxies();

        // Get proxies from database
        const { data: dbProxies } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("router_id", routerId);

        const dbIps = new Set((dbProxies || []).map((p: Socks5ProxyDB) => p.public_ip));
        const serverIps = new Set(serverProxies.map(p => p.publicIp));

        // Add missing proxies to database
        const toAdd = serverProxies.filter(p => !dbIps.has(p.publicIp));
        for (const proxy of toAdd) {
          await supabase.from("socks5_proxies").insert({
            router_id: routerId,
            username: proxy.username,
            password: proxy.password,
            public_ip: proxy.publicIp,
            port: 1080,
            enabled: true,
            created_by: user.id,
          });
        }

        // Remove proxies from database that don't exist on server
        const toRemove = (dbProxies || []).filter((p: Socks5ProxyDB) => !serverIps.has(p.public_ip));
        for (const proxy of toRemove) {
          await supabase.from("socks5_proxies").delete().eq("id", proxy.id);
        }

        return NextResponse.json({
          success: true,
          added: toAdd.length,
          removed: toRemove.length,
          serverProxies: serverProxies.length
        });
      }

      case "createProxy": {
        const { username, password, publicIp, maxConnections, name, expiresAt } = params;

        if (!username || !password || !publicIp) {
          return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Validate that the selected IP actually exists on this server
        const availableIps = await socks5Client.getAvailablePublicIps();
        if (!availableIps.includes(publicIp)) {
          return NextResponse.json({
            error: `IP ${publicIp} does not exist on this server. Available IPs: ${availableIps.slice(0, 5).join(", ")}...`
          }, { status: 400 });
        }

        const port = 1080;

        // Save to database first
        const { data: proxy, error: insertError } = await supabase
          .from("socks5_proxies")
          .insert({
            router_id: routerId,
            username,
            password,
            public_ip: publicIp,
            port,
            max_connections: maxConnections || 0,
            name: name || null,
            expires_at: expiresAt || null,
            enabled: true,
            created_by: user.id,
          })
          .select()
          .single();

        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 500 });
        }

        // Get ALL proxies for this router and rebuild config
        const { data: allProxies } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("router_id", routerId)
          .eq("enabled", true);

        const proxiesForConfig = (allProxies || []).map((p: Socks5ProxyDB) => ({
          username: p.username,
          password: p.password,
          publicIp: p.public_ip,
          port: 1080,
          enabled: true,
          maxConnections: p.max_connections || 0,
        }));

        // Rebuild entire config with all proxies
        const result = await socks5Client.rebuildConfig(proxiesForConfig);

        if (!result.success) {
          await supabase.from("socks5_proxies").delete().eq("id", proxy.id);
          return NextResponse.json({ error: result.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, proxy });
      }

      case "deleteProxy": {
        const { proxyId } = params;

        if (!proxyId) {
          return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
        }

        const { data: proxy, error: proxyError } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("id", proxyId)
          .single();

        if (proxyError || !proxy) {
          return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
        }

        // Check ownership - only admin or owner can delete
        if (!isAdmin && proxy.created_by !== user.id) {
          return NextResponse.json({ error: "You can only delete your own proxies" }, { status: 403 });
        }

        // Remove from database
        const { error: deleteError } = await supabase
          .from("socks5_proxies")
          .delete()
          .eq("id", proxyId);

        if (deleteError) {
          return NextResponse.json({ error: deleteError.message }, { status: 500 });
        }

        // Get remaining proxies and rebuild config
        const { data: remainingProxies } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("router_id", routerId)
          .eq("enabled", true);

        const proxiesForConfig = (remainingProxies || []).map((p: Socks5ProxyDB) => ({
          username: p.username,
          password: p.password,
          publicIp: p.public_ip,
          port: 1080,
          enabled: true,
          maxConnections: p.max_connections || 0,
        }));

        await socks5Client.rebuildConfig(proxiesForConfig);

        return NextResponse.json({ success: true });
      }

      case "updateProxy": {
        const { proxyId, password, maxConnections, name } = params;

        if (!proxyId) {
          return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
        }

        // Get proxy to check ownership
        const { data: proxy, error: proxyError } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("id", proxyId)
          .single();

        if (proxyError || !proxy) {
          return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
        }

        // Check ownership - only admin or owner can update
        if (!isAdmin && proxy.created_by !== user.id) {
          return NextResponse.json({ error: "You can only update your own proxies" }, { status: 403 });
        }

        // Update in database
        const updateData: Record<string, unknown> = {};
        if (password !== undefined) updateData.password = password;
        if (maxConnections !== undefined) updateData.max_connections = maxConnections;
        if (name !== undefined) updateData.name = name;

        const { error: updateError } = await supabase
          .from("socks5_proxies")
          .update(updateData)
          .eq("id", proxyId);

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Rebuild config with updated proxies
        const { data: allProxies } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("router_id", routerId)
          .eq("enabled", true);

        const proxiesForConfigUpdate = (allProxies || []).map((p: Socks5ProxyDB) => ({
          username: p.username,
          password: p.password,
          publicIp: p.public_ip,
          port: 1080,
          enabled: true,
          maxConnections: p.max_connections || 0,
        }));

        await socks5Client.rebuildConfig(proxiesForConfigUpdate);

        return NextResponse.json({ success: true });
      }

      case "toggleProxy": {
        const { proxyId, enabled, clearScheduledEnable } = params;

        if (!proxyId) {
          return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
        }

        // Get proxy to check ownership
        const { data: proxy, error: proxyError } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("id", proxyId)
          .single();

        if (proxyError || !proxy) {
          return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
        }

        // Check ownership - only admin or owner can toggle
        if (!isAdmin && proxy.created_by !== user.id) {
          return NextResponse.json({ error: "You can only manage your own proxies" }, { status: 403 });
        }

        // Update enabled status in database
        const updateData: Record<string, unknown> = { enabled };
        if (clearScheduledEnable) {
          updateData.scheduled_enable = null;
        }

        const { error: updateError } = await supabase
          .from("socks5_proxies")
          .update(updateData)
          .eq("id", proxyId);

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Rebuild config with only enabled proxies
        const { data: allProxies } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("router_id", routerId)
          .eq("enabled", true);

        const proxiesForConfig = (allProxies || []).map((p: Socks5ProxyDB) => ({
          username: p.username,
          password: p.password,
          publicIp: p.public_ip,
          port: 1080,
          enabled: true,
          maxConnections: p.max_connections || 0,
        }));

        await socks5Client.rebuildConfig(proxiesForConfig);

        return NextResponse.json({ success: true });
      }

      case "renewProxy": {
        const { proxyId, expiresAt } = params;

        if (!proxyId) {
          return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
        }

        // Get proxy to check ownership
        const { data: proxy, error: proxyError } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("id", proxyId)
          .single();

        if (proxyError || !proxy) {
          return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
        }

        // Check ownership - only admin or owner can renew
        if (!isAdmin && proxy.created_by !== user.id) {
          return NextResponse.json({ error: "You can only manage your own proxies" }, { status: 403 });
        }

        // Update expires_at and enable the proxy
        const { error: updateError } = await supabase
          .from("socks5_proxies")
          .update({
            expires_at: expiresAt,
            enabled: true,
          })
          .eq("id", proxyId);

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Rebuild config with enabled proxies
        const { data: allProxies } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("router_id", routerId)
          .eq("enabled", true);

        const proxiesForConfig = (allProxies || []).map((p: Socks5ProxyDB) => ({
          username: p.username,
          password: p.password,
          publicIp: p.public_ip,
          port: 1080,
          enabled: true,
          maxConnections: p.max_connections || 0,
        }));

        await socks5Client.rebuildConfig(proxiesForConfig);

        return NextResponse.json({ success: true });
      }

      case "updateExpiration": {
        const { proxyId, expiresAt, scheduledEnable } = params;

        if (!proxyId) {
          return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
        }

        // Get proxy to check ownership
        const { data: proxy, error: proxyError } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("id", proxyId)
          .single();

        if (proxyError || !proxy) {
          return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
        }

        // Check ownership - only admin or owner can update
        if (!isAdmin && proxy.created_by !== user.id) {
          return NextResponse.json({ error: "You can only manage your own proxies" }, { status: 403 });
        }

        // Update expiration settings
        const { error: updateError } = await supabase
          .from("socks5_proxies")
          .update({
            expires_at: expiresAt || null,
            scheduled_enable: scheduledEnable || null,
          })
          .eq("id", proxyId);

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      case "testProxy": {
        const { proxyId } = params;

        if (!proxyId) {
          return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
        }

        // Get proxy
        const { data: proxy, error: proxyError } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("id", proxyId)
          .single();

        if (proxyError || !proxy) {
          return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
        }

        // Check if proxy is enabled
        if (!proxy.enabled) {
          return NextResponse.json({ error: "Proxy is disabled", success: false });
        }

        // Test the proxy by trying to get the exit IP
        // We'll use curl through SSH to test
        try {
          const startTime = Date.now();
          const result = await socks5Client.testProxy(proxy.public_ip, 1080, proxy.username, proxy.password);
          const latency = Date.now() - startTime;

          if (result.success) {
            // Update last_connected_at
            await supabase
              .from("socks5_proxies")
              .update({ last_connected_at: new Date().toISOString() })
              .eq("id", proxyId);

            return NextResponse.json({
              success: true,
              ip: result.ip,
              latency
            });
          } else {
            return NextResponse.json({
              success: false,
              error: result.error || "Proxy test failed"
            });
          }
        } catch (error) {
          const err = error as Error;
          return NextResponse.json({
            success: false,
            error: err.message || "Proxy test failed"
          });
        }
      }

      case "listProxies": {
        const proxies = await socks5Client.listSocks5Proxies();
        return NextResponse.json({ proxies });
      }

      case "getActiveConnections": {
        // Get active connections per IP from the server
        const activeConnections = await socks5Client.getActiveConnections();

        // Update last_connected_at for proxies with active connections
        const { data: proxies } = await supabase
          .from("socks5_proxies")
          .select("id, public_ip")
          .eq("router_id", routerId);

        if (proxies) {
          for (const proxy of proxies) {
            if (activeConnections[proxy.public_ip] && activeConnections[proxy.public_ip] > 0) {
              await supabase
                .from("socks5_proxies")
                .update({ last_connected_at: new Date().toISOString() })
                .eq("id", proxy.id);
            }
          }
        }

        return NextResponse.json({
          success: true,
          activeConnections
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    const err = error as Error;
    console.error("[SOCKS5 API] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE - Remove SOCKS5 proxy
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check user role using admin client (bypasses RLS)
  const isAdmin = await checkIsAdmin(user.id);

  const { searchParams } = new URL(request.url);
  const proxyId = searchParams.get("id");

  if (!proxyId) {
    return NextResponse.json({ error: "Proxy ID required" }, { status: 400 });
  }

  // Get proxy info
  const { data: proxy, error: proxyError } = await supabase
    .from("socks5_proxies")
    .select("*, routers(*)")
    .eq("id", proxyId)
    .single();

  if (proxyError || !proxy) {
    return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
  }

  // Check ownership - only admin or owner can delete
  if (!isAdmin && proxy.created_by !== user.id) {
    return NextResponse.json({ error: "You can only delete your own proxies" }, { status: 403 });
  }

  const router = proxy.routers;

  // Create SOCKS5 client
  const socks5Client = new Socks5ProxyClient({
    host: router.host,
    port: router.ssh_port || 22,
    username: router.username,
    password: router.password,
    privateKey: router.ssh_key,
    authMethod: router.ssh_auth_method || "password",
  });

  // Remove from server
  await socks5Client.removeSocks5User(proxy.username, proxy.port);

  // Remove from database
  const { error: deleteError } = await supabase
    .from("socks5_proxies")
    .delete()
    .eq("id", proxyId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
