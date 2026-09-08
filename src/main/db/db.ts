import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core/db';
import * as schema from './schema';

/**
 * 驱动无关的 Drizzle 同步数据库类型（T016 仓储层统一依赖）。
 *
 * `TRunResult` 在 Drizzle 接口中只出现在协变（返回值）位置，
 * 取 `unknown` 后：
 *   - 生产 `BetterSQLite3Database`（`$client: better-sqlite3`）可赋值到它；
 *   - 测试 `drizzle-node:sqlite`（`$client: node:sqlite DatabaseSync`）亦可赋值到它。
 *
 * 因此仓储函数只依赖本类型即可被生产库与测试库共同注入，
 * 测试无需引入 Electron / better-sqlite3（可脱离 Electron 用纯 Node 跑）。
 */
export type SqlDb = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
