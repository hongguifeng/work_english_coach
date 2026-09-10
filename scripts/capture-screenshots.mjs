#!/usr/bin/env node
// =============================================================================
// 生成文档截图（docs/screenshots/*.png）
//
// 原理：
//   1. 确保 release/win-unpacked/ 生产构建存在（没有则 npm run package:win:dir）
//   2. 首次启动（临时空 DB）→ 建表 → 退出
//   3. node:sqlite 直接预置演示数据（3 知识点 / 4 表达 / 2 样本 / 5 问题 /
//      4 复习任务 / 5 尝试 / AI 设置）
//   4. 再次启动 → CDP 逐页跳转 → 等渲染稳定 → Page.captureScreenshot
//
// 用法：
//   node scripts/capture-screenshots.mjs              # 6 页基础截图
//   node scripts/capture-screenshots.mjs --with-ai    # 工作区页真实调 AI 并截结果
//   node scripts/capture-screenshots.mjs --skip-build # 跳过自动构建
//
// 环境变量：
//   WEC_AI_URL   （默认 http://127.0.0.1:12346/v1）
//   WEC_AI_MODEL （默认 qwen3.8-27b）
//
// 注意：--with-ai 需要本地 AI 服务可达，且本机 keytar 已保存 API Key
//       （设置页 → 保存 API Key）。不满足时自动降级为"只填表单"截图。
//
// 截图清单：
//   01-workspace.png   工作区（草稿 + 分析结果）
//   02-expressions.png 表达库
//   03-errors.png      错误档案
//   04-today.png       每日训练
//   05-stats.png       学习统计
//   06-settings.png    设置
// =============================================================================

import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CDP = 9331;
const AI_URL = process.env.WEC_AI_URL ?? 'http://127.0.0.1:12346/v1';
const AI_MODEL = process.env.WEC_AI_MODEL ?? 'qwen3.8-27b';
const withAi = process.argv.includes('--with-ai');
const skipBuild = process.argv.includes('--skip-build') || process.argv.includes('-s');
const EXE = path.join(ROOT, 'release', 'win-unpacked', 'WorkEnglish Coach.exe');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wec-shots-'));
const env = {
  ...process.env,
  ELECTRON_CDP_PORT: String(CDP),
  ELECTRON_NO_ATTACH_CONSOLE: '1',
  WEC_DB_DIR: tmp,
  WEC_DB_FILE: path.join(tmp, 'coach.db'),
  WEC_REC_DIR: path.join(tmp, 'rec'),
};
for (const k of ['WSLENV', 'ELECTRON_RUN_AS_NODE']) delete env[k];

const logStream = fs.openSync(path.join(tmp, 'app.log'), 'a');

let checks = 0;
let failures = 0;
function check(name, ok, extra = '') {
  checks++;
  if (ok) console.log(`  ok   ${name}${extra ? '  ' + extra : ''}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${extra ? '  ' + extra : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGetJson(u) {
  return new Promise((resolve, reject) => {
    http
      .get(u, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: d }));
      })
      .on('error', reject);
  });
}

async function getWsUrl(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const { status, body } = await httpGetJson(`http://127.0.0.1:${CDP}/json`);
      if (status === 200) {
        const t = JSON.parse(body).find((x) => x.type === 'page' && /index\.html|app\//.test(x.url));
        if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
      }
    } catch {
      /* 重试 */
    }
    await sleep(400);
  }
  return null;
}

const send = (ws, id, m, p) =>
  new Promise((r) => {
    const h = (e) => {
      const m2 = JSON.parse(e.data);
      if (m2.id === id) {
        ws.removeEventListener('message', h);
        r(m2.result ?? (m2.error ? { __error: m2.error } : {}));
      }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method: m, params: p ?? {} }));
  });

