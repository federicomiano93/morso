// Writes the current shell hash into sw.js. Run after changing any app file: npm run stamp
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellHash } from './shell-hash.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'sw.js');
const hash = shellHash(root);
const next = readFileSync(file, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${hash}';`);
writeFileSync(file, next);
console.log('sw.js VERSION =', hash);
