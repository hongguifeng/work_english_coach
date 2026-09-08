import { eq } from 'drizzle-orm';
import type { Result } from '../../../shared/types/app';
import type { SqlDb } from '../db';
import { toResult } from '../errors';
import type { SettingRow } from '../schema';
import { settings } from '../schema';

/**
 * settings 表仓储（key/value，API Key 不存这里——走 Windows 凭据，见 T018）。
 * 所有时间戳为 ISO 8601 UTC 字符串，由仓储写入。
 */
export class SettingsRepository {
  constructor(private readonly db: SqlDb) {}

  get(key: string): Result<SettingRow | null> {
    return toResult(() => this.db.select().from(settings).where(eq(settings.key, key)).get() ?? null);
  }

  /** upsert：不存在则插入，存在则更新 value 与 updatedAt。 */
  set(key: string, value: string): Result<SettingRow> {
    return toResult(() => {
      const now = new Date().toISOString();
      this.db
        .insert(settings)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
        .run();
      const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
      if (!row) throw new Error('设置写入后未找到: ' + key);
      return row;
    });
  }

  delete(key: string): Result<void> {
    return toResult(() => {
      this.db.delete(settings).where(eq(settings.key, key)).run();
    });
  }

  getAll(): Result<SettingRow[]> {
    return toResult(() => this.db.select().from(settings).all());
  }
}
