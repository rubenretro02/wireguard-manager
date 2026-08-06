import nacl from "tweetnacl";

export interface WireGuardKeyPair {
  privateKey: string;
  publicKey: string;
}

/**
 * Generate a WireGuard key pair
 * WireGuard uses Curve25519 for key exchange
 */
export function generateKeyPair(): WireGuardKeyPair {
  // Generate a random 32-byte private key
  const privateKeyBytes = nacl.randomBytes(32);

  // Clamp the private key as per Curve25519 requirements
  privateKeyBytes[0] &= 248;
  privateKeyBytes[31] &= 127;
  privateKeyBytes[31] |= 64;

  // Generate public key from private key using scalar multiplication
  const publicKeyBytes = nacl.scalarMult.base(privateKeyBytes);

  // Convert to base64
  const privateKey = Buffer.from(privateKeyBytes).toString("base64");
  const publicKey = Buffer.from(publicKeyBytes).toString("base64");

  return { privateKey, publicKey };
}

/**
 * Derive the public key of an existing private key (same Curve25519 math as
 * `wg pubkey`). Used to back up server interface keys read from their .conf.
 */
export function publicKeyFromPrivate(privateKey: string): string | null {
  try {
    const bytes = Buffer.from(privateKey.trim(), "base64");
    if (bytes.length !== 32) return null;
    return Buffer.from(nacl.scalarMult.base(new Uint8Array(bytes))).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Validate a WireGuard key (base64 encoded, 32 bytes when decoded)
 */
export function isValidKey(key: string): boolean {
  try {
    const decoded = Buffer.from(key, "base64");
    return decoded.length === 32;
  } catch {
    return false;
  }
}
