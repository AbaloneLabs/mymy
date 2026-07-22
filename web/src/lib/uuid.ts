type UuidCrypto = {
  randomUUID?: () => string;
  getRandomValues?: Crypto["getRandomValues"];
};

/**
 * Creates collision-resistant browser identifiers without requiring a secure
 * HTTP context. Browsers intentionally hide `randomUUID` on some LAN HTTP
 * origins, while `getRandomValues` remains available there. Idempotency and
 * recovery ownership must never fall back to `Math.random`, so an environment
 * without either cryptographic primitive fails explicitly.
 */
export function createUuid(
  cryptoApi: UuidCrypto | undefined = globalThis.crypto,
): string {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("Secure random number generation is unavailable in this browser.");
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
