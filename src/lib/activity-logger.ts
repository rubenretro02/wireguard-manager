import type { SupabaseClient } from "@supabase/supabase-js";

export type ActionType =
  | "create"
  | "update"
  | "delete"
  | "enable"
  | "disable"
  | "renew"
  | "connect"
  | "disconnect"
  | "login"
  | "logout";

export type EntityType =
  | "peer"
  | "public_ip"
  | "router"
  | "user"
  | "interface"
  | "nat_rule"
  | "session"
  | "socks5"
  | "api_key"
  | "starhome_account"
  | "starhome_slot";

interface LogActivityParams {
  supabase: SupabaseClient;
  /** null = evento de sistema (cron, webhook). La columna es nullable. */
  userId: string | null;
  routerId?: string | null;
  action: ActionType;
  entityType: EntityType;
  entityId?: string | null;
  entityName?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  /**
   * v31: the peer this event belongs to. entity_id is inconsistent across
   * platforms (linux_peers id, MikroTik .id, key prefix…), so the per-peer log
   * indexes by public key instead. Falls back to details.publicKey.
   */
  peerPublicKey?: string | null;
}

export async function logActivity({
  supabase,
  userId,
  routerId,
  action,
  entityType,
  entityId,
  entityName,
  details,
  ipAddress,
  peerPublicKey,
}: LogActivityParams): Promise<void> {
  try {
    console.log("[Activity Logger] Logging activity:", { action, entityType, entityName, userId, routerId });

    const keyFromDetails = details?.publicKey ?? details?.peerPublicKey ?? details?.["public-key"];
    const peerKey = peerPublicKey || (typeof keyFromDetails === "string" ? keyFromDetails : null);

    const row: Record<string, unknown> = {
      user_id: userId,
      router_id: routerId || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      entity_name: entityName || null,
      details: details || {},
      ip_address: ipAddress || null,
      peer_public_key: entityType === "peer" ? peerKey : null,
    };

    let { data, error } = await supabase.from("activity_logs").insert(row).select();

    // Until migration v31 runs the column doesn't exist — never let that kill
    // the whole log (that exact silent failure already happened once, see v25).
    if (error && /peer_public_key/.test(error.message)) {
      delete row.peer_public_key;
      ({ data, error } = await supabase.from("activity_logs").insert(row).select());
    }

    if (error) {
      console.error("[Activity Logger] Supabase error:", error);
    } else {
      console.log("[Activity Logger] Log inserted successfully:", data);
    }
  } catch (error) {
    // Log error but don't throw - activity logging shouldn't break main functionality
    console.error("[Activity Logger] Failed to log activity:", error);
  }
}

// Helper to format log messages for display
export function formatLogMessage(
  action: ActionType,
  entityType: EntityType,
  entityName?: string | null
): string {
  const actionVerbs: Record<ActionType, string> = {
    create: "Created",
    update: "Updated",
    delete: "Deleted",
    enable: "Enabled",
    disable: "Disabled",
    renew: "Renewed",
    connect: "Connected to",
    disconnect: "Disconnected from",
    login: "Logged in",
    logout: "Logged out",
  };

  const entityLabels: Record<EntityType, string> = {
    peer: "peer",
    public_ip: "public IP",
    router: "router",
    user: "user",
    interface: "interface",
    nat_rule: "NAT rule",
    session: "session",
    socks5: "SOCKS5 proxy",
    api_key: "API key",
    starhome_account: "StarHome account",
    starhome_slot: "StarHome slot",
  };

  const verb = actionVerbs[action] || action;
  const entity = entityLabels[entityType] || entityType;

  if (entityName) {
    return `${verb} ${entity} "${entityName}"`;
  }
  return `${verb} ${entity}`;
}

// Get icon name for action type
export function getActionIcon(action: ActionType): string {
  const icons: Record<ActionType, string> = {
    create: "Plus",
    update: "Pencil",
    delete: "Trash2",
    enable: "Power",
    disable: "PowerOff",
    renew: "RefreshCw",
    connect: "Plug",
    disconnect: "Unplug",
    login: "LogIn",
    logout: "LogOut",
  };
  return icons[action] || "Activity";
}

// Get color for action type
export function getActionColor(action: ActionType): string {
  const colors: Record<ActionType, string> = {
    create: "text-green-500",
    update: "text-blue-500",
    delete: "text-red-500",
    enable: "text-green-500",
    disable: "text-orange-500",
    renew: "text-cyan-500",
    connect: "text-green-500",
    disconnect: "text-orange-500",
    login: "text-blue-500",
    logout: "text-gray-500",
  };
  return colors[action] || "text-gray-500";
}
