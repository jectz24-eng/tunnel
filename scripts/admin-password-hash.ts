/**
 * Prints an ADMIN_PASSWORD_HASH value for the /admin password.
 *
 *   npm run admin:password-hash -- '<password>'
 */
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("usage: npm run admin:password-hash -- '<password>'");
  process.exit(1);
}
const N = 32768;
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N, maxmem: 256 * 1024 * 1024 });
console.log(`scrypt:${N}:${salt.toString("base64")}:${hash.toString("base64")}`);
