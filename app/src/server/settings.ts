import "server-only";
import { PublicKey } from "@solana/web3.js";
import type { getDb } from "@tunnel/db";
import { appConfig } from "@/lib/config";

type Db = ReturnType<typeof getDb>;

/**
 * Deployment settings edited from /admin. The engine restarts itself when its RPC, the mint
 * or the reward wallet changes. The sealed reward-wallet key is never returned.
 */
export async function readSettings(db: Db) {
  const c = await db.protocolConfig.findUnique({
    where: { id: 1 },
    select: { engineRpcUrl: true, publicRpcUrl: true, tunnelMint: true, sealPublicKey: true, sealedRewardWalletAddress: true, rewardWallet: true },
  });
  return {
    engineRpcUrl: c?.engineRpcUrl ?? null,
    publicRpcUrl: c?.publicRpcUrl ?? null,
    tunnelMint: c?.tunnelMint ?? null,
    sealPublicKey: c?.sealPublicKey ?? null,
    rewardWalletSet: c?.sealedRewardWalletAddress ?? null,
    rewardWalletActive: c?.rewardWallet ?? null,
  };
}

/** Accepts only a key sealed in the browser (`v1.<epk>.<nonce>.<ciphertext>`) and its claimed public address. */
function sealedWallet(w: { sealed?: unknown; address?: unknown }): string | null {
  if (typeof w.sealed !== "string" || !/^v1\.[A-Za-z0-9+/=]{44}\.[A-Za-z0-9+/=]{32}\.[A-Za-z0-9+/=]{40,200}$/.test(w.sealed)) return "malformed sealed key";
  try {
    new PublicKey(String(w.address));
  } catch {
    return "not a valid wallet address";
  }
  return null;
}

let cached: { url: string; at: number } | null = null;

/** RPC for browsers: the admin setting, else NEXT_PUBLIC_RPC_URL / the cluster default. Cached for 30 s. */
export async function publicRpcUrl(db: Db | null): Promise<string> {
  if (cached && Date.now() - cached.at < 30_000) return cached.url;
  const url = (db && (await db.protocolConfig.findUnique({ where: { id: 1 }, select: { publicRpcUrl: true } }).catch(() => null))?.publicRpcUrl) || appConfig.rpcUrl;
  cached = { url, at: Date.now() };
  return url;
}

function rpcUrl(v: string): string | null {
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) return null;
  } catch {
    /* fall through */
  }
  return "RPC URLs must be https:// addresses";
}

/** Validates and stores the settings present in `s` (empty string clears one). Returns an error message or null. */
export async function saveSettings(
  db: Db,
  s: { engineRpcUrl?: string; publicRpcUrl?: string; tunnelMint?: string; rewardWallet?: { sealed?: unknown; address?: unknown } },
  actor: string,
): Promise<string | null> {
  const data: {
    engineRpcUrl?: string | null;
    publicRpcUrl?: string | null;
    tunnelMint?: string | null;
    sealedRewardWallet?: string;
    sealedRewardWalletAddress?: string;
  } = {};
  if (s.rewardWallet) {
    const bad = sealedWallet(s.rewardWallet);
    if (bad) return bad;
    // An in-flight withdrawal must be reconciled by the wallet that sent it.
    if (await db.payout.count({ where: { status: { in: ["requested", "sending"] } } })) return "the reward wallet cannot change while withdrawals are pending";
    data.sealedRewardWallet = s.rewardWallet.sealed as string;
    data.sealedRewardWalletAddress = String(s.rewardWallet.address);
  }
  for (const key of ["engineRpcUrl", "publicRpcUrl"] as const) {
    const v = s[key]?.trim();
    if (v === undefined) continue;
    if (v && rpcUrl(v)) return rpcUrl(v);
    data[key] = v || null;
  }
  const mint = s.tunnelMint?.trim(); // "" removes the mint
  if (mint !== undefined) {
    if (mint) {
      try {
        new PublicKey(mint);
      } catch {
        return "not a valid mint address";
      }
    }
    const current = await db.protocolConfig.findUnique({ where: { id: 1 }, select: { tunnelMint: true } });
    if (current?.tunnelMint && current.tunnelMint !== mint) {
      // Balances and queued withdrawals are denominated in the current token.
      const [owed, pending] = await Promise.all([
        db.account.count({ where: { balance: { gt: 0 } } }),
        db.payout.count({ where: { status: { in: ["requested", "sending"] } } }),
      ]);
      if (owed || pending) return `the mint cannot ${mint ? "change" : "be removed"} while players hold balances or withdrawals are pending`;
    }
    data.tunnelMint = mint || null;
  }
  if (!Object.keys(data).length) return "nothing to save";
  await db.$transaction([
    db.protocolConfig.update({ where: { id: 1 }, data }),
    // The engine RPC may embed an API key and the wallet key is sealed: log which settings changed, not their values.
    db.protocolEvent.create({
      data: { name: "SettingsUpdated", wallet: actor, data: { changed: Object.keys(data).filter((k) => k !== "sealedRewardWallet"), tunnelMint: data.tunnelMint, rewardWallet: data.sealedRewardWalletAddress } },
    }),
  ]);
  cached = null;
  return null;
}
