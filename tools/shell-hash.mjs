// Hash of every file the service worker precaches. The service worker's cache name is derived from
// it, so a release that changes any app file also changes the cache and the phone swaps them together.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function shellFiles(root) {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const block = /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
  return [...block.matchAll(/'([^']+)'/g)].map((m) => (m[1] === './' ? 'index.html' : m[1]));
}

export function shellHash(root) {
  const h = createHash('sha256');
  for (const f of [...new Set(shellFiles(root))].sort()) {
    h.update(f + '\0');
    // Normalise line endings so Windows and Linux checkouts hash the same.
    h.update(readFileSync(join(root, f)).toString('latin1').replace(/\r/g, ''), 'latin1');
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}
