// Rebuild native modules (better-sqlite3) against the installed Electron.
//
// Why not @electron/rebuild: better-sqlite3 v12/v13 binding.gyp gates the
// compile target on prebuild presence, and @electron/rebuild 4.x does not
// expose the force flag, so it silently produces no .node. Driving node-gyp
// directly with the Electron headers (runtime/target/disturl) works reliably.
//
// Usage: npm run rebuild:electron
// Prereq (first time on a machine): Electron headers are auto-downloaded by
// node-gyp from https://www.electronjs.org/headers into the local cache.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRoot = createRequire(resolve(projectRoot, 'package.json'));

const electronVersion = requireFromRoot('electron/package.json').version;
const gypBin = resolve(projectRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const moduleDir = resolve(projectRoot, 'node_modules', 'better-sqlite3');

const env = {
  ...process.env,
  npm_config_target: electronVersion,
  npm_config_runtime: 'electron',
  npm_config_disturl: 'https://www.electronjs.org/headers',
};

console.log(`[rebuild-native] better-sqlite3 -> Electron ${electronVersion}`);
const result = spawnSync(
  process.execPath,
  [gypBin, 'rebuild', `--directory=${moduleDir}`],
  { env, stdio: 'inherit' },
);

if (result.status !== 0) {
  console.error('[rebuild-native] failed');
  process.exit(result.status ?? 1);
}

console.log('[rebuild-native] done');