const ev = (ws, id, ex, timeoutMs = 30000) =>
  send(ws, id, 'Runtime.evaluate', {
    expression: `(()=>{ ${ex} })()`,
    returnByValue: true,
    awaitPromise: true,
    timeout: timeoutMs,
  });

async function waitUntil(ws, ex, timeoutMs = 30000) {
  const cond = ex.trim().replace(/;+\s*$/, '').replace(/^return\s+/, '');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await ev(ws, 1, `return (function(){ try { return (${cond}) ? 1 : 0; } catch (e) { return 0; } })()`, 15000);
    if (Number(r?.result?.value) === 1) return true;
    await sleep(400);
  }
  return false;
}

function killApp(app) {
  // 必须杀整个进程树：spawn('cmd', ['/c', EXE]) 的 child 是 cmd，
  // 只杀 cmd 会把 WorkEnglish Coach.exe 孤儿化
  try {
    if (app.pid) spawnSync('taskkill', ['/F', '/T', `PID:${app.pid}`], { stdio: 'ignore', timeout: 10000 });
  } catch {
    /* ignore */
  }
  try {
    app.kill();
  } catch {
    /* 已退出 */
  }
}
function killStrays() {
  spawnSync('taskkill', ['/F', '/IM', 'WorkEnglish Coach.exe'], { stdio: 'ignore', timeout: 10000 });
}

function buildIfNeeded() {
  if (fs.existsSync(EXE)) return;
  if (skipBuild) throw new Error(`release/win-unpacked 不存在（--skip-build 时不自动构建）`);
  console.log('[build] win-unpacked 不存在，执行 npm run package:win:dir（可能需要几分钟）…');
  const r = spawnSync('npm', ['run', 'package:win:dir'], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 900000,
    env: process.env,
  });
  if (r.status !== 0) throw new Error('构建失败');
}

