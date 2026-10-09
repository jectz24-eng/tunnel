/**
 * After `anchor build`: compares the compiler-generated IDL with the SDK's
 * generated IDL (instructions, account order, args, account/event layouts,
 * errors, discriminators) and, if they are equivalent, installs the compiler
 * output as the source of truth. Exits non-zero on any mismatch.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib";

const built = join(ROOT, "target/idl/tunnel.json");
const sdk = join(ROOT, "packages/sdk/src/idl/tunnel.json");
if (!existsSync(built)) {
  console.error("target/idl/tunnel.json not found — run `anchor build` first");
  process.exit(1);
}
const a = JSON.parse(readFileSync(built, "utf8"));
const b = JSON.parse(readFileSync(sdk, "utf8"));

// Compare only ABI-relevant parts (anchor adds docs/pda/address metadata).
const shape = (idl: any) => ({
  address: idl.address,
  instructions: idl.instructions
    .map((i: any) => ({
      name: i.name,
      discriminator: i.discriminator,
      accounts: i.accounts.map((x: any) => [x.name, !!x.writable, !!x.signer]),
      args: i.args,
    }))
    .sort((x: any, y: any) => x.name.localeCompare(y.name)),
  accounts: idl.accounts.map((x: any) => [x.name, x.discriminator]).sort(),
  events: idl.events.map((x: any) => [x.name, x.discriminator]).sort(),
  errors: idl.errors.map((e: any) => [e.code, e.name]),
  types: idl.types
    .map((t: any) => ({ name: t.name, type: { kind: t.type.kind, fields: t.type.fields, variants: t.type.variants?.map((v: any) => v.name) } }))
    .sort((x: any, y: any) => x.name.localeCompare(y.name)),
});

const sa = JSON.stringify(shape(a), null, 1).split("\n");
const sb = JSON.stringify(shape(b), null, 1).split("\n");
const diffs: string[] = [];
for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
  if (sa[i] !== sb[i]) diffs.push(`line ${i}: anchor=${sa[i]?.trim()}  sdk=${sb[i]?.trim()}`);
  if (diffs.length > 20) break;
}
if (diffs.length) {
  console.error("IDL mismatch between `anchor build` and the SDK:\n" + diffs.join("\n"));
  process.exit(1);
}
writeFileSync(sdk, JSON.stringify(a, null, 2) + "\n");
console.log("IDL matches; installed target/idl/tunnel.json into packages/sdk/src/idl/");
