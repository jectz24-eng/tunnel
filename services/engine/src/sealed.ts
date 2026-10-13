/**
 * Reward-wallet key set from /admin. The browser seals it to the engine's X25519
 * public key (nacl.box with an ephemeral key), so the website and the database
 * only ever hold ciphertext. The engine's box secret is derived from
 * ENGINE_SEAL_SECRET, which exists only in the engine's environment.
 *
 * Sealed format: `v1.<ephemeral public key>.<nonce>.<ciphertext>` (base64 parts).
 */
import { Keypair } from "@solana/web3.js";
import { createHash } from "node:crypto";
import nacl from "tweetnacl";

export function sealKeyPair(secret: string | undefined): nacl.BoxKeyPair | null {
  if (!secret) return null;
  return nacl.box.keyPair.fromSecretKey(createHash("sha256").update(`tunnel-seal|${secret}`).digest());
}

/** Opens a sealed reward-wallet key; throws if it is malformed, not for this engine, or not the claimed address. */
export function openSealedWallet(sealed: string, claimedAddress: string | null, box: nacl.BoxKeyPair): Keypair {
  const [v, epk, nonce, ct] = sealed.split(".");
  if (v !== "v1" || !epk || !nonce || !ct) throw new Error("sealed reward wallet: unknown format");
  const plain = nacl.box.open(Buffer.from(ct, "base64"), Buffer.from(nonce, "base64"), Buffer.from(epk, "base64"), box.secretKey);
  if (!plain) throw new Error("sealed reward wallet: cannot open (sealed to a different engine key? re-enter it in /admin)");
  const wallet = Keypair.fromSecretKey(plain);
  if (claimedAddress && wallet.publicKey.toBase58() !== claimedAddress) throw new Error("sealed reward wallet: address does not match the key");
  return wallet;
}
