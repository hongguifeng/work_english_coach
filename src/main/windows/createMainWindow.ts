import { app, BrowserWindow, shell } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devLog } from '../index';

/**
 * 创建主窗口（docs/02 §2.3 / T002 / T005）
 *
 * 安全基线（T005 强制）：
 * - contextIsolation: true
 * - nodeIntegration: false
 * - sandbox: true
 * - webSecurity: true
 * - 新窗口/导航一律阻止，外链交给系统浏览器
 */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'WorkEnglish Coach',
    backgroundColor: '#f5f5f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: process.env.ELECTRON_RENDERER_URL !== undefined,
    },
  });

  // 任何 window.open / target=_blank → 系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 阻止离开允许来源的导航
  win.webContents.on('will-navigate', (event, url) => {
    const allowed =
      process.env.ELECTRON_RENDERER_URL !== undefined
        ? process.env.ELECTRON_RENDERER_URL
        : 'file://';
    if (!url.startsWith(allowed)) {
      event.preventDefault();
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // 开发期日志（生产环境不输出）：加载成功/失败、renderer 控制台透传
  win.webContents.on('did-finish-load', () => {
    devLog('renderer loaded:', win.webContents.getURL());
    // 开发冒烟截图：WEC_SMOKE_SHOT 指定输出路径时，页面加载后截图并退出（便于脚本化视觉验证）
    // WEC_AUTO_SUBMIT=1（仅 !isPackaged）：截图前自动填写工作区表单并点击“检查”，用于验证结果视图
    // WEC_AUTO_JS（仅 !isPackaged）：执行自定义 JS 后再截图（用于验证其他页面的交互流）
    const shotPath = process.env.WEC_SMOKE_SHOT;
    if (shotPath && !app.isPackaged) {
      const autoSubmit = process.env.WEC_AUTO_SUBMIT === '1';
      const autoJs = process.env.WEC_AUTO_JS;
      setTimeout(async () => {
        if (autoSubmit) {
          const js = `(() => {
            const setVal = (el, v) => {
              const proto = el instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
              Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
              el.dispatchEvent(new Event('input', { bubbles: true }));
            };
            const tas = Array.from(document.querySelectorAll('textarea'));
            if (tas[0]) setVal(tas[0], '告诉对方报告会延迟到明天下午');
            if (tas[1]) setVal(tas[1], 'Hi John, the report will be delay to tomorrow, I will send it in the first time.');
            const btn = Array.from(document.querySelectorAll('button')).find(
              (b) => (b.textContent || '').replace(/\\s/g, '').includes('检查'),
            );
            if (btn) btn.click();
          })();`;
          await win.webContents.executeJavaScript(js).catch(() => undefined);
          devLog('auto-submit done, waiting for mock result…');
          await new Promise((resolve) => setTimeout(resolve, 1800));
        }
        if (autoJs) {
          await win.webContents.executeJavaScript(autoJs).catch(() => undefined);
          devLog('WEC_AUTO_JS done, waiting…');
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        try {
          const image = await win.webContents.capturePage();
          writeFileSync(shotPath, image.toPNG());
          devLog('screenshot saved:', shotPath);
        } catch (error) {
          devLog('screenshot failed:', error instanceof Error ? error.message : String(error));
        }
        app.quit();
      }, (autoSubmit || autoJs ? 800 : 1200) + Number(process.env.WEC_PRE_DELAY ?? 0));
    }
    // 开发冒烟测试：WEC_AUTO_QUIT_MS>0 时，页面加载完成后自动退出（优雅退出，便于 CI/脚本验证）
    const autoQuitMs = Number(process.env.WEC_AUTO_QUIT_MS ?? 0);
    if (autoQuitMs > 0) {
      setTimeout(() => {
        devLog('auto-quit (WEC_AUTO_QUIT_MS)');
        app.quit();
      }, autoQuitMs);
    }
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    devLog('renderer load failed:', code, description, url);
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    devLog(`renderer[${level}]:`, message, `(line ${line}, ${sourceId})`);
  });

  if (process.env.ELECTRON_RENDERER_URL !== undefined) {
    // 开发便利：WEC_START_HASH 指定初始路由（如 "training" 或 "#/training"），便于脚本化截图验证。
    // 注意：值不要以 "/" 开头，避免 Git Bash/MSYS 把 "/…" 当作路径转换。
    // 直接在加载 URL 上拼接 hash（而不是加载后修改 location.hash）：
    // 加载后改 hash 触发的导航在 v6.30 + v7_startTransition 下可能不提交，导致路由回退。
    let url = process.env.ELECTRON_RENDERER_URL;
    const raw = !app.isPackaged ? process.env.WEC_START_HASH : undefined;
    if (raw) {
      const normalized = raw.startsWith('#')
        ? raw
        : `#${raw.startsWith('/') ? raw : `/${raw}`}`;
      url = `${url}${normalized}`;
      devLog('load url with start hash:', url);
    }
    void win.loadURL(url);
  } else {
    // 生产/无 dev server：基于 __dirname 解析（打包后 __dirname = resources/app.asar/out/main，
    // 不能直接用 process.resourcesPath——那会指向 asar 外部、不存在的路径）
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
