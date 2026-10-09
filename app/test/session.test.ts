import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildSignInMessage, checkSignInMessage, issueSession, readSession } from "@/server/session";

const origin = "https://tunnel.example";

beforeAll(() => {
  process.env.SESSION_SECRET = "x".repeat(48);
});

describe("Sign-In With Solana", () => {
  const kp = Keypair.generate();
  const address = kp.publicKey.toBase58();

  it("accepts a fresh, correctly bound message whose signature verifies", () => {
    const msg = buildSignInMessage(address, origin);
    expect(checkSignInMessage(msg, address, origin)).toBeNull();
    const sig = nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey);
    expect(nacl.sign.detached.verify(new TextEncoder().encode(msg), sig, kp.publicKey.toBytes())).toBe(true);
    expect(msg).toContain("will not trigger a blockchain transaction");
  });

  it("rejects a message issued for another address", () => {
    const other = Keypair.generate().publicKey.toBase58();
    expect(checkSignInMessage(buildSignInMessage(other, origin), address, origin)).toBe("address mismatch");
  });

  it("rejects a message for another domain (phishing relay)", () => {
    expect(checkSignInMessage(buildSignInMessage(address, "https://evil.example"), address, origin)).toBe("domain mismatch");
  });

  it("rejects a tampered nonce or timestamp", () => {
    const msg = buildSignInMessage(address, origin);
    expect(checkSignInMessage(msg.replace(/Issued At: .+/, "Issued At: 2030-01-01T00:00:00.000Z"), address, origin)).toBe("invalid nonce");
    expect(checkSignInMessage(msg.replace(/Nonce: (\w+)\.(.+)/, "Nonce: $1.AAAA"), address, origin)).toBe("invalid nonce");
  });

  it("expires after five minutes", () => {
    const msg = buildSignInMessage(address, origin);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect(checkSignInMessage(msg, address, origin)).toBe("message expired");
    vi.useRealTimers();
  });
});

describe("session cookies", () => {
  it("round-trip and reject forgery", () => {
    const { value } = issueSession("Addr1111");
    expect(readSession(value)).toBe("Addr1111");
    const [a, exp, tag] = value.split(".");
    expect(readSession(`Other.${exp}.${tag}`)).toBeNull();
    expect(readSession(`${a}.${Number(exp) + 1}.${tag}`)).toBeNull();
    expect(readSession(undefined)).toBeNull();
  });
});
