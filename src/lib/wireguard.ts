import type { PeerConfigData } from './types';

// Generate a random base64 key (simulated for demo)
function generateRandomKey(): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  // Clamp for Curve25519
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;

  return btoa(String.fromCharCode(...bytes));
}

// Generate WireGuard key pair
export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const privateKey = generateRandomKey();
  // In a real implementation, this would derive the public key from the private key
  // For demo purposes, we generate a separate key
  const publicKey = generateRandomKey();

  return { privateKey, publicKey };
}

// Generate WireGuard configuration file content
export function generatePeerConfig(data: PeerConfigData): string {
  return `[Interface]
PrivateKey = ${data.privateKey}
Address = ${data.address}
DNS = ${data.dns}

[Peer]
PublicKey = ${data.serverPublicKey}
Endpoint = ${data.serverEndpoint}
AllowedIPs = ${data.allowedIps}
PersistentKeepalive = 25
`;
}

// Generate a unique allowed address for a new peer
export function generateAllowedAddress(existingAddresses: string[]): string {
  const usedIPs = new Set(
    existingAddresses.map((addr) => {
      const match = addr.match(/10\.0\.0\.(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })
  );

  // Find the next available IP in the 10.0.0.x range
  for (let i = 2; i < 255; i++) {
    if (!usedIPs.has(i)) {
      return `10.0.0.${i}/32`;
    }
  }

  throw new Error('No available IP addresses in the range');
}

// Server configuration (would be stored in environment/database in production)
export const defaultServerConfig = {
  publicKey: 'SERVER_PUBLIC_KEY_PLACEHOLDER',
  endpoint: 'vpn.blackgott.com:51820',
  allowedIps: '0.0.0.0/0',
  dns: '1.1.1.1, 8.8.8.8',
  interfaceName: 'wg0',
};

// Create a new peer configuration
export function createPeerConfiguration(
  ipAddress: string,
  existingPeerAddresses: string[] = []
): {
  config: string;
  privateKey: string;
  publicKey: string;
  allowedAddress: string;
} {
  const keyPair = generateKeyPair();
  const allowedAddress = generateAllowedAddress(existingPeerAddresses);

  const configData: PeerConfigData = {
    privateKey: keyPair.privateKey,
    address: allowedAddress.replace('/32', '/24'),
    dns: defaultServerConfig.dns,
    serverPublicKey: defaultServerConfig.publicKey,
    serverEndpoint: defaultServerConfig.endpoint,
    allowedIps: defaultServerConfig.allowedIps,
  };

  return {
    config: generatePeerConfig(configData),
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    allowedAddress,
  };
}

// Calculate subscription end date based on duration
export function calculateEndDate(
  startDate: Date,
  duration: '1month' | '3months' | '6months' | '1year'
): Date {
  const endDate = new Date(startDate);

  switch (duration) {
    case '1month':
      endDate.setMonth(endDate.getMonth() + 1);
      break;
    case '3months':
      endDate.setMonth(endDate.getMonth() + 3);
      break;
    case '6months':
      endDate.setMonth(endDate.getMonth() + 6);
      break;
    case '1year':
      endDate.setFullYear(endDate.getFullYear() + 1);
      break;
  }

  return endDate;
}

// Format duration for display
export function formatDuration(duration: '1month' | '3months' | '6months' | '1year'): string {
  switch (duration) {
    case '1month':
      return '1 Month';
    case '3months':
      return '3 Months';
    case '6months':
      return '6 Months';
    case '1year':
      return '1 Year';
  }
}

// Check if subscription is expiring soon (within 7 days)
export function isExpiringSoon(endDate: Date): boolean {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return new Date(endDate) <= sevenDaysFromNow && new Date(endDate) > now;
}

// Check if subscription is expired
export function isExpired(endDate: Date): boolean {
  return new Date(endDate) < new Date();
}

// Days remaining in subscription
export function daysRemaining(endDate: Date): number {
  const now = new Date();
  const end = new Date(endDate);
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}
