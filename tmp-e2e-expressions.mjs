// E2E：库页面 新增/编辑/删除（创建两个行做真实表格交互）
// 引导：杀旧实例 -> 只起 vite renderer(5173) -> 独占 electron 实例(CDP 9222)
import { spawn, execSync } from 'node:child_process';
import { openSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const ROOT = 'd:/code/work_english_coach';
const stamp = String(Date.now()).slice(-6);
const A = `T026${stamp}`;
const B = `T026B${stamp}`;
// 隔离临时 DB（绝不污染真实用户库）
const DB_DIR = path.join(ROOT, 'data', `e2e-${stamp}`);
const DB_FILE = path.join(DB_DIR, 'e2e.db');
mkdirSync(DB_DIR, { recursive: true });
const kids = [];
const killTree = (child) => { try { execSync(`taskkill /T /F /PID ${child.pid}`, { stdio: 'ignore' }); } catch { } };

// 1. 清理现有 electron / dev 进程（保证单实例锁空闲）
try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { }
// 清残留的 E2E vite：按 5173 端口持有者 PID 杀（最多 10s）
{
  let free = false;
  for (let i = 0; i < 20 && !free; i++) {
    const out = String(execSync('netstat -ano', { timeout: 10000 }));
    const line = out.split('\n').find((l) => l.includes('LISTENING') && /:5173\s/.test(l));
    if (line) {
      const pid = line.trim().split(/\s+/).pop();
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch { }
      await sleep(500);
    } else { free = true; }
  }
  if (!free) { console.log('5173 被占用且无法释放'); process.exit(1); }
}

// 2. 只起 vite renderer dev server（监听子进程意外退出）
const vite = spawn('cmd', ['/c', 'npx', 'vite', '--config', 'vite.renderer.e2e.mjs'], { cwd: ROOT, stdio: 'pipe' });
vite.stdout?.resume();
let viteErr = '';
vite.stderr?.on('data', (d) => { viteErr += String(d); });
let viteDead = false;
vite.on('exit', () => { viteDead = true; });
kids.push(vite);
let up = false;
for (let i = 0; i < 30 && !viteDead; i++) {
  await sleep(1000);
  try { await fetch('http://127.0.0.1:5173/'); up = true; break; } catch { }
}
if (!up || viteDead) { console.log(viteDead ? 'vite 子进程提前退出:' + viteErr.slice(-300) : 'VITE 未起来'); killTree(vite); process.exit(1); }
console.log('vite dev ready');

// 3. 独占 electron 实例（ELECTRON_RENDERER_URL 指向 vite；去掉 RUN_AS_NODE）
const eEnv = { ...process.env, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173', ELECTRON_CDP_PORT: '9222', ELECTRON_NO_ATTACH_CONSOLE: '1', WEC_DB_DIR: DB_DIR, WEC_DB_FILE: DB_FILE };
// 必须完全删除（置空无效：WSL/WSLENV 会从 Windows 侧重新注入 ELECTRON_RUN_AS_NODE=1，
// 导致 Electron 退化为纯 Node）
delete eEnv.ELECTRON_RUN_AS_NODE;
delete eEnv.WSLENV;
const { openSync } = await import('node:fs');
const eLog = openSync(path.join(ROOT, 'tmp-e2e-electron.log'), 'a');
// CDP 通过 ELECTRON_CDP_PORT env 开启（main 里 appendSwitch），不用 CLI flag
const electron = spawn('cmd', ['/c', 'npx', 'electron', '.'], {
  cwd: ROOT,
  env: eEnv,
  stdio: ['ignore', eLog, eLog],
});
kids.push(electron);

// 4. 等 CDP
let list = [];
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  try { list = await (await fetch('http://127.0.0.1:9222/json')).json(); if (list.length > 0) break; } catch { }
}
if (!list.length) { console.log('NO CDP'); kids.forEach(killTree); process.exit(1); }
// 校验 target 存活（防止连到僵尸实例）：每 5s 重新枚举 /json，直到找到能响应 location.href 的 page
let p = null;
{
  const probe = async (t) => new Promise((resolve) => {
    try {
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      const to = setTimeout(() => { try { ws.close(); } catch { } resolve(null); }, 4000);
      ws.onopen = async () => {
        try {
          const r = await new Promise((res) => {
            const id = 999;
            ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === id) res(m.result?.result?.value ?? null); };
            ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: 'location.href', returnByValue: true } }));
          });
          clearTimeout(to); ws.close(); resolve(r ?? null);
        } catch { clearTimeout(to); resolve(null); }
      };
      ws.onerror = () => { clearTimeout(to); resolve(null); };
    } catch { resolve(null); }
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    let cand = [];
    try { cand = (await (await fetch('http://127.0.0.1:9222/json')).json()).filter((x) => x.type === 'page'); } catch { }
    for (const c of cand) { const v = await probe(c); if (v) { p = c; break; } }
    if (p) break;
    await sleep(5000);
  }
  if (!p) { console.log('找不到存活的 CDP target'); kids.forEach(killTree); process.exit(1); }
}
console.log('page:', p.url);
const ws = new WebSocket(p.webSocketDebuggerUrl);
await new Promise((r) => ws.onopen = r);
let idc = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (m, ps) => new Promise((r) => { const id = ++idc; pending.set(id, r); ws.send(JSON.stringify({ id, ...m, ...(ps ?? {}) })); });
await send({ method: 'Runtime.enable' });
const NPAGE = `const n=(t)=>((t==null)?'':(''+t)).replace(/ /g,'');
const setInputByLabel=(label,sel,val)=>{const lab=[...document.querySelectorAll('.ant-form-item-label label')].find(x=>n(x.textContent).includes(label));if(!lab)return 'NO_LABEL';let it=lab.closest('.ant-form-item');let inp=it&&it.querySelector('input,textarea');if(!inp){const nt=it&&it.parentElement;if(nt)inp=nt.querySelector('input,textarea')}if(!inp)return 'NO_INPUT';const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');const d=inp.tagName==='TEXTAREA'?Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value'):s;s.set.call(inp,val);inp.dispatchEvent(new Event('input',{bubbles:true}));return 'OK';};
const setSelectByLabel=(label,val)=>{const lab=[...document.querySelectorAll('.ant-form-item-label label')].find(x=>n(x.textContent).includes(label));if(!lab)return 'NO_LABEL';let it=lab.closest('.ant-form-item');let sel=it&&it.querySelector('.ant-select');if(!sel){const nt=it&&it.parentElement;if(nt)sel=nt.querySelector('.ant-select')}if(!sel)return 'NO_SELECT';sel.querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return 'OK';};
const pickOption=(v)=>new Promise(r=>{let t=0;const i=setInterval(()=>{t+=50;const op=[...document.querySelectorAll('.ant-select-item-option')].find(x=>n(x.textContent)===n(v));if(op){op.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));op.click();clearInterval(i);r('OK')}else if(t>2000){clearInterval(i);r('NO_OPTION')}},50);});
const modalTitleIs=(t)=>{const m=document.querySelector('.ant-modal-root .ant-modal-title');return m&&n(m.textContent)===n(t)};
const rowAnchorExists=(t)=>[...document.querySelectorAll('.ant-table-tbody a')].some(x=>n(x.textContent)===n(t));
const modalGone=()=>!document.querySelector('.ant-modal-root .ant-modal:not([style*="display: none"])');`;
const ev = (ex) => send({ method: 'Runtime.evaluate', params: { expression: `(() => { ${NPAGE} return (async()=>{ ${ex} })(); })()`, returnByValue: true, awaitPromise: true } });
const waitUntil = async (fnSrc, ms) => {
  const call = fnSrc.trim().startsWith('() =>') ? `(${fnSrc})()` : `(${fnSrc})`;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await ev(`(function(){ try { return ${call} ? 1 : 0; } catch { return 0; } })()`);
    if (r?.result?.value === 1) return true;
    await sleep(400);
  }
  return false;
};
const clickBtn = (label) => ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>n(x.textContent)==='${label}');return b?(b.click(),'OK'):'NO';})()`);
const clickSave = () => ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>n(x.textContent)==='保存');return b?(b.click(),'OK'):'NO';})()`);
const dumpModalIssues = () => send({ method: 'Runtime.evaluate', params: { expression: `(() => { ${NPAGE} const t=[...document.querySelectorAll('.ant-message span, .ant-message-notice')].map(x=>n(x.textContent)).filter(Boolean); const errs=[...document.querySelectorAll('.ant-form-item-explain-error, .ant-form-item-explain')].map(x=>n(x.textContent)).filter(Boolean); return 'toasts='+JSON.stringify(t)+' formErrors='+JSON.stringify(errs); })()`, returnByValue: true } });
const waitSaveDone = async (tag) => {
  const ok = await waitUntil('() => modalGone()', 6000);
  if (!ok) { const d = await dumpModalIssues(); console.log(`FAIL: ${tag} 后 modal 未关闭: ${d?.result?.value}`); throw new Error(`${tag} 后 modal 未关闭`); }
  console.log(`${tag} 后 modal 已关闭`);
};

