import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit 配置（T015）：
 * - dialect: sqlite
 * - schema: 主进程 Drizzle Schema
 * - out:   生成的 SQL 迁移目录（drizzle/，随应用打包）
 *
 * 生成：`npm run db:generate`（在 schema 变更后运行，产出 drizzle/0000_*.sql + meta）。
 * 应用：启动时由 `src/main/db/migrations.ts` 的 `migrate()` 执行（幂等，__drizzle_migrations 记录已应用）。
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
