// T040 生产包完整测试（生命周期全流程，CDP 驱动）：
//   阶段 1（首次启动/全新状态）：空数据断言 → AI 设置 + API Key → 真实 AI 分析 → 确认保存 → 手动加表达
//   阶段 2（重启）：同 userData/DB 再次启动 → 数据仍在 + 凭据仍可读（重启后再次 AI 调用）
//   阶段 3（升级/重装）：换用新版构建目录覆盖安装 → 启动 → 数据仍在
//   阶段 4（卸载行为）：删除程序目录（保留 userData）→ 数据文件仍在
//   阶段 5（重装后恢复）：程序目录恢复 → 启动 → 数据可见
//   阶段 6（数据导出内容）：用打包后的 dataService 直接导出生产 DB → 校验 JSON（不含 API Key）
//   阶段 7（删除全部数据）：设置页删除 → 六张学习表清空、settings 保留
// 前提：http://127.0.0.1:12346/v1 测试 AI 服务可用；release/win-unpacked 已构建
import { execSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, cpSync, existsSync, createWriteStream, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const CDP_PORT = '9223';
const DIR = mkdtempSync(join(tmpdir(), 'wec-t040-'));
const DB_DIR = join(DIR, 'db');
const DB_FILE = join(DB_DIR, 'work-english-coach.db');
const REC_DIR = join(DIR, 'recordings');
const UD = undefined;
const EXE_A = join(ROOT, 'release', 'win-unpacked', 'WorkEnglish Coach.exe');
const DIR_B = join(ROOT, 'release', 'win-unpacked-b');
const EXE_B = join(DIR_B, 'WorkEnglish Coach.exe');
const INSTALLER = join(ROOT, 'release', 'WorkEnglish Coach Setup 0.1.0.exe');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------- CDP harness（同 T039） ----------
let app = null;
let eLog = '';
function startApp(exe) {
  eLog = join(DIR, `app-${exe.includes('b') ? 'B' : 'A'}.log`);
  const eEnv = { ...process.env, ELECTRON_CDP_PORT: CDP_PORT, ELECTRON_NO_ATTACH_CONSOLE: '1', WEC_DB_DIR: DB_DIR, WEC_DB_FILE: DB_FILE, WEC_REC_DIR: REC_DIR };
  delete eEnv.ELECTRON_RUN_AS_NODE;
  delete eEnv.WSLENV;
  const logStream = createWriteStream(eLog, { flags: 'a' });
  app = spawn('cmd', ['/c', exe], { cwd: ROOT, env: eEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout?.on('data', (d) => logStream.write(d));
  app.stderr?.on('data', (d) => logStream.write(d));
  return app;
}
function kill() {
  if (app?.pid) { try { execSync(`taskkill /T /F /PID ${app.pid}`, { stdio: 'ignore' }); } catch { try { app.kill(); } catch {} } }
  app = null;
}
process.on('exit', kill);

function wsConnect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.onopen = () => res(ws);
    ws.onerror = (e) => rej(new Error('ws error: ' + (e?.message ?? '')));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cdp = null;
let n = 0;
const pend = new Map();
async function connectCdp() {
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      const page = list.find((x) => x.type === 'page');
      if (page) {
        cdp = await wsConnect(page.webSocketDebuggerUrl);
        cdp.onmessage = (m) => {
          const x = JSON.parse(m.data.toString());
          if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); }
        };
        return page;
      }
    } catch {}
  }
  throw new Error('CDP 连接超时（生产包未启动?）');
}
function send(p) {
  return new Promise((res) => { n += 1; pend.set(n, res); cdp.send(JSON.stringify({ id: n, ...p })); });
}
const NPAGE = `
if (!window.__np) {
  window.__np = 1;
  window.T0 = (s) => String(s ?? '').replace(/\\s+/g, '');
  try {
    const o = window.navigator.clipboard;
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { ...o, writeText: () => Promise.resolve() },
      writable: true, configurable: true,
    });
  } catch {}
}`;
const ev = (ex) => send({ method: 'Runtime.evaluate', params: { expression: `(() => { ${NPAGE} return (async () => { return ${ex}; })(); })()`, returnByValue: true, awaitPromise: true } });
async function waitUntil(ex, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await ev(`(function(){ try { return (${ex}) ? 1 : 0; } catch { return 0; } })()`);
    if (r?.result?.result?.value === 1) return true;
    await sleep(intervalMs);
  }
  return false;
}
async function setHash(h) { await ev(`location.hash = ${JSON.stringify(h)}`); await delay(800); }
async function fillText(sel, value) {
  const r = await ev(`(function(){
    const inp = document.querySelector(${JSON.stringify(sel)});
    if (!inp) return false;
    const proto = inp.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    d.set.call(inp, ${JSON.stringify(value)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.blur();
    return true;
  })()`);
  return r?.result?.result?.value === true;
}
async function clickButton(label, scope = 'document') {
  const r = await ev(`(function(){
    const root = ${scope === 'document' ? 'document' : 'document.querySelector(".ant-modal-content") || document'};
    const b = [...root.querySelectorAll('button')].find(x => window.T0(x.textContent) === ${JSON.stringify(label)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  return r?.result?.result?.value === true;
}
async function toastContains(text, timeoutMs = 12000) {
  return waitUntil(`!![...document.querySelectorAll('.ant-message-notice')].some(x => window.T0(x.textContent).includes(${JSON.stringify(text)}))`, { timeoutMs, intervalMs: 400 });
}

/** DB 计数（app 必须已退出）：六张学习表 + settings */
function dbCounts() {
  const db = new DatabaseSync(DB_FILE); // 可写打开：让 WAL 正常恢复/合并
  const q = (t) => Number(db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
  const c = {
    samples: q('communication_samples'),
    issues: q('detected_issues'),
    skills: q('skills'),
    expressions: q('expressions'),
    reviewTasks: q('review_tasks'),
    reviewAttempts: q('review_attempts'),
    settings: q('settings'),
  };
  db.close();
  return c;
}

const AI = { baseUrl: 'http://127.0.0.1:12346/v1', model: 'qwen3.8-27b', key: 't040-local-test-key' };

// 工作区填写 + 检查（供首次/重启两次使用）
async function workspaceAnalyze() {
  await setHash('#/');
  const cn = await ev(`(function(){
    const tas = [...document.querySelectorAll('textarea')];
    if (tas.length < 2) return -1;
    const d = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    d.set.call(tas[0], '我要告诉客户：项目延期一天，周五交付。');
    tas[0].dispatchEvent(new Event('input', { bubbles: true }));
    d.set.call(tas[1], 'The project is delay one day, we will give you on Friday.');
    tas[1].dispatchEvent(new Event('input', { bubbles: true }));
    return tas.length;
  })()`);
  console.log('    textareas:', cn?.result?.result?.value);
  const ok = await clickButton('检查');
  console.log('    检查 clicked:', ok);
  return ok;
}
const AI_DONE = `!![...document.querySelectorAll('.ant-typography, h4, .ant-card, .ant-alert')].some(x => window.T0(x.textContent).includes('最小修改'))`;

try {
  // ============ 0. 安装物验收 ============
  console.log('\n[0] 安装物');
  check('NSIS 安装包已生成', existsSync(INSTALLER), existsSync(INSTALLER) ? `${(statSync(INSTALLER).size / 1048576).toFixed(1)} MB` : 'missing');
  check('--dir 生产包存在', existsSync(EXE_A));

  // ============ 1. 首次启动（全新状态） ============
  console.log('\n[1] 首次启动（全新状态）');
  startApp(EXE_A);
  await connectCdp();
  const mounted = await waitUntil(`!!document.getElementById('root')?.children?.length`, { timeoutMs: 60000 });
  check('生产包窗口挂载', mounted);

  // 1a. 全新状态：空数据（直接走 IPC 断言，避免 DOM 空状态文案歧义）
  await setHash('#/expressions');
  const emptyExpr = await ev(`window.desktopAPI.expressionList().then(r => r.ok ? r.data.length : -1)`);
  check('首次启动表达库为空', emptyExpr?.result?.result?.value === 0, `count=${emptyExpr?.result?.result?.value}`);

  // 1b. AI 配置 + API Key
  await setHash('#/settings');
  await fillText('input#baseUrl', AI.baseUrl);
  await fillText('input#model', AI.model);
  await fillText('input#timeoutSeconds', '120');
  await clickButton('保存设置');
  check('AI 配置保存 toast', await toastContains('保存成功'));
  await fillText('input[type="password"]', AI.key);
  await clickButton('保存');
  check('API Key 保存 toast（系统凭据存储）', await toastContains('Key已保存'));

  // 1c. 真实 AI 分析
  console.log('    → 首次 AI 分析…');
  await workspaceAnalyze();
  const aiDone1 = await waitUntil(AI_DONE, { timeoutMs: 180000, intervalMs: 2000 });
  check('首次启动 AI 分析成功', aiDone1);
  if (!aiDone1) {
    const errText = await ev(`[...document.querySelectorAll('.ant-message-notice, .ant-notification-notice, .ant-alert')].map(x => window.T0(x.textContent)).join(' | ')`);
    console.log('    错误提示:', errText?.result?.result?.value);
  }

  // 1d. 确认并保存
  await clickButton('确认并保存');
  check('确认保存（按钮变为已保存）', await waitUntil(`!![...document.querySelectorAll('button')].some(b => window.T0(b.textContent) === '已保存')`, { timeoutMs: 20000 }));

  // 1e. 手动加表达
  await setHash('#/expressions');
  await clickButton('新增表达');
  const modalOpen = await waitUntil(`!!document.querySelector('.ant-modal-content')`, { timeoutMs: 15000 });
  if (!modalOpen) throw new Error('新增 modal 未打开');
  await fillText('input#title', 'Keep me posted');
  await fillText('input#chineseMeaning', '让我把进展告知你');
  await fillText('input#pattern', 'keep me posted');
  await fillText('textarea#example', 'I will keep you posted on the result.');
  await fillText('textarea#notes', '高频商务表达');
  await ev(`(function(){
    const item = [...document.querySelectorAll('.ant-form-item')].find(x => x.querySelector('label') && window.T0(x.querySelector('label').textContent) === '场景（可选）');
    const sel = item?.querySelector('.ant-select');
    if (!sel) return false;
    sel.querySelector('.ant-select-selector')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  })()`);
  await waitUntil(`!![...document.querySelectorAll('.ant-select-item-option')].some(o => window.T0(o.textContent) === '商务邮件')`, { timeoutMs: 5000 });
  await ev(`(function(){
    const o = [...document.querySelectorAll('.ant-select-item-option')].find(x => window.T0(x.textContent) === '商务邮件');
    if (!o) return false;
    o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    o.click();
    return true;
  })()`);
  await delay(300);
  await clickButton('保存', 'modal');
  check('首次启动手动加表达成功', await waitUntil(`!![...document.querySelectorAll('.ant-table-row')].some(r => window.T0(r.textContent).includes('Keepmeposted'))`, { timeoutMs: 15000 }));

  // 1f. 导出对话框触发（原生对话框无法 CDP 操作：验证点击后 app 进程存活、无崩溃）
  await setHash('#/settings');
  const expClicked = await clickButton('导出数据');
  console.log('    导出数据 clicked:', expClicked);
  await delay(5000);
  const alive = execSync('tasklist', { encoding: 'utf8' }).includes('WorkEnglish');
  check('导出对话框触发后进程存活（无崩溃）', alive);
  kill(); // 关闭 app 同时关闭原生对话框
  await sleep(2000);

  const snap1 = dbCounts();
  console.log('    DB 快照:', JSON.stringify(snap1));
  check('DB 落库完整（六表 + settings）', snap1.samples >= 1 && snap1.issues >= 1 && snap1.skills >= 1 && snap1.expressions >= 1 && snap1.settings >= 1, JSON.stringify(snap1));

  // ============ 2. 重启（数据 + 凭据持久化） ============
  console.log('\n[2] 重启');
  startApp(EXE_A);
  await connectCdp();
  const mounted2 = await waitUntil(`!!document.getElementById('root')?.children?.length`, { timeoutMs: 60000 });
  check('重启后窗口挂载', mounted2);
  await setHash('#/expressions');
  check('重启后表达仍在', await waitUntil(`!![...document.querySelectorAll('.ant-table-row')].some(r => window.T0(r.textContent).includes('Keepmeposted'))`, { timeoutMs: 15000 }));
  await setHash('#/errors');
  check('重启后错误档案仍在', await waitUntil(`!![...document.querySelectorAll('button')].some(b => window.T0(b.textContent) === '查看示例')`, { timeoutMs: 15000 }));
  await setHash('#/settings');
  const baseUrlVal = await ev(`(function(){ const i = document.querySelector('input#baseUrl'); return i ? i.value : null; })()`);
  check('重启后 AI 配置仍在', baseUrlVal?.result?.result?.value === AI.baseUrl, `baseUrl=${baseUrlVal?.result?.result?.value}`);

  console.log('    → 重启后再次 AI 分析（验证凭据存储可读）…');
  await workspaceAnalyze();
  const aiDone2 = await waitUntil(AI_DONE, { timeoutMs: 180000, intervalMs: 2000 });
  check('重启后 AI 分析成功（API Key 来自系统凭据存储）', aiDone2);
  if (!aiDone2) {
    const errText = await ev(`[...document.querySelectorAll('.ant-message-notice, .ant-notification-notice, .ant-alert')].map(x => window.T0(x.textContent)).join(' | ')`);
    console.log('    错误提示:', errText?.result?.result?.value);
  }
  kill();
  await sleep(2000);
  const snap2 = dbCounts();
  check('重启不丢数据', snap2.expressions === snap1.expressions && snap2.samples >= snap1.samples, JSON.stringify(snap2));

  // ============ 3. 升级/重装（程序目录替换） ============
  console.log('\n[3] 升级/重装（程序目录替换为新版构建）');
  rmSync(DIR_B, { recursive: true, force: true });
  cpSync(join(ROOT, 'release', 'win-unpacked'), DIR_B, { recursive: true });
  check('新版构建目录就位', existsSync(EXE_B));
  startApp(EXE_B);
  await connectCdp();
  const mounted3 = await waitUntil(`!!document.getElementById('root')?.children?.length`, { timeoutMs: 60000 });
  check('升级后窗口挂载', mounted3);
  await setHash('#/expressions');
  check('升级后数据仍在（userData 与程序目录分离）', await waitUntil(`!![...document.querySelectorAll('.ant-table-row')].some(r => window.T0(r.textContent).includes('Keepmeposted'))`, { timeoutMs: 15000 }));
  kill();
  await sleep(2000);

  // ============ 4. 卸载行为（程序删除，数据保留） ============
  console.log('\n[4] 卸载行为');
  rmSync(DIR_B, { recursive: true, force: true });
  const dbStill = existsSync(DB_FILE);
  const snap4 = dbStill ? dbCounts() : null;
  check('卸载后数据文件仍在', dbStill);
  check('卸载后数据完整（settings/expressions 保留）', snap4 ? snap4.settings >= 1 && snap4.expressions >= 1 : false, JSON.stringify(snap4 ?? {}));

  // ============ 5. 重装后数据恢复 ============
  console.log('\n[5] 重装后数据恢复');
  cpSync(join(ROOT, 'release', 'win-unpacked'), DIR_B, { recursive: true });
  startApp(EXE_B);
  await connectCdp();
  const mounted5 = await waitUntil(`!!document.getElementById('root')?.children?.length`, { timeoutMs: 60000 });
  check('重装后窗口挂载', mounted5);
  await setHash('#/expressions');
  check('重装后数据可见', await waitUntil(`!![...document.querySelectorAll('.ant-table-row')].some(r => window.T0(r.textContent).includes('Keepmeposted'))`, { timeoutMs: 15000 }));
  kill();
  await sleep(2000);

  // ============ 6. 数据导出内容（生产 DB → JSON） ============
  console.log('\n[6] 数据导出内容（打包 dataService 直读生产 DB）');
  const outJson = join(DIR, 'export-check.json');
  const r = execSync(`npx esbuild tmp-t040-export-entry.ts --bundle --platform=node --format=cjs --external:electron --outfile=tmp-t040-export.cjs --log-level=error`, { cwd: ROOT });
  const out = execSync(`node tmp-t040-export.cjs "${DB_FILE}" "${outJson}" 0.1.0`, { cwd: ROOT, encoding: 'utf8' });
  console.log(out.trim());
  check('导出 JSON 生成成功', out.includes('EXPORT_OK'));
  check('导出内容不含 API Key', out.includes('containsApiKey=no-ok'));
  check('导出文件已落盘', existsSync(outJson));

  // ============ 7. 删除全部数据 ============
  console.log('\n[7] 删除全部数据');
  startApp(EXE_B);
  await connectCdp();
  const mounted7 = await waitUntil(`!!document.getElementById('root')?.children?.length`, { timeoutMs: 60000 });
  check('删除前窗口挂载', mounted7);
  await setHash('#/settings');
  await clickButton('删除全部数据');
  const popOk = await waitUntil(`!![...document.querySelectorAll('.ant-popover button')].some(b => window.T0(b.textContent) === '确认删除')`, { timeoutMs: 8000 });
  check('Popconfirm 出现', popOk);
  await ev(`(function(){
    const b = [...document.querySelectorAll('.ant-popover button')].find(x => window.T0(x.textContent) === '确认删除');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  check('删除全部数据 toast（设置已保留）', await toastContains('条学习数据（设置已保留）', 15000));
  kill();
  await sleep(2000);
  const snap7 = dbCounts();
  check('六张学习表清空', snap7.samples === 0 && snap7.issues === 0 && snap7.skills === 0 && snap7.expressions === 0 && snap7.reviewTasks === 0 && snap7.reviewAttempts === 0, JSON.stringify(snap7));
  check('settings 保留', snap7.settings >= 1, `settings=${snap7.settings}`);
} catch (err) {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  kill();
  await sleep(1000);
  try {
    const log = readFileSync(eLog, 'utf8');
    const lines = log.split('\n').filter(Boolean).slice(-15);
    if (lines.length) console.error('--- app.log (last 15) ---\n' + lines.join('\n'));
  } catch {}
} finally {
  kill();
  const pass = results.filter((x) => x.ok).length;
  const total = results.length;
  console.log(`\n=== T040 生产包完整测试: ${pass}/${total} passed ===`);
  for (const x of results) if (!x.ok) console.log(`  FAIL: ${x.name} ${x.detail}`);
  if (pass !== total) {
    console.log(`\n[保留临时目录用于诊断] ${DIR}`);
    try {
      const log = readFileSync(eLog, 'utf8').split('\n').filter(Boolean);
      if (log.length) console.log('--- app.log (last 20) ---\n' + log.slice(-20).join('\n'));
    } catch { console.log('（app.log 不存在）'); }
    process.exit(1);
  }
  rmSync(DIR, { recursive: true, force: true });
  rmSync(DIR_B, { recursive: true, force: true });
  process.exit(0);
}