// 5. 导航到 /#/expressions（冷编译时首次加载可能较慢，等就绪）
await ev(`location.href='#/expressions'`);
const diag = () => ev(`(function(){return JSON.stringify({rs:document.readyState,h:location.hash,rc:document.getElementById('root')?.children.length,bt:[...document.querySelectorAll('button')].length});})()`);
let ready = false;
{
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    ready = await waitUntil("() => [...document.querySelectorAll('button')].some(x=>n(x.textContent)==='新增表达')", 2000);
    if (ready) break;
    console.log('  diag:', (await diag())?.result?.value);
    await sleep(13000);
  }
}
console.log('page ready (新增按钮):', ready);
if (!ready) { kids.forEach(killTree); process.exit(1); }

// A: 创建（字段值均在 schema 长度限制内）
console.log('open create:', (await clickBtn('新增表达'))?.result?.value);
await waitUntil("() => modalTitleIs('新增表达')", 5000);
console.log('fill title A:', (await ev(`setInputByLabel('标题', '${A}')`))?.result?.value);
await sleep(800);
console.log('fill meaning A:', (await ev(`setInputByLabel('中文释义', '复现用释义')`))?.result?.value);
console.log('fill pattern A:', (await ev(`setInputByLabel('固定搭配', 'Update by {date}')`))?.result?.value);
console.log('fill example A:', (await ev(`setInputByLabel('例句', 'Please keep the update by Friday, thanks.')`))?.result?.value);
console.log('fill notes A:', (await ev(`setInputByLabel('备注', 'E2E note')`))?.result?.value);
await ev(`(async()=>{await setSelectByLabel('场景','商务邮件');await pickOption('商务邮件')})()`);
console.log('click save A:', (await clickSave())?.result?.value);
await waitSaveDone('创建A');
const aRow = await waitUntil('() => rowAnchorExists(\'' + A + '\')', 10000);
console.log('A row appears:', aRow);

