import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
// The browser half: /admin seals the key with this before it leaves the page.
import { sealRewardWallet } from "../../../app/src/lib/sealWallet";
import { openSealedWallet, sealKeyPair } from "../src/sealed";

const box = sealKeyPair("engine-secret-for-test")!;
const enginePub = Buffer.from(box.publicKey).toString("base64");
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function toBase58(b: Uint8Array) {
  let n = BigInt(`0x${Buffer.from(b).toString("hex")}`);
  let s = "";
  for (; n > 0n; n /= 58n) s = B58[Number(n % 58n)] + s;
  for (const x of b) {
    if (x) break;
    s = `1${s}`;
  }
  return s;
}

describe("sealed reward wallet", () => {
  const kp = Keypair.generate();

  it("opens a key sealed from keypair-file JSON or a base58 private key", () => {
    for (const input of [JSON.stringify(Array.from(kp.secretKey)), toBase58(kp.secretKey)]) {
      const { sealed, address } = sealRewardWallet(input, enginePub);
      expect(address).toBe(kp.publicKey.toBase58());
      expect(sealed).toMatch(/^v1\.[A-Za-z0-9+/=]{44}\.[A-Za-z0-9+/=]{32}\.[A-Za-z0-9+/=]{40,200}$/); // what /api/admin accepts
      expect(openSealedWallet(sealed, address, box).publicKey.equals(kp.publicKey)).toBe(true);
    }
  });

  it("refuses a key sealed to another engine or claiming another address", () => {
    const { sealed, address } = sealRewardWallet(JSON.stringify(Array.from(kp.secretKey)), enginePub);
    expect(() => openSealedWallet(sealed, address, sealKeyPair("another-engine")!)).toThrow(/cannot open/);
    expect(() => openSealedWallet(sealed, Keypair.generate().publicKey.toBase58(), box)).toThrow(/does not match/);
  });

  it("rejects input that is not a consistent 64-byte secret key", () => {
    expect(() => sealRewardWallet("hello world", enginePub)).toThrow(/keypair file contents/);
    expect(() => sealRewardWallet(JSON.stringify([1, 2, 3]), enginePub)).toThrow(/64 bytes/);
    const tampered = Uint8Array.from(kp.secretKey);
    tampered[40] ^= 1;
    expect(() => sealRewardWallet(JSON.stringify(Array.from(tampered)), enginePub)).toThrow(/not a valid/);
  });
});
