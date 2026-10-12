/**
 * Creates the engine's reward wallet keypair OUTSIDE the repository and prints
 * its public address. This wallet holds the $TUNNEL mining reserve and a
 * little SOL for transfer fees; it is the only secret key TUNNEL uses.
 *
 *   npm run setup:reward-wallet -- --out ~/.config/tunnel/reward-wallet.json
 *
 * Upload the file to Render as a secret file (see docs/DEPLOYMENT.md) and back
 * it up offline. Never commit it, paste it into chat, or put it in the web app.
 */
import { Keypair } from "@solana/web3.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ROOT, arg } from "./lib";

const raw = arg("out") ?? join(homedir(), ".config", "tunnel", "reward-wallet.json");
const out = resolve(raw.startsWith("~") ? join(homedir(), raw.slice(1)) : raw);
if (out.startsWith(ROOT) && !out.includes(`${ROOT}${process.platform === "win32" ? "\\" : "/"}keys`)) {
  throw new Error("Refusing to write a secret key inside the repository (except the git-ignored keys/ folder).");
}
if (existsSync(out)) throw new Error(`${out} already exists — not overwriting a key.`);
const kp = Keypair.generate();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
console.log(`reward wallet: ${kp.publicKey.toBase58()}\nkeypair file:  ${out}`);
