// T039 生产包（--dir）验收：
//   启动 win-unpacked 生产包（隔离临时 DB）→ CDP 驱动 UI：
//   1. 设置页：AI 配置（Base URL / 模型 / 超时）+ API Key（keytar 生产路径）
//   2. 表达库页：手动新增一条表达（写库验证）
//   3. 工作区：真实 AI 调用（本地 qwen 测试服务器）→ 错误档案/复习任务落库
//   4. 直接读 DB 文件断言（不经过 app）
// 前提：http://127.0.0.1:12346/v1 测试 AI 服务可用
import { execSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const EXE = join(ROOT, 'release', 'win-unpacked', 'WorkEnglish Coach.exe');
const CDP_PORT = '9223';
const DIR = mkdtempSync(join(tmpdir(), 'wec-t039-'));
const DB_DIR = join(DIR, 'db');
const DB_FILE = join(DB_DIR, 'work-english-coach.db');
const REC_DIR = join(DIR, 'recordings');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- 启动生产包（隔离 DB）----
console.log('[setup] 启动生产包 --dir（CDP :%s, 临时 DB %s）', CDP_PORT, DB_FILE);
const eLog = join(DIR, 'app.log');
const eEnv = { ...process.env, ELECTRON_CDP_PORT: CDP_PORT, ELECTRON_NO_ATTACH_CONSOLE: '1', WEC_DB_DIR: DB_DIR, WEC_DB_FILE: DB_FILE, WEC_REC_DIR: REC_DIR };
delete eEnv.ELECTRON_RUN_AS_NODE;
delete eEnv.WSLENV;
const logStream = createWriteStream(eLog);
const app = spawn('cmd', ['/c', EXE], { cwd: ROOT, env: eEnv, stdio: ['ignore', 'pipe', 'pipe'] });
app.stdout?.on('data', (d) => logStream.write(d));
app.stderr?.on('data', (d) => logStream.write(d));
const kill = () => { try { execSync(`taskkill /T /F /PID ${app.pid}`, { stdio: 'ignore' }); } catch { app.kill(); } };
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
// NPAGE：每页一次的环境准备（T0 文本归一化 + clipboard stub）
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
// 注意：async 函数体必须 return 表达式值（无 return 会 resolve undefined）
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
async function setHash(h) {
  await ev(`location.hash = ${JSON.stringify(h)}`);
  await delay(800);
}
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

try {
  const page = await connectCdp();
  console.log('page:', page.url);
  const mounted = await waitUntil(`!!document.getElementById('root')?.children?.length`, { timeoutMs: 60000 });
  if (!mounted) throw new Error('页面未挂载（root 为空）');

  // 1. 设置：AI 配置 + API Key
  console.log('\n[1] 设置：AI 配置 + API Key');
  await setHash('#/settings');
  const b1 = await fillText('input#baseUrl', 'http://127.0.0.1:12346/v1');
  const b2 = await fillText('input#model', 'qwen3.8-27b');
  const b3 = await fillText('input#timeoutSeconds', '120');
  console.log('  fill base/model/timeout:', { b1, b2, b3 });
  const saved = await clickButton('保存设置');
  console.log('  保存设置 clicked:', saved);
  check('AI 配置保存 toast', await toastContains('保存成功'));
  const k1 = await fillText('input[type="password"]', 't039-local-test-key');
  console.log('  fill key:', k1);
  const k2 = await clickButton('保存');
  console.log('  key 保存 clicked:', k2);
  check('API Key 保存 toast（keytar 生产路径）', await toastContains('Key已保存'));

  // 2. 表达库：手动新增（写库验证）
  console.log('\n[2] 表达库：手动新增表达');
  await setHash('#/expressions');
  const addBtn = await clickButton('新增表达');
  console.log('  新增表达 clicked:', addBtn);
  const modalOpen = await waitUntil(`!!document.querySelector('.ant-modal-content')`, { timeoutMs: 15000 });
  if (!modalOpen) throw new Error('新增 modal 未打开');
  const f1 = await fillText('input#title', 'Keep me posted');
  const f2 = await fillText('input#chineseMeaning', '让我把进展告知你');
  const f3 = await fillText('input#pattern', 'keep me posted');
  const f4 = await fillText('textarea#example', 'I will keep you posted on the result.');
  const f5 = await fillText('textarea#notes', '高频商务表达');
  // scenario 是 antd Select：点开下拉再点选项
  const s1 = await ev(`(function(){
    const item = [...document.querySelectorAll('.ant-form-item')].find(x => x.querySelector('label') && window.T0(x.querySelector('label').textContent) === '场景（可选）');
    const sel = item?.querySelector('.ant-select');
    if (!sel) return false;
    sel.querySelector('.ant-select-selector')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  })()`);
  const s2 = await waitUntil(`!![...document.querySelectorAll('.ant-select-item-option')].some(o => window.T0(o.textContent) === '商务邮件')`, { timeoutMs: 5000 });
  const s3 = await ev(`(function(){
    const o = [...document.querySelectorAll('.ant-select-item-option')].find(x => window.T0(x.textContent) === '商务邮件');
    if (!o) return false;
    o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    o.click();
    return true;
  })()`);
  console.log('  fills:', { f1, f2, f3, f4, f5, select: [s1?.result?.result?.value, s2, s3?.result?.result?.value] });
  await delay(300);
  const savedExpr = await clickButton('保存', 'modal');
  console.log('  modal 保存 clicked:', savedExpr);
  const modalGone = await waitUntil(`(function(){ const w = document.querySelector('.ant-modal-wrap'); return !w || w.style.display === 'none' || w.offsetParent === null; })()`, { timeoutMs: 15000 });
  check('表达新增后 modal 关闭', modalGone);
  const expRow = await waitUntil(`!![...document.querySelectorAll('.ant-table-row')].some(r => window.T0(r.textContent).includes('Keepmeposted'))`, { timeoutMs: 15000 });
  check('表达列表出现新行', expRow);

  // 3. 工作区：真实 AI 调用
  console.log('\n[3] 工作区：真实 AI 调用（本地 qwen）');
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
  console.log('  textareas:', cn?.result?.result?.value);
  const checkClicked = await clickButton('检查');
  console.log('  检查 clicked:', checkClicked);
  const aiDone = await waitUntil(
    `!![...document.querySelectorAll('.ant-typography, h4, .ant-card, .ant-alert')].some(x => window.T0(x.textContent).includes('最小修改'))`,
    { timeoutMs: 180000, intervalMs: 2000 },
  );
  check('AI 返回（最小修改区块出现）', aiDone);
  if (!aiDone) {
    const errText = await ev(`[...document.querySelectorAll('.ant-message-notice, .ant-notification-notice, .ant-alert')].map(x => window.T0(x.textContent)).join(' | ')`);
    console.log('  错误提示:', errText?.result?.result?.value);
  }

  // 4. 工作区结果「确认并保存」→ 写入 samples/issues/review_tasks
  console.log('\n[4] 确认并保存（落库验证）');
  const confirmWait = await waitUntil(`!![...document.querySelectorAll('button')].some(b => window.T0(b.textContent) === '确认并保存')`, { timeoutMs: 30000 });
  check('确认并保存按钮出现', confirmWait);
  const confirmed = await clickButton('确认并保存');
  console.log('  确认并保存 clicked:', confirmed);
  const savedState = await waitUntil(`!![...document.querySelectorAll('button')].some(b => window.T0(b.textContent) === '已保存')`, { timeoutMs: 20000 });
  check('保存成功（按钮变为「已保存」）', savedState);

  // 5. 错误档案：生成复习任务（T028：不自动在保存流程中生成）
  console.log('\n[5] 错误档案：生成复习任务');
  await setHash('#/errors');
  const viewBtn = await waitUntil(`!![...document.querySelectorAll('button')].some(b => window.T0(b.textContent) === '查看示例')`, { timeoutMs: 20000 });
  check('错误档案行出现（含查看示例按钮）', viewBtn);
  const viewClicked = await ev(`(function(){
    const b = [...document.querySelectorAll('button')].find(x => window.T0(x.textContent) === '查看示例');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  console.log('  查看示例 clicked:', viewClicked?.result?.result?.value);
  const genBtn2 = await waitUntil(`!![...document.querySelectorAll('button')].some(b => window.T0(b.textContent) === '生成复习任务')`, { timeoutMs: 10000 });
  const genClicked = genBtn2 ? await ev(`(function(){
    const b = [...document.querySelectorAll('button')].find(x => window.T0(x.textContent) === '生成复习任务');
    if (!b) return false;
    b.click();
    return true;
  })()`) : { result: { result: { value: false } } };
  console.log('  生成复习任务 clicked:', genClicked?.result?.result?.value);
  const genDone = await waitUntil(`!![...document.querySelectorAll('.ant-message-notice')].some(x => window.T0(x.textContent).includes('复习任务'))`, { timeoutMs: 60000, intervalMs: 1000 });
  check('生成复习任务完成（toast）', genDone);

  await delay(3000);
  kill();
  await sleep(2000);

  // 6. DB 断言（app 已退出，直接读文件）
  console.log('\n[6] DB 断言（直接读 %s）', DB_FILE);
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  const row = db.prepare('SELECT key, value FROM settings WHERE key = ?').get('aiSettings');
  check('settings 表存有 AI 配置', !!row, row ? `model=${JSON.parse(row.value).model}` : 'row missing');
  const expCount = Number(db.prepare(`SELECT COUNT(*) c FROM expressions WHERE pattern LIKE '%keep me posted%'`).get().c);
  check('expressions 表写入（手动添加）', expCount >= 1, `count=${expCount}`);
  const sampleCount = Number(db.prepare('SELECT COUNT(*) c FROM communication_samples').get().c);
  check('communication_samples 表写入（AI 分析）', sampleCount >= 1, `count=${sampleCount}`);
  const issueCount = Number(db.prepare('SELECT COUNT(*) c FROM detected_issues').get().c);
  check('detected_issues 表写入', issueCount >= 1, `count=${issueCount}`);
  const taskCount = Number(db.prepare('SELECT COUNT(*) c FROM review_tasks').get().c);
  check('review_tasks 表写入（AI 生成复习任务）', taskCount >= 1, `count=${taskCount}`);
  db.close();
} catch (err) {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  kill();
  await sleep(1000);
  try {
    const log = (await import('node:fs')).readFileSync(eLog, 'utf8');
    const lines = log.split('\n').filter(Boolean).slice(-15);
    if (lines.length) console.error('--- app.log (last 15) ---\n' + lines.join('\n'));
  } catch {}
} finally {
  kill();
  const pass = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n=== T039 生产包验收: ${pass}/${total} passed ===`);
  for (const r of results) if (!r.ok) console.log(`  FAIL: ${r.name} ${r.detail}`);
  if (pass !== total) {
    console.log(`\n[保留临时目录用于诊断] ${DIR}`);
    try {
      const { readFileSync } = await import('node:fs');
      const log = readFileSync(eLog, 'utf8').split('\n').filter(Boolean);
      if (log.length) console.log('--- app.log (last 20) ---\n' + log.slice(-20).join('\n'));
    } catch { console.log('（app.log 不存在）'); }
    process.exit(1);
  }
  rmSync(DIR, { recursive: true, force: true });
  process.exit(0);
}
