/**
 * Shared Solana ID validation for Helius routes.
 * Addresses/mints: 32–44 base58 chars. Transaction signatures: ~88 base58 chars.
 */

/** Base58 alphabet (no 0, O, I, l). */
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Solana address or mint: 32–44 base58 characters. */
export function isValidSolanaAddress(value: string): boolean {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length >= 32 && s.length <= 44 && BASE58_REGEX.test(s);
}

/** Lookup id: address, mint, or transaction signature (32–96 base58 chars). */
export function isValidLookupId(value: string): boolean {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length >= 32 && s.length <= 96 && BASE58_REGEX.test(s);
}
