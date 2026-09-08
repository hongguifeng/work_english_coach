// T012：SQLite 驱动探针 —— 在 Electron 主进程环境中验证 better-sqlite3
// 用法（需先 npm run build）: node scripts/db-probe.mjs
// 输出 [dev] db:probe ok | fail 后自动退出。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(projectRoot, 'package.json'));
// 普通 Node 中 require('electron') 返回 Electron 可执行文件路径（字符串）
const electronBin = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.WEC_DB_PROBE = '1';
env.WEC_AUTO_QUIT_MS = '1500';

const child = spawn(electronBin, [resolve(projectRoot, 'out/main/index.js')], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
