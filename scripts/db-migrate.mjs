// T015：应用数据库迁移 —— 在 Electron 主进程环境中执行 drizzle migrate
// 用法（需先 npm run build）: node scripts/db-migrate.mjs
// 主进程会打开 userData 下的文件数据库，执行所有未应用的迁移（幂等），
// 输出 [dev] db:migrate ok（已记录 N 个迁移）后自动退出。
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
env.WEC_DB_MIGRATE = '1';
env.WEC_AUTO_QUIT_MS = '3000';

const child = spawn(electronBin, [resolve(projectRoot, 'out/main/index.js')], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
