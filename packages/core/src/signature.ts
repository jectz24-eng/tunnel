import { decodeBase58 } from "@tunnel/sdk";
import nacl from "tweetnacl";
import { ProtocolError } from "./errors";

export const isAddress = (v: unknown): v is string => typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);

/** Verifies an ed25519 signature (base58) by `wallet` over the exact UTF-8 message. */
export function verifySignature(message: string, signature: string, wallet: string): void {
  let sig: Uint8Array;
  let key: Uint8Array;
  try {
    sig = decodeBase58(signature);
    key = decodeBase58(wallet);
  } catch {
    throw new ProtocolError("bad_signature", "Signature or wallet is not valid base58.");
  }
  if (sig.length !== 64 || key.length !== 32) throw new ProtocolError("bad_signature", "Malformed signature or wallet.");
  if (!nacl.sign.detached.verify(new TextEncoder().encode(message), sig, key)) {
    throw new ProtocolError("bad_signature", "The signature does not match this wallet and message.", 401);
  }
}
