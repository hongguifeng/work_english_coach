import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDatabase } from './database';

const hasJournal = (dir: string) => existsSync(join(dir, 'meta', '_journal.json'));

/**
 * 定位磁盘上的 drizzle 迁移目录（含 `meta/_journal.json`）。
 * 从两个锚点（`app.getAppPath()` 与当前模块 `__dirname`）向上逐级搜索，
 * 兼容「项目根 drizzle/」（开发/构建产物）与「resources/drizzle」（打包 extraResources）。
 */
function resolveMigrationsFolder(): string {
  // 开发/测试钩子：显式指定迁移目录（如升级测试、打包校验）
  if (process.env.WEC_MIG_FOLDER) return process.env.WEC_MIG_FOLDER;
  const candidates = new Set<string>();
  if (app.isPackaged) candidates.add(join(process.resourcesPath, 'drizzle'));
  const anchors = [app.getAppPath(), typeof __dirname !== 'undefined' ? __dirname : process.cwd()];
  for (const anchor of anchors) {
    let dir = anchor;
    for (let i = 0; i < 6; i++) {
      candidates.add(join(dir, 'drizzle'));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const c of candidates) if (hasJournal(c)) return c;
  // 未找到时返回首选候选，让 migrate() 抛出带路径的明确错误
  return [...candidates][0];
}

/**
 * 执行所有未应用的迁移（幂等）：
 * drizzle 维护 `__drizzle_migrations` 表记录已应用的迁移（folder_name + hash），
 * 每次只应用尚未记录的部分。返回已记录（含本次新应用）的迁移 hash 列表，
 * 供启动日志与 `WEC_DB_MIGRATE` 探针使用。
 */
export function runMigrations(): string[] {
  const folder = resolveMigrationsFolder();
  const db = getDatabase();
  migrate(db, { migrationsFolder: folder });
  const rows = db.$client
    .prepare('SELECT hash FROM __drizzle_migrations ORDER BY id')
    .all() as Array<{ hash: string }>;
  return rows.map((r) => r.hash);
}
