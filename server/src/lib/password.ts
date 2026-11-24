import bcrypt from 'bcryptjs';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

/** Format: scrypt$N$r$p$<salt b64>$<hash b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r, p })) as Buffer;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, n, rr, pp, saltB64, hashB64] = stored.split('$');
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = (await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(rr),
      p: Number(pp),
    })) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  if (stored.startsWith('$2')) {
    // Legacy PHP password_hash() bcrypt ($2y$) – compatible with $2a$.
    const normalized = stored.replace(/^\$2y\$/, '$2a$');
    try {
      return await bcrypt.compare(password, normalized);
    } catch {
      return false;
    }
  }
  return false;
}

export function needsRehash(stored: string): boolean {
  return !stored.startsWith('scrypt$');
}
