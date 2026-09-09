// T017 E2E 种子脚本：向真实数据库（userData/work-english-coach）注入一套演示数据。
// 使用 node:sqlite（纯 Node，与 Electron 版 better-sqlite3 同读写 SQLite 文件格式）。
// 用法: node scripts/seed-demo.mjs
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const dbPath = join(
  process.env.APPDATA,
  'WorkEnglish Coach',
  'work-english-coach',
  'work-english-coach.db',
);
console.log('[seed] db:', dbPath);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

const NOW = new Date().toISOString();

// 清空 6 张学习表（先子后父，保留 settings）
db.exec('DELETE FROM review_attempts');
db.exec('DELETE FROM review_tasks');
db.exec('DELETE FROM expressions');
db.exec('DELETE FROM detected_issues');
db.exec('DELETE FROM skills');
db.exec('DELETE FROM communication_samples');

const s = randomUUID();
const i = randomUUID();
const k = randomUUID();
const e = randomUUID();
const t = randomUUID();
const a = randomUUID();

db.prepare(
  `INSERT INTO communication_samples
    (id, sourceType, audience, tone, originalChinese, originalEnglish,
     minimalRevision, naturalRevision, shouldClarify, clarificationQuestions, createdAt)
   VALUES (?,?,?,?,?,?,?,?,1,'["Is Friday the 25th?"]',?)`,
).run(
  s,
  'email',
  'supplier',
  'formal',
  '提醒供应商周五前确认',
  'We need confirm before Friday.',
  'We need to confirm it before Friday.',
  'We need to confirm with the supplier before Friday.',
  NOW,
);

db.prepare(
  `INSERT INTO detected_issues
    (id, sampleId, category, skillKey, originalText, correctedText, explanationZh, severity, createdAt)
   VALUES (?,?,?,?,?,?,?,?,?)`,
).run(
  i,
  s,
  'grammar',
  'need+to',
  'We need confirm',
  'We need to confirm',
  'need 后必须接 to + 动词',
  'error',
  NOW,
);

db.prepare(
  `INSERT INTO skills
    (id, skillKey, title, category, explanationZh, createdAt, updatedAt)
   VALUES (?,?,?,?,?,?,?)`,
).run(k, 'need+to', 'need + to do', 'grammar', 'need 后必须接 to + 动词', NOW, NOW);

db.prepare(
  `INSERT INTO expressions
    (id, title, chineseMeaning, pattern, example, scenario, notes, sourceSampleId,
     masteryStatus, nextReviewAt, status, createdAt, updatedAt)
   VALUES (?,?,?,?,?,?,?,?,'learning',?,'active',?,?)`,
).run(
  e,
  'confirm by <date>',
  '在某日期前确认',
  'Could you confirm by <date>?',
  'Could you confirm by Friday?',
  '与供应商沟通',
  null,
  s,
  null,
  NOW,
  NOW,
);

db.prepare(
  `INSERT INTO review_tasks
    (id, taskType, skillId, expressionId, promptZh, context, keywords, referenceAnswer,
     acceptableAnswers, status, scheduledAt, completedAt, createdAt)
   VALUES (?,?,?,?,?,?,'["confirm","by Friday"]',?,'["Could you confirm by Friday?"]','pending',?,null,?)`,
).run(
  t,
  'rewrite',
  k,
  e,
  '周五前和供应商确认',
  null,
  'We need to confirm with the supplier before Friday.',
  '2026-07-26',
  NOW,
);

db.prepare(
  `INSERT INTO review_attempts
    (id, taskId, userAnswer, usedHint, revealedAnswer, aiScore, coreMeaningCorrect,
     grammarCorrect, toneAppropriate, feedbackZh, improvedAnswer, createdAt)
   VALUES (?,?,?,0,0,null,1,1,1,'good',null,?)`,
).run(
  a,
  t,
  'We need to confirm with the supplier before Friday.',
  NOW,
);

// settings 保留一条（验证删除时不受影响）
db.prepare(
  `INSERT INTO settings (key, value, updatedAt)
   VALUES ('save_original','true',?)
   ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt`,
).run(NOW);

const counts = {};
for (const tbl of [
  'communication_samples',
  'detected_issues',
  'skills',
  'expressions',
  'review_tasks',
  'review_attempts',
  'settings',
]) {
  counts[tbl] = db.prepare(`SELECT COUNT(*) c FROM ${tbl}`).get().c;
}
console.log('[seed] counts:', counts);
db.close();
console.log('[seed] done');
