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
  | "session";

interface LogActivityParams {
  supabase: SupabaseClient;
  userId: string;
  routerId?: string | null;
  action: ActionType;
  entityType: EntityType;
  entityId?: string | null;
  entityName?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
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
}: LogActivityParams): Promise<void> {
  try {
    console.log("[Activity Logger] Logging activity:", { action, entityType, entityName, userId, routerId });

    const { data, error } = await supabase.from("activity_logs").insert({
      user_id: userId,
      router_id: routerId || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      entity_name: entityName || null,
      details: details || {},
      ip_address: ipAddress || null,
    }).select();

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