// B: 创建
console.log('open create:', (await clickBtn('新增表达'))?.result?.value);
await waitUntil("() => modalTitleIs('新增表达')", 5000);
console.log('fill title B:', (await ev(`setInputByLabel('标题', '${B}')`))?.result?.value);
console.log('fill meaning B:', (await ev(`setInputByLabel('中文释义', '复现用释义2')`))?.result?.value);
console.log('fill pattern B:', (await ev(`setInputByLabel('固定搭配', 'By {date}')`))?.result?.value);
console.log('fill example B:', (await ev(`setInputByLabel('例句', 'Move the launch to next Monday, thanks.')`))?.result?.value);
await ev(`(async()=>{await setSelectByLabel('场景','商务邮件');await pickOption('商务邮件')})()`);
console.log('click save B:', (await clickSave())?.result?.value);
await waitSaveDone('创建B');
const bRow = await waitUntil('() => rowAnchorExists(\'' + B + '\')', 10000);
console.log('B row appears:', bRow);

// B: 编辑
console.log('click edit B:', (await clickBtn('编辑'))?.result?.value);
await waitUntil("() => modalTitleIs('编辑表达')", 3000);
console.log('change meaning B:', (await ev(`setInputByLabel('中文释义', '复现用释义2-EDITED')`))?.result?.value);
console.log('click save (edit):', (await clickSave())?.result?.value);
await waitSaveDone('编辑');
console.log('edit toast:', (await ev(`[...document.querySelectorAll('.ant-message-notice')].map(x=>n(x.textContent)).filter(Boolean).join('|')`))?.result?.value);

