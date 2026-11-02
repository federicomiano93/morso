import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellHash } from '../tools/shell-hash.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the service worker precaches every app file, so the app opens offline', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const listed = [...sw.matchAll(/^\s+'([^']+)',?$/gm)].map((m) => m[1]);
  const jsFiles = readdirSync(join(root, 'js')).map((f) => `js/${f}`);
  for (const f of [...jsFiles, 'index.html', 'css/app.css', 'manifest.webmanifest']) {
    assert.ok(listed.includes(f), `${f} is missing from the SHELL list in sw.js`);
  }
  for (const f of listed.filter((x) => x !== './')) assert.ok(existsSync(join(root, f)), `${f} is listed in sw.js but does not exist`);
});

test('index.html links only files that exist and sets a strict content security policy', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    if (/^https?:/.test(m[1])) continue;
    assert.ok(existsSync(join(root, m[1])), `${m[1]} referenced in index.html does not exist`);
  }
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});

test('the manifest icons exist', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(existsSync(join(root, icon.src)), icon.src);
});

test('the service worker cache name matches the app files (run "npm run stamp" after changing any of them)', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const version = /const VERSION = '([^']*)';/.exec(sw)[1];
  assert.equal(version, shellHash(root), 'sw.js VERSION is stale: run "npm run stamp"');
});
