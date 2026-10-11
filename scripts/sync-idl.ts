/**
 * After `anchor build`: installs the compiler-generated IDL into the SDK
 * (the single source of truth for instruction/account/event layouts).
 *
 *   npm run idl:sync                     # from target/idl/tunnel.json
 *   npm run idl:sync -- <path/to/idl>    # e.g. \\wsl.localhost\Ubuntu-24.04\home\dev\tunnel\target\idl\tunnel.json
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib";

const src = process.argv[2] ?? join(ROOT, "target/idl/tunnel.json");
const dest = join(ROOT, "packages/sdk/src/idl/tunnel.json");
if (!existsSync(src)) {
  console.error(`${src} not found — run \`anchor build\` first (or pass the IDL path)`);
  process.exit(1);
}
const idl = JSON.parse(readFileSync(src, "utf8"));
const declared = /declare_id!\("(\w+)"\)/.exec(readFileSync(join(ROOT, "programs/tunnel/src/lib.rs"), "utf8"))![1];
if (idl.address !== declared) {
  console.error(`IDL address ${idl.address} does not match declare_id! ${declared}`);
  process.exit(1);
}
copyFileSync(src, dest);
console.log(`installed ${src} → packages/sdk/src/idl/tunnel.json (${idl.instructions.length} instructions, ${idl.events.length} events)`);
