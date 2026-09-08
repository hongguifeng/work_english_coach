// T015：数据库迁移「升级」自测（隔离，不触碰真实 schema / 真实用户库）。
//
// 做法：
//   - 在临时目录构造两套迁移：
//       migA = 仅 0000（= 真实第一版迁移）
//       migB = 0000 + 0001（0001 给 settings 加一列 t015probe）
//   - 阶段 A：全新临时 DB + migA  → 记录 1 个迁移
//   - 阶段 B：同一个临时 DB（已含 0000）+ migB → 只增量应用 0001 → 记录 2 个迁移
//   证明「已有数据库升级」= 新迁移能增量应用到已迁移过的库，且不重复执行 0000。
//
// 用法（需先 npm run build）: node scripts/migrate-upgrade-test.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(projectRoot, 'package.json'));
const electronBin = require('electron');

const realDrizzle = join(projectRoot, 'drizzle');
const real0000 = join(realDrizzle, '0000_unique_kylun.sql');
const realJournal = JSON.parse(readFileSync(join(realDrizzle, 'meta', '_journal.json'), 'utf8'));
const entry0 = realJournal.entries[0];

const temp = join(os.tmpdir(), `wec-mig-${Date.now()}`);
rmSync(temp, { recursive: true, force: true });

function buildMig(folder, entries, extraSql) {
  const dir = join(temp, folder);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  copyFileSync(real0000, join(dir, `${entry0.tag}.sql`));
  if (extraSql) writeFileSync(join(dir, `${extraSql.tag}.sql`), extraSql.body, 'utf8');
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries }, null, 2), 'utf8');
  return dir;
}

const entry1 = { idx: 1, version: '6', when: Date.now(), tag: '0001_addprobe', breakpoints: true };
const migA = buildMig('migA', [entry0], null);
const migB = buildMig('migB', [entry0, entry1], {
  tag: '0001_addprobe',
  body: 'ALTER TABLE `settings` ADD COLUMN `t015probe` text;\n',
});

const dbFile = join(temp, 'upgrade.db');

function runMigrate(migFolder) {
  return new Promise((resolveP) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.WEC_DB_MIGRATE = '1';
    env.WEC_DB_DIR = temp;
    env.WEC_DB_FILE = dbFile;
    env.WEC_MIG_FOLDER = migFolder;
    env.WEC_AUTO_QUIT_MS = '3000';
    const child = spawn(electronBin, [join(projectRoot, 'out', 'main', 'index.js')], {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => resolveP(code ?? (signal ? 1 : 0)));
  });
}

console.log('\n>>> 阶段 A：全新临时 DB + migA(仅0000)');
await runMigrate(migA);
console.log('>>> 阶段 B：同一临时 DB + migB(0000+0001，应只增量应用0001)');
const codeB = await runMigrate(migB);

console.log(`\n[migrate-upgrade-test] 完成，阶段B退出码=${codeB}`);
rmSync(temp, { recursive: true, force: true });
process.exit(codeB === 0 ? 0 : 1);
