export type UserRole = "admin" | "user";

export interface UserCapabilities {
  can_auto_expire?: boolean;
  can_see_all_peers?: boolean;
  can_use_restricted_ips?: boolean;    // Can CREATE peers with restricted IPs
  can_see_restricted_peers?: boolean;  // Can SEE peers that use restricted IPs
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
}

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
  last_status_check: string | null;
}

export type ConnectionType = "rest" | "rest-8443" | "api" | "api-ssl";

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

export interface RouterClient {
  id: string;
  name: string;
  host: string;
  api_port: number;
  username: string;
  password: string;
  use_ssl: boolean;
  // Estado
  is_online: boolean;
  last_seen: string | null;
  last_error: string | null;
  // Info del router
  router_model: string | null;
  router_os_version: string | null;
  uptime: string | null;
  cpu_load: number | null;
  memory_used: number | null;
  memory_total: number | null;
  // VPN Status
  vpn_configured: boolean;
  vpn_interface_name: string | null;
  vpn_connected: boolean;
  vpn_last_handshake: string | null;
  // Configuración VPN (peer info)
  vpn_private_key: string | null;
  vpn_address: string | null;
  vpn_peer_public_key: string | null;
  vpn_endpoint_ip: string | null;
  vpn_endpoint_port: number | null;
  vpn_dns1: string | null;
  vpn_dns2: string | null;
  vpn_mtu: number;
  // Metadata
  notes: string | null;
  tags: string[] | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RouterClientLog {
  id: string;
  router_client_id: string;
  action: string;
  status: "success" | "error" | "pending";
  details: string | null;
  executed_by: string | null;
  created_at: string;
}

export interface VpnPeerConfig {
  privateKey: string;
  address: string;
  peerPublicKey: string;
  endpointIP: string;
  endpointPort: number;
  dns1: string;
  dns2: string;
  mtu: number;
  keepalive: number;
}