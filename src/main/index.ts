import { app, dialog, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { closeDatabase, getDatabase, getDbFile, initDatabase } from './db/database';
import { runMigrations } from './db/migrations';

import { createMainWindow } from './windows/createMainWindow';
import { registerAiAnalysisIpc } from './ipc/aiAnalysisHandlers';
import { registerAiTestIpc } from './ipc/aiTestHandlers';
import { registerAppIpc } from './ipc/appHandlers';
import { registerAiConfigIpc } from './ipc/aiConfigHandlers';
import { registerDataIpc } from './ipc/dataHandlers';
import { registerClipboardIpc } from './ipc/clipboardHandlers';
import { registerExpressionIpc } from './ipc/expressionHandlers';
import { registerErrorArchiveIpc } from './ipc/errorArchiveHandlers';
import { registerReviewTaskIpc } from './ipc/reviewTaskHandlers';
import { registerResultIpc } from './ipc/resultHandlers';
import { registerStatsIpc } from './ipc/statsHandlers';
import { registerSecretIpc } from './ipc/secretHandlers';
import { registerRecordingIpc } from './ipc/recordingHandlers';
import { cleanupStaleRecordings } from './services/recordingStore';
import { devLog } from './log';

// 显式固定应用名（未打包/探针场景下 Electron 会回退为 "Electron"，
// 导致 userData 落在 %APPDATA%/Electron）；打包后 productName 同名，行为一致。
app.setName('WorkEnglish Coach');

/**
 * 开发期数据库探针（T013）：WEC_DB_PROBE=1 时在真实文件数据库上验证：
 * 首次运行建表插入，再次运行发现表仍存在（持久化验证），输出 `[dev] db:probe ...` 后退出。
 */
function runDbProbe(): void {
  const started = Date.now();
  try {
    const db = initDatabase();
    const raw = db.$client;
    const file = getDbFile();
    const existed = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'wec_probe'`)
      .get() !== undefined;
    raw.exec(`CREATE TABLE IF NOT EXISTS wec_probe (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)`);
    if (!existed) {
      raw.prepare(`INSERT INTO wec_probe (n) VALUES (42)`).run();
    }
    const row = raw.prepare(`SELECT n FROM wec_probe`).get() as { n: number } | undefined;
    const ok = row?.n === 42 && existsSync(file);
    closeDatabase();
    devLog(
      `db:probe ${ok ? 'ok' : 'fail'} (${Date.now() - started}ms, file: ${file}, persistedFromPreviousRun: ${existed}, node ${process.versions.node} electron ${process.versions.electron})`,
    );
  } catch (err) {
    devLog('db:probe fail:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * 启动时初始化数据库并执行迁移（T013/T015）。
 * 失败时弹出明确错误对话框但不强制退出（个人工具：页面可先浏览，
 * 依赖数据的操作会在 T016 后自行 fail fast）。
 */
function bootDatabase(): void {
  try {
    initDatabase();
    const applied = runMigrations();
    devLog(`db:ready (${getDbFile()}, migrations: ${applied.length})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    devLog('db:init/migrate fail:', msg);
    dialog.showErrorBox('数据库初始化失败', msg);
  }
}

/** 列出当前数据库中所有用户表（用于迁移探针验证）。 */
function dbTables(): string[] {
  const rows = getDatabase()
    .$client.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * 开发期迁移探针（T015）：WEC_DB_MIGRATE=1 时执行迁移并报告已记录的迁移，然后退出。
 */
function runMigrateProbe(): void {
  const started = Date.now();
  try {
    initDatabase();
    const applied = runMigrations();
    const tables = (dbTables()) as string[];
    closeDatabase();
    devLog(
      `db:migrate ok (${Date.now() - started}ms, recorded: ${applied.length}${
        applied.length ? ' [' + applied.join(', ') + ']' : ''
      }, tables: ${tables.length} [${tables.join(', ')}], file: ${getDbFile()})`,
    );
  } catch (err) {
    devLog('db:migrate fail:', err instanceof Error ? err.message : String(err));
  }
}

let mainWindow: ReturnType<typeof createMainWindow> | null = null;

// E2E/远程调试（仅 dev）：用 env 开启 CDP。不用 CLI --remote-debugging-port：
// Electron 33.4.11 在 Windows 上会把它当 bad option 拒收并直接退出。
const e2eCdpPort = process.env.ELECTRON_CDP_PORT;
if (e2eCdpPort) {
  app.commandLine.appendSwitch('remote-debugging-port', e2eCdpPort);
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

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
    if (process.env.WEC_DB_MIGRATE === '1') {
      runMigrateProbe();
      app.quit();
      return;
    }
    bootDatabase();
    // T034：麦克风权限 —— 本应用只需要 media（麦克风），其余权限一律拒绝。
    // 不弹 OS 级确认框（单用户本地工具）；拒绝时渲染进程显示明确提示。
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media');
    });
    // T034：清理超过 7 天的录音文件（不默认永久保存）。
    try {
      const r = cleanupStaleRecordings();
      if (r.ok && r.data > 0) devLog(`rec:cleanup removed ${r.data} stale files`);
    } catch (e) {
      devLog('rec:cleanup fail:', e instanceof Error ? e.message : String(e));
    }
    registerAppIpc();
    registerAiAnalysisIpc();
    registerAiTestIpc();
    registerAiConfigIpc();
    registerDataIpc();
    registerClipboardIpc();
    registerExpressionIpc();
    registerErrorArchiveIpc();
    registerReviewTaskIpc();
    registerResultIpc();
    registerStatsIpc();
    registerSecretIpc();
    registerRecordingIpc();
    mainWindow = createMainWindow();
  });
}

app.on('window-all-closed', () => {
  closeDatabase();
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
export { isDev, devLog };
