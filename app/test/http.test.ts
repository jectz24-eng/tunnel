import { describe, expect, it } from "vitest";
import { intParam, isBase58Address } from "@/server/http";

describe("intParam", () => {
  it("uses the default when the parameter is missing or empty", () => {
    expect(intParam(null, 100, 1, 500)).toBe(100);
    expect(intParam("", 100, 1, 500)).toBe(100);
  });
  it("clamps and floors provided values", () => {
    expect(intParam("0", 100, 1, 500)).toBe(1);
    expect(intParam("9999", 100, 1, 500)).toBe(500);
    expect(intParam("12.7", 100, 1, 500)).toBe(12);
    expect(intParam("abc", 100, 1, 500)).toBe(100);
  });
});

describe("isBase58Address", () => {
  it("accepts public keys and rejects junk", () => {
    expect(isBase58Address("GyywTr1c6yTJPSxDiADUfawcpuQBQ6JPwMKaoC6WrhF9")).toBe(true);
    expect(isBase58Address("not-an-address")).toBe(false);
    expect(isBase58Address(null)).toBe(false);
  });
});
