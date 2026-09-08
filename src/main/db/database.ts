import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/**
 * 完全类型化的 Drizzle 数据库实例，供主进程各处使用。
 * 包含 `drizzle()` 挂载的 `$client`（原生 better-sqlite3 句柄），
 * 用于迁移与驱动探针等原生 SQL 场景。
 */
export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

/** 应用专用数据目录：Windows 用户数据目录（%APPDATA%/WorkEnglish Coach/work-english-coach），绝不放在项目源码目录 */
export function getDbDir(): string {
  return join(app.getPath('userData'), 'work-english-coach');
}

export function getDbFile(): string {
  return join(getDbDir(), 'work-english-coach.db');
}

let rawDb: Database.Database | null = null;
let dbInstance: AppDatabase | null = null;

/**
 * 初始化数据库（幂等）：
 * 1. 创建应用数据目录（首次启动自动创建）
 * 2. 打开文件型数据库（better-sqlite3 自动创建文件）
 * 3. WAL + 外键约束
 * 4. 返回 Drizzle 实例
 *
 * 失败时抛出带明确原因的错误（调用方负责展示给用户）。
 */
export function initDatabase(): AppDatabase {
  if (dbInstance) return dbInstance;

  const file = getDbFile();
  try {
    mkdirSync(getDbDir(), { recursive: true });
    const sqlite = new Database(file);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    rawDb = sqlite;
    dbInstance = drizzle(sqlite, { schema });
    return dbInstance;
  } catch (err) {
    rawDb?.close();
    rawDb = null;
    dbInstance = null;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`数据库初始化失败（文件: ${file}）: ${msg}`, { cause: err });
  }
}

/** 获取已初始化的数据库；未初始化时抛错（fail fast，避免静默使用未就绪状态） */
export function getDatabase(): AppDatabase {
  if (!dbInstance) {
    throw new Error('数据库未初始化：请先调用 initDatabase()');
  }
  return dbInstance;
}

export function closeDatabase(): void {
  rawDb?.close();
  rawDb = null;
  dbInstance = null;
}
