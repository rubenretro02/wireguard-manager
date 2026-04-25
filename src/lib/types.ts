export type UserRole = "admin" | "user";

export type ConnectionType = "rest" | "rest-8443" | "api" | "api-ssl" | "linux-ssh";

export type AuthMethod = "password" | "key" | "both";

export interface UserCapabilities {
  can_auto_expire?: boolean;
  can_see_all_peers?: boolean;
  can_use_restricted_ips?: boolean;    // DEPRECATED - use user_ip_access table
  can_see_restricted_peers?: boolean;  // DEPRECATED - use user_ip_access table
  can_create_users?: boolean;          // Can create new users under their supervision
  can_manage_user_ips?: boolean;       // Can manage IP access for users they created
  can_delete?: boolean;                // Can delete peers and users (requires this capability)
  can_see_all_proxies?: boolean;       // Can see all proxies from parent user's group
  can_see_group_peers?: boolean;       // Can see all peers from parent user's group
}

export interface Profile {
  id: string;
  username: string | null;
  email: string;
  role: UserRole;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  capabilities?: UserCapabilities;
  created_by_user_id?: string | null;  // Who created this user (for supervision)
}

export type TimeUnit = "seconds" | "minutes" | "hours" | "days" | "weeks" | "months" | "years";

export interface PeerMetadata {
  id: string;
  router_id: string;
  peer_public_key: string;
  peer_name: string | null;
  peer_interface: string | null;
  allowed_address: string | null;
  created_at: string;
  created_by_email: string | null;
  created_by_user_id: string | null;
  expires_at: string | null;
  auto_disable_enabled: boolean;
  expiration_hours: number | null;
  expiration_value: number | null;
  expiration_unit: TimeUnit | null;
  last_status_check: string | null;
  scheduled_enable_at: string | null;
}

export interface Router {
  id: string;
  name: string;
  host: string;
  port: number;
  api_port: number;
  username: string;
  password: string;
  use_ssl: boolean;
  connection_type: ConnectionType;
  created_by: string | null;
  created_at: string;
  // IP Configuration fields
  public_ip_prefix: string | null;
  public_ip_mask: string | null;
  public_ip_network: string | null;
  internal_prefix: string | null;
  out_interface: string | null;
  wg_interface: string | null;
  // Linux SSH fields
  ssh_port: number | null;
  ssh_key: string | null;
  ssh_auth_method: AuthMethod | null;
}

export interface PublicIP {
  id: string;
  router_id: string;
  ip_number: number;
  public_ip: string;
  internal_subnet: string;
  enabled: boolean;
  restricted: boolean;
  nat_rule_created: boolean;
  ip_address_created: boolean;
  wg_ip_created: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface UserRouter {
  id: string;
  user_id: string;
  router_id: string;
  created_at: string;
}

export interface UserIpAccess {
  id: string;
  user_id: string;
  router_id: string;
  ip_id: string;
  can_use: boolean;
  created_by: string | null;
  created_at: string;
  // Joined data
  public_ips?: PublicIP;
  routers?: Router;
}

export interface WireGuardInterface {
  ".id": string;
  name: string;
  "public-key": string;
  "private-key"?: string;
  "listen-port": number;
  mtu?: number;
  disabled: boolean;
  running: boolean;
}

export interface WireGuardPeer {
  ".id": string;
  name?: string;
  interface: string;
  "public-key": string;
  "private-key"?: string;
  "endpoint-address"?: string;
  "endpoint-port"?: number;
  "allowed-address": string;
  "current-endpoint-address"?: string;
  "current-endpoint-port"?: number;
  "persistent-keepalive"?: string;
  rx?: number;
  tx?: number;
  "last-handshake"?: string;
  disabled: boolean;
  comment?: string;
}
