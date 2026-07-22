import { describe, expect, it } from "vitest";
import { createUuid } from "./uuid";

describe("createUuid", () => {
  it("uses the native UUID implementation when available", () => {
    const expected = "018f47a2-23ec-7e1d-8f61-7c07c7ef9832";
    expect(createUuid({ randomUUID: () => expected })).toBe(expected);
  });

  it("creates an RFC 4122 version 4 UUID from random bytes", () => {
    const result = createUuid({
      getRandomValues: <T extends Exclude<BufferSource, ArrayBuffer>>(bytes: T) => {
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).set(
          Array.from({ length: 16 }, (_, index) => index),
        );
        return bytes;
      },
    });

    expect(result).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("does not create weak identifiers without browser cryptography", () => {
    expect(() => createUuid({})).toThrow(
      "Secure random number generation is unavailable",
    );
  });
});
