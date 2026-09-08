import { app, shell } from 'electron';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createMainWindow } from './windows/createMainWindow';
import { registerAppIpc } from './ipc/appHandlers';

/**
 * 开发期 SQLite 探针（T012）：WEC_DB_PROBE=1 时在主进程创建内存库并验证读写，
 * 输出 `[dev] db:probe ...` 后退出，用于判定 better-sqlite3 与 Electron ABI 是否兼容。
 */
function runDbProbe(): void {
  const started = Date.now();
  try {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE probe (a INTEGER NOT NULL)');
    db.prepare('INSERT INTO probe (a) VALUES (?)').run(42);
    const row = db.prepare('SELECT a FROM probe').get() as { a: number } | undefined;
    const ok = row?.a === 42;
    db.close();
    devLog(`db:probe ${ok ? 'ok' : 'mismatch'} (${Date.now() - started}ms, node ${process.versions.node} electron ${process.versions.electron})`);
  } catch (err) {
    devLog('db:probe fail:', err instanceof Error ? err.message : String(err));
  }
}

let mainWindow: ReturnType<typeof createMainWindow> | null = null;

// 单实例保护：个人工具，同一时间只允许一个实例
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    devLog('app ready');
    if (process.env.WEC_DB_PROBE === '1') {
      runDbProbe();
      app.quit();
      return;
    }
    registerAppIpc();
    mainWindow = createMainWindow();
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

// 外部链接一律交给系统浏览器
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
});

// 阻止导航离开允许的来源（生产：file://；开发：Vite dev server）
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (e, url) => {
    const allowed =
      process.env.ELECTRON_RENDERER_URL !== undefined
        ? process.env.ELECTRON_RENDERER_URL
        : 'file://';
    if (!url.startsWith(allowed)) {
      e.preventDefault();
    }
  });
});

process.on('uncaughtException', (error) => {
  // 主进程兜底：记录但不让应用静默崩溃
  process.stderr.write(`[main:uncaughtException] ${error.stack ?? error.message}\n`);
});

const isDev = process.env.ELECTRON_RENDERER_URL !== undefined;
export { isDev };

/** 开发期日志：未打包时才输出（构建后 electron . 运行也算开发） */
export function devLog(...args: unknown[]): void {
  if (!app.isPackaged) {
    console.log('[dev]', ...args);
  }
}
export const appRoot = (): string =>
  app.isPackaged ? process.resourcesPath : join(app.getAppPath());