// ---------------------------------------------------------------------------
// 预置演示数据（直接写 SQLite，列名与 src/main/db/schema.ts 一致）
// ---------------------------------------------------------------------------
function seedDb() {
  const db = new DatabaseSync(env.WEC_DB_FILE);
  const id = () => crypto.randomUUID();
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  const d = (n) => now - n * 86400000; // n 天前
  const json = (a) => JSON.stringify(a);

  db.exec('PRAGMA foreign_keys=ON');
  db.exec('BEGIN');
  try {
    // --- skills（3 个知识点）---
    const sTense = id();
    const sPunct = id();
    const sTone = id();
    const skillRows = [
      [sTense, 'email-tense', '过去事件用一般过去时', 'grammar',
        '工作邮件里描述已完成的事（已交付、已测试）必须用一般过去时；has/have + 过去分词只用于强调与现在的关联，且不能和 yesterday 等具体过去时间连用。'],
      [sPunct, 'punctuation-spacing', '逗号/句号后的空格与断句', 'grammar',
        '英文里逗号、句号后面必须跟一个空格；两个独立分句用 and 连接时，and 前通常加逗号。中文习惯是这里最容易出现的错误。'],
      [sTone, 'firm-tone', 'firm 语气的礼貌请求', 'tone',
        '向对方提出确认/交付要求时，避免 must/need to 等命令式措辞，用 "please / could you" 等软化结构，既 firm 又不显生硬。'],
    ];
    const insSkill = db.prepare(
      'INSERT INTO skills (id, skillKey, title, category, explanationZh, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)',
    );
    for (const [k, key, t, c, e] of skillRows) insSkill.run(k, key, t, c, e, iso(d(10)), iso(d(10)));

    // --- communication_samples（2 条）---
    const smp1 = id();
    const smp2 = id();
    const insSmp = db.prepare(
      `INSERT INTO communication_samples
       (id, sourceType, audience, tone, originalChinese, originalEnglish,
        minimalRevision, naturalRevision, shouldClarify, clarificationQuestions, createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    insSmp.run(
      smp1, 'email', 'client', 'firm',
      '上周五我们完成了 B 模块的集成测试，请你在明天之前确认，这样我们就能开始压力测试。',
      'Hi Tom, we finish the integration test for module B last Friday. Please confirm by tomorrow and we will start the load test.',
      'Hi Tom, we finished the integration test for module B last Friday. Please confirm by tomorrow, and we will start the load test.',
      'Hi Tom, we completed the integration test for module B last Friday. Could you confirm by tomorrow so we can kick off the load test?',
      0, null, iso(d(9)),
    );
    insSmp.run(
      smp2, 'instant_message', 'colleague', 'neutral',
      '报告我改好了，麻烦你看一下。',
      'I revised the report and sent it, please check it.',
      'I revised the report and sent it. Please check it.',
      "I've revised the report and just sent it over — could you take a look when you get a chance?",
      0, null, iso(d(3)),
    );

    // --- detected_issues（5 条，跨 3 个知识点）---
    const issueRows = [
      [smp1, 'tense', 'email-tense', 'we finish the integration test', 'we finished the integration test',
        '事件发生在 last Friday，应使用一般过去时 finished，而非现在时 finish。', 'major', iso(d(9))],
      [smp1, 'punctuation', 'punctuation-spacing', 'confirm by tomorrow and we will start',
        'confirm by tomorrow, and we will start',
        'and 连接两个独立分句，and 前需加逗号。', 'minor', iso(d(9))],
      [smp1, 'tone', 'firm-tone', 'Please confirm by tomorrow', 'Could you confirm by tomorrow?',
        '对客户用疑问句式比祈使句更礼貌，同时保持明确的截止时间（firm 但不生硬）。', 'suggestion', iso(d(8))],
      [smp2, 'tense', 'email-tense', 'I revised the report and sent it',
        "I've revised the report and sent it",
        '强调对方现在就能看到结果，用现在完成时比一般过去时更贴切。', 'major', iso(d(3))],
      [smp2, 'punctuation', 'punctuation-spacing', 'sent it, please check it', 'sent it. Please check it',
        '陈述与请求是两个独立分句，中间用句号断开，不用逗号拼接（comma splice）。', 'minor', iso(d(3))],
    ];
    const insIssue = db.prepare(
      `INSERT INTO detected_issues
       (id, sampleId, category, skillKey, originalText, correctedText, explanationZh, severity, createdAt)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    for (const [sid, cat, key, o, c, e, sev, t] of issueRows) insIssue.run(id(), sid, cat, key, o, c, e, sev, t);

    // --- expressions（4 条）---
    const eKick = id();
    const eChance = id();
    const exprRows = [
      [eKick, 'kick off', '开始（项目/会议/阶段）', 'kick off <n>', 'Can we kick off the load test tomorrow?',
        '项目启动', '比 start 更有行动感，常用于启动会议、测试阶段等。', smp1, 'learning', null, 'active', iso(d(8)), iso(d(2))],
      [eChance, 'when you get a chance', '当你有空时', 'Could you take a look when you get a chance?',
        '…could you take a look when you get a chance?',
        '委婉请求', '软化直接命令（please check it），降低催促感。', smp2, 'familiar', null, 'active', iso(d(3)), iso(d(1))],
      [id(), 'double-check', '再核对一遍', 'Could you double-check the numbers?',
        'Could you double-check the totals before we send them?',
        '数据确认', '比 check again 更精确，暗示"之前已检查过一次"。', null, 'new', null, 'active', iso(d(6)), iso(d(6))],
      [id(), 'I owe you one', '欠你一个人情', 'If you can cover for me this time, I owe you one.',
        'If you can cover for me this time, I owe you one.',
        '同事协作', '半正式口语；对客户慎用，对同事很自然。', null, 'new', null, 'active', iso(d(4)), iso(d(4))],
    ];
    const insExpr = db.prepare(
      `INSERT INTO expressions
       (id, title, chineseMeaning, pattern, example, scenario, notes,
        sourceSampleId, masteryStatus, nextReviewAt, status, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const r of exprRows) insExpr.run(...r);

    // --- review_tasks（4 条：1 今天到期 pending / 1 未来 pending / 1 completed / 1 skipped）---
    const t1 = id();
    const t2 = id();
    const t3 = id();
    const t4 = id();
    const insTask = db.prepare(
      `INSERT INTO review_tasks
       (id, taskType, skillId, expressionId, promptZh, context, keywords, referenceAnswer,
        acceptableAnswers, status, scheduledAt, completedAt, createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    insTask.run(
      t1, 'transfer', sTense, null,
      '换一个工作场景，用一般过去时（finished）描述一个你已完成、且对方需要知道的动作。',
      '在同事即时消息里告知对方：你昨天修好了登录 bug，今早 QA 已验证通过。',
      json(['finished', '一般过去时', '具体过去时间']),
      'I finished the fix for the login bug yesterday, and QA verified it this morning.',
      json(['I fixed the login bug yesterday and QA checked it this morning.']),
      'pending', iso(now - 20 * 3600000), null, iso(now - 20 * 3600000),
    );
    insTask.run(
      t2, 'correction', sPunct, null,
      '把下面的中文改写成英文，注意逗号/句号后的空格与断句："本周销售额下降了8%，主要是由于供应延迟"',
      '给管理者的周报消息。',
      json(['8%', '下降', '供应延迟']),
      'This week\'s sales dropped 8%, mainly due to the supply delay.',
      null, 'pending', iso(now + 3 * 86400000), null, iso(now + 3 * 86400000 - 3600000),
    );
    insTask.run(
      t3, 'rewrite', sTone, null,
      '把下面这句话改写成更柔和但依然明确的语气："你必须今天回复客户"',
      '催同事尽快回复客户。',
      json(['softening', 'firm']),
      'Could you get back to the client today? That would really help us keep things moving.',
      null, 'completed', iso(now - 2 * 86400000), iso(now - 2 * 86400000 + 3600000), iso(now - 2 * 86400000 - 3600000),
    );
    insTask.run(
      t4, 'free', null, eKick,
      '用 "kick off" 自由造一个与工作相关的句子（任意场景）。',
      '周一站会里宣布新冲刺计划。',
      json(['kick off']),
      'We can kick off the new sprint next Monday.',
      null, 'skipped', iso(now - 5 * 86400000), iso(now - 5 * 86400000 + 3600000), iso(now - 5 * 86400000 - 3600000),
    );

    // --- review_attempts（5 条，分布在近 7 天）---
    const insAtt = db.prepare(
      `INSERT INTO review_attempts
       (id, taskId, userAnswer, usedHint, revealedAnswer, aiScore,
        coreMeaningCorrect, grammarCorrect, toneAppropriate, feedbackZh, improvedAnswer, createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    insAtt.run(id(), t1, 'I finish the fix for the login bug yesterday.', 0, 0, 40, 1, 0, 1,
      '时态错误：yesterday 需要一般过去时 finished。"I finish" 是现在时，表示习惯性动作。',
      'I finished the fix for the login bug yesterday.', iso(d(9)));
    insAtt.run(id(), t1, 'I have finished the fix for the login bug yesterday.', 1, 0, 55, 1, 0, 1,
      '现在完成时不能与 yesterday 等具体过去时间连用，请改用一般过去时。',
      'I finished the fix for the login bug yesterday.', iso(d(7)));
    insAtt.run(id(), t1, 'I finished the fix for the login bug yesterday, and QA verified it this morning.', 0, 0, 92, 1, 1, 1,
      '正确：具体过去时间 + 一般过去时；"this morning" 与 now 有关，QA verified 用过去时也成立（今早已结束）。',
      null, iso(d(4)));
    insAtt.run(id(), t3, 'Could you get back to the client today? That would really help us keep things moving.', 0, 0, 90, 1, 1, 1,
      '语气柔和且截止时间明确，符合 firm 语气要求。', null, iso(d(2)));
    insAtt.run(id(), t4, 'We can kick off the sprint next Monday.', 0, 0, 85, 1, 1, 1,
      '表达自然，kick off 使用正确。', null, iso(d(5)));

    // --- settings（AI 配置 → 设置页会预填）---
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES (?,?,?)')
      .run('aiSettings', JSON.stringify({
        baseUrl: AI_URL,
        model: AI_MODEL,
        timeoutSeconds: 120,
        saveOriginal: true,
        redactEnabled: true,
      }), iso(now));

    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// AI 可达性探测（真实 chat/completions 最小请求）
// ---------------------------------------------------------------------------
function aiReachable() {
  return new Promise((resolve) => {
    const u = new URL(`${AI_URL.replace(/\/$/, '')}/chat/completions`);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300));
      },
    );
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end(JSON.stringify({ model: AI_MODEL, messages: [{ role: 'user', content: 'ping' }], max_tokens: 2 }));
  });
}

async function main() {
  console.log('== capture-screenshots ==');
  console.log(`tmp=${tmp}`);
  console.log(`AI=${AI_URL} model=${AI_MODEL} withAi=${withAi}`);
  console.log('');

  buildIfNeeded();
  check('win-unpacked 存在', fs.existsSync(EXE));

  killStrays();
  await sleep(1000);

  // ---- Phase 1: 启动建表 ----
  console.log('[1/3] 首次启动（建表）…');
  const app1 = spawn('cmd', ['/c', EXE], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  app1.stdout?.on('data', (d) => logStream && fs.writeSync(logStream, d));
  app1.stderr?.on('data', (d) => logStream && fs.writeSync(logStream, d));
  let pageOk = false;
  try {
    const p = await getWsUrl(60000);
    if (p) {
      const ws = new WebSocket(p);
      await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = () => rej(new Error('ws error'));
      });
      // 页面可能仍在导航中（context 被销毁），重试直到 evaluate 成功
      for (let i = 0; i < 60; i++) {
        const rr = await ev(ws, i + 1, 'return 1;', 5000);
        if (Number(rr?.result?.value) === 1) {
          pageOk = true;
          break;
        }
        await sleep(500);
      }
      ws.close();
    }
  } catch {
    /* ignore */
  }
  killApp(app1);
  await new Promise((r) => {
    app1.on('exit', r);
    setTimeout(r, 5000).unref();
  });
  check('首次启动（建表）', pageOk && fs.existsSync(env.WEC_DB_FILE));

  // ---- Phase 2: 预置数据 ----
  console.log('[2/3] 预置演示数据…');
  seedDb();
  check('预置数据写入', true);

  // ---- Phase 3: 截图 ----
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('[3/3] 截图…');
  killStrays();
  await sleep(1000);
  const app2 = spawn('cmd', ['/c', EXE], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  app2.stdout?.on('data', (d) => logStream && fs.writeSync(logStream, d));
  app2.stderr?.on('data', (d) => logStream && fs.writeSync(logStream, d));
  let exit = 0;
  app2.on('exit', (c) => {
    exit = c ?? 0;
  });
  let ws = null;
  try {
    const p = await getWsUrl(60000);
    check('CDP 就绪', !!p);
    if (!p) throw new Error('no ws');
    ws = new WebSocket(p);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('ws error'));
    });
    // 窗口默认 1280x800（createMainWindow），无需调整
    await sleep(1000);
    // 预热：页面可能仍在导航中（context 被销毁），重试直到 evaluate 成功（同 phase 1）
    for (let i = 0; i < 60; i++) {
      const rr = await ev(ws, 900 + i, 'return 1;', 5000);
      if (Number(rr?.result?.value) === 1) break;
      await sleep(500);
    }

    async function shot(hash, cond, condTimeout, file, extraWait = 400) {
      await ev(ws, 1, `return (function(){ location.hash = ${JSON.stringify(hash)}; return 1; })();`, 10000);
      await sleep(700);
      const ok = await waitUntil(ws, cond, condTimeout);
      check(`${file} 渲染条件`, ok);
      if (ok) await sleep(extraWait);
      const r = await send(ws, 1, 'Page.captureScreenshot', { format: 'png' });
      const b = Buffer.from(r.data ?? '', 'base64');
      fs.writeFileSync(path.join(OUT_DIR, file), b);
      console.log(`  -> ${file} (${b.length} bytes)`);
      return b.length > 5000;
    }

    const t30 = 30000;

    // 01 工作区：先基础截图；--with-ai 时再真实调 AI 并覆盖截图
    await shot('#/', 'return (document.querySelectorAll("textarea").length >= 2 && document.querySelector(".wec-content")) ? 1 : 0;', t30, '01-workspace.png', 600);

    if (withAi) {
      const aiOk = await aiReachable();
      console.log(`  AI 可达: ${aiOk}`);
      if (aiOk) {
        // 填草稿（故意含 2 个错误：时态 + 逗号）→ 点「检查」→ 等结果
        await ev(ws, 1, `return (function(){ const tas = document.querySelectorAll('textarea');
          const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
          set(tas[0], '上周五我们完成了 B 模块的集成测试，请你在明天之前确认，这样我们就能开始压力测试。');
          set(tas[1], 'Hi Tom, we finish the integration test for module B last Friday. Please confirm by tomorrow and we will start the load test.');
          return 1; })()`, 10000);
        await sleep(500);
        const btn = await ev(ws, 1, `return (function(){ const st = (x) => (x || '').replace(/\\s+/g, '');
          const bt = Array.from(document.querySelectorAll('button')).find((b) => st(b.textContent).includes('检查'));
          if (bt) { bt.click(); return 1; }
          return 0; })()`, 10000);
        check('点击「检查」', Number(btn.result?.value) === 1);
        const got = await waitUntil(ws, 'return document.body.textContent.includes("最小修改版") ? 1 : 0;', 150000);
        check('AI 分析结果渲染', got);
        await sleep(1500);
        const r = await send(ws, 1, 'Page.captureScreenshot', { format: 'png' });
        const b = Buffer.from(r.data ?? '', 'base64');
        fs.writeFileSync(path.join(OUT_DIR, '01-workspace.png'), b);
        console.log(`  -> 01-workspace.png（覆盖：含 AI 结果, ${b.length} bytes）`);
      }
    }
    // 02 表达库
    await shot('#/expressions', 'return (document.querySelectorAll(".ant-table-row").length >= 4) ? 1 : 0;', t30, '02-expressions.png');
    // 03 错误档案
    await shot('#/errors', 'return (document.querySelectorAll(".ant-table-row").length >= 3) ? 1 : 0;', t30, '03-errors.png');
    // 04 每日训练（自动选中第一个到期任务）
    await shot('#/today', 'return (document.querySelectorAll("textarea").length >= 1) ? 1 : 0;', t30, '04-today.png');
    // 05 学习统计
    await shot('#/stats', 'return (document.querySelectorAll(".ant-statistic").length >= 3) ? 1 : 0;', t30, '05-stats.png');
    // 06 设置
    await shot('#/settings', 'return (document.body.textContent.includes("Base URL") && document.querySelectorAll("input").length >= 3) ? 1 : 0;', t30, '06-settings.png');

    ws.close();
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    killApp(app2);
    await new Promise((r) => {
      app2.on('exit', r);
      setTimeout(r, 5000).unref();
    });
  }

  console.log('');
  console.log(`checks=${checks} failures=${failures} exit=${exit}`);
  console.log(`临时目录: ${tmp}（可手动删除）`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  try {
    fs.closeSync(logStream);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
