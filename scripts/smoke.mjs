// 开发冒烟测试：启动已构建的 Electron 应用，验证窗口与 renderer 加载成功后优雅退出
// 用法: node scripts/smoke.mjs
// 说明：某些环境（AI 编码代理等）会注入 ELECTRON_RUN_AS_NODE=1，
// 导致 Electron 退化为纯 Node 进程（主进程 bootstrap 不执行），这里显式清除。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.WEC_AUTO_QUIT_MS = '1500';

const child = spawn(electronPath, ['.'], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
});

// 兜底：若 30 秒内没有自行退出，强制结束并判为失败
const watchdog = setTimeout(() => {
  console.error('[smoke] FAIL: app did not auto-quit within 30s');
  child.kill();
  process.exit(1);
}, 30_000);

child.on('exit', (code, signal) => {
  clearTimeout(watchdog);
  if (code === 0) {
    console.log('[smoke] PASS: app booted, window loaded, exited cleanly');
  } else {
    console.error(`[smoke] FAIL: exited code=${code} signal=${signal}`);
  }
  process.exit(code ?? 1);
});
