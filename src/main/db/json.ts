/**
 * JSON 字段编解码工具（T016 仓储层使用）。
 * 约定：
 * - 可空的字符串数组字段（keywords / clarificationQuestions / acceptableAnswers）
 *   在 SQLite 中以 TEXT 存储 JSON 字符串；
 * - `undefined` / `null` → 存 `NULL`（表示"未提供"）；
 * - 空数组 `[]` → 存 `"[]"`（表示"显式为空"，与未提供区分）；
 * - 读取时 `NULL` → `[]`，非法 JSON / 非字符串数组 → 抛错（fail fast，绝不在 UI 展示损坏数据）。
 */

/** 解析字符串数组字段：null/undefined → []；非法结构抛错。 */
export function parseStringArray(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`JSON 字段解析失败（非合法 JSON）：${raw}`);
  }
  if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== 'string')) {
    throw new Error(`JSON 字段格式错误（应为字符串数组）：${raw}`);
  }
  return parsed;
}

/** 编码字符串数组字段：undefined/null → null（NULL）；其余（含空数组）→ JSON 字符串。 */
export function jsonEncode(values: readonly string[] | null | undefined): string | null {
  if (values == null) return null;
  return JSON.stringify(values);
}
