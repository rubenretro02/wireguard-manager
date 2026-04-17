// User types
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'client';
  createdAt: Date;
  balance: number;
}

// IP for sale types
export interface IPForSale {
  id: string;
  ipAddress: string;
  country: string;
  state: string;
  city: string;
  isAvailable: boolean;
  isSold: boolean;
  assignedTo?: string;
  price: number;
  createdAt: Date;
}

// Location types
export interface Location {
  country: string;
  state: string;
  city: string;
  availableCount: number;
}

// Subscription types
export interface Subscription {
  id: string;
  userId: string;
  ipId: string;
  peerId: string;
  startDate: Date;
  endDate: Date;
  duration: '1month' | '3months' | '6months' | '1year';
  status: 'active' | 'expired' | 'cancelled' | 'pending';
  autoRenew: boolean;
  price: number;
  peerConfig?: string;
}

// Pricing types
export interface Pricing {
  id: string;
  name: string;
  duration: '1month' | '3months' | '6months' | '1year';
  basePrice: number;
  discount: number;
  finalPrice: number;
  isActive: boolean;
}

// Payment types
export interface Payment {
  id: string;
  userId: string;
  subscriptionId?: string;
  amount: number;
  currency: string;
  cryptoAmount?: number;
  cryptoCurrency?: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  paymentUrl?: string;
  cryptomusOrderId?: string;
  createdAt: Date;
  completedAt?: Date;
}

// WireGuard types
export interface WireGuardInterface {
  ".id": string;
  name: string;
  "public-key": string;
  "private-key"?: string;
  "listen-port": number;
  disabled: boolean;
  running: boolean;
}

export interface WireGuardPeer {
  ".id": string;
  interface: string;
  "public-key": string;
  "private-key"?: string;
  "allowed-address": string;
  "endpoint-address"?: string;
  "endpoint-port"?: number;
  "current-endpoint-address"?: string;
  "current-endpoint-port"?: number;
  "persistent-keepalive"?: string;
  "last-handshake"?: string;
  disabled: boolean;
  comment?: string;
  name?: string;
  rx?: number;
  tx?: number;
}

// Router configuration
export interface RouterConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  apiPort: number;
  username: string;
  password: string;
  useSsl: boolean;
  connectionType: 'rest' | 'api';
  interfaceName: string;
  serverPublicKey: string;
  serverEndpoint: string;
  allowedIps: string;
  dns: string;
}

// Order types
export interface Order {
  id: string;
  userId: string;
  ipId: string;
  duration: '1month' | '3months' | '6months' | '1year';
  price: number;
  status: 'pending' | 'paid' | 'provisioning' | 'active' | 'failed';
  paymentId?: string;
  location: {
    country: string;
    state: string;
    city: string;
  };
  createdAt: Date;
}

// Dashboard stats
export interface AdminStats {
  totalUsers: number;
  activeSubscriptions: number;
  totalRevenue: number;
  availableIPs: number;
  soldIPs: number;
  pendingOrders: number;
}

export interface ClientStats {
  activeSubscriptions: number;
  totalSpent: number;
  daysRemaining: number;
}

// API responses
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Cryptomus types
export interface CryptomusPaymentRequest {
  amount: string;
  currency: string;
  order_id: string;
  url_callback: string;
  url_return: string;
  url_success: string;
  lifetime: number;
  is_payment_multiple: boolean;
}

export interface CryptomusPaymentResponse {
  state: number;
  result: {
    uuid: string;
    order_id: string;
    amount: string;
    payment_amount: string;
    payer_amount: string;
    discount_percent: number;
    discount: string;
    payer_currency: string;
    currency: string;
    merchant_amount: string;
    network: string;
    address: string;
    from: string;
    txid: string;
    payment_status: string;
    url: string;
    expired_at: number;
    status: string;
    is_final: boolean;
    additional_data: string;
    created_at: string;
    updated_at: string;
  };
}

// Config generation
export interface PeerConfigData {
  privateKey: string;
  address: string;
  dns: string;
  serverPublicKey: string;
  serverEndpoint: string;
  allowedIps: string;
}