// B: 删除
console.log('click delete B:', (await clickBtn('删除'))?.result?.value);
await waitUntil('() => !!document.querySelector(".ant-modal-confirm-root")', 3000);
console.log('confirm delete:', (await ev(`(function(){const b=[...document.querySelectorAll('.ant-modal-confirm-root button')].find(x=>n(x.textContent)==='确定');return b?(b.click(),'OK'):'NO';})()`))?.result?.value);
await sleep(2500);
console.log('delete toast:', (await ev(`[...document.querySelectorAll('.ant-message-notice')].map(x=>n(x.textContent)).filter(Boolean).join('|')`))?.result?.value);
const bGone = await waitUntil(`() => ![...document.querySelectorAll('.ant-table-tbody a')].some(x=>n(x.textContent)==='${B}')`, 6000);
console.log('B row gone after delete:', bGone);

// ===== 断言（任一失败 → 非零退出码）=====
const checks = [];
const check = (name, ok) => { checks.push({ name, ok: !!ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}`); };
check('新增后 A 行出现', aRow);
check('新增后 B 行出现', bRow);
check('删除后 B 行消失', bGone);
const aStill = await ev(`(function(){return [...document.querySelectorAll('.ant-table-tbody a')].some(x=>n(x.textContent)==='${A}')?'1':'0';})()`);
check('删 B 后 A 行仍在（表格只剩 A）', aStill?.result?.value === '1');

// 刷新页面：数据不丢失（T026 验收标准）
await ev(`location.reload()`);
const readyAfterReload = await waitUntil("() => [...document.querySelectorAll('button')].some(x=>n(x.textContent)==='新增表达')", 60000);
check('刷新后页面就绪', readyAfterReload);
const aAfterReload = await waitUntil(`() => [...document.querySelectorAll('.ant-table-tbody a')].some(x=>n(x.textContent)==='${A}')`, 20000);
check('刷新后数据不丢失（A 行仍在）', aAfterReload);

ws.close();
kids.forEach(killTree);
await sleep(1500);

// 数据库级断言（node:sqlite，可读写打开以便 WAL 归并）
let dbOk = false;
try {
  const dbs = new DatabaseSync(DB_FILE);
  const ca = dbs.prepare('SELECT COUNT(*) c FROM expressions WHERE title = ?').get(A);
  const cb = dbs.prepare('SELECT COUNT(*) c FROM expressions WHERE title = ?').get(B);
  check('DB: A 行存在', ca.c === 1);
  check('DB: B 行已删除', cb.c === 0);
  dbs.close();
  dbOk = true;
} catch (e) {
  check(`DB 断言（异常: ${e.message}）`, false);
}

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.log(`E2E FAIL（${failed.length}/${checks.length}）: ${failed.map((f) => f.name).join(' | ')}`);
  console.log(`临时 DB 保留: ${DB_FILE}`);
  process.exit(1);
}
if (dbOk) { try { rmSync(DB_DIR, { recursive: true, force: true }); } catch { } }
console.log(`E2E PASS（${checks.length}/${checks.length} 全部通过）`);
process.exit(0);
