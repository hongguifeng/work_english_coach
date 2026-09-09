import { app } from 'electron';

/**
 * 开发期日志（从 main/index.ts 抽出，避免各 IPC handler 反向依赖入口产生循环引用）。
 * 仅在未打包（开发 / `electron .`）时输出。
 */
export function devLog(...args: unknown[]): void {
  if (!app.isPackaged) {
    console.log('[dev]', ...args);
  }
}
