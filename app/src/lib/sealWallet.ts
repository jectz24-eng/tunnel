"use client";

import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  for (; n > 0n; n >>= 8n) bytes.unshift(Number(n & 0xffn));
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/**
 * Parses a reward-wallet secret key (the JSON array in a keypair file, or a base58
 * private key as wallets export it) and seals it to the engine's X25519 key, so only
 * the engine can open it. The plaintext never leaves this browser.
 */
export function sealRewardWallet(input: string, enginePublicKeyB64: string): { sealed: string; address: string } {
  const text = input.trim();
  let secret: Uint8Array;
  try {
    secret = text.startsWith("[") ? Uint8Array.from(JSON.parse(text) as number[]) : base58(text);
  } catch {
    throw new Error("paste the keypair file contents ([12, 34, …]) or a base58 private key");
  }
  if (secret.length !== 64) throw new Error("a Solana secret key is 64 bytes");
  let address: string;
  try {
    address = Keypair.fromSecretKey(secret).publicKey.toBase58(); // verifies the key pair is consistent
  } catch {
    throw new Error("this is not a valid Solana secret key");
  }
  const enginePub = Uint8Array.from(atob(enginePublicKeyB64), (c) => c.charCodeAt(0));
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ct = nacl.box(secret, nonce, enginePub, eph.secretKey);
  secret.fill(0);
  return { sealed: `v1.${b64(eph.publicKey)}.${b64(nonce)}.${b64(ct)}`, address };
}
