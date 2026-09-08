// 开发服务器入口：清除 ELECTRON_RUN_AS_NODE 后启动 electron-vite dev
// 某些环境（AI 编码代理等）会注入 ELECTRON_RUN_AS_NODE=1，
// 导致 Electron 退化为纯 Node 进程（process.type=undefined、require('electron') 返回字符串）。
// 用法: node scripts/dev.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 解析 electron-vite 包的 bin 入口（不依赖 .bin 软链）
const electronVitePkg = require.resolve('electron-vite/package.json', { paths: [projectRoot] });
const electronViteBin = resolve(dirname(electronVitePkg), 'bin/electron-vite.js');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [electronViteBin, 'dev', ...process.argv.slice(2)], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
