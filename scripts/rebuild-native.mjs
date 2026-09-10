// Rebuild native modules (better-sqlite3) against the installed Electron.
//
// Prefer the package's official Electron prebuild. Fall back to node-gyp when
// the installed version/ABI has no matching prebuild.
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
const gypBin = requireFromRoot.resolve('node-gyp/bin/node-gyp.js', {
  paths: [resolve(projectRoot, 'node_modules', 'app-builder-lib')],
});
const moduleDir = resolve(projectRoot, 'node_modules', 'better-sqlite3');
const prebuildBin = requireFromRoot.resolve('prebuild-install/bin.js');

const prebuild = spawnSync(
  process.execPath,
  [prebuildBin, '--runtime', 'electron', '--target', electronVersion, '--arch', process.arch],
  { cwd: moduleDir, stdio: 'inherit' },
);
if (prebuild.status === 0) {
  console.log('[rebuild-native] installed official Electron prebuild');
  process.exit(0);
}

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
