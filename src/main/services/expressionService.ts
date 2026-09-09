// T026 — 表达库 service（electron-free，可纯 Node/vitest 测试）
//
// 职责：
// - 对 IPC 边界载荷做 Zod 校验（纵深防御：renderer 即使被篡改/出 bug，写库前也必须合法）。
// - 把仓储的 ExpressionRow 映射为共享类型 ExpressionRecord（IPC 只暴露共享契约字段）。
//
// 设计要点（docs/02、docs/06、docs/08 T026）：
// - 本模块不 import Electron / 数据库连接；仓储（ExpressionRepository）由调用方注入。
// - 所有函数返回统一 Result<T>，不抛异常。
// - 字段值域与 docs/03 §2.4 一致；可选字段（pattern/example/scenario/notes）允许 null
//   显式清空（编辑场景）。
// - nextReviewAt 不由用户表单写入（由 T027+ 复习循环维护）。
// - 中文错误提示复用 T021 的 formatZodError（invalid_enum_value/too_small 等统一措辞）。
import { z } from 'zod';
import { err, ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import type { ExpressionRepository } from '../db/repositories/expressions';
import type { ExpressionRow } from '../db/schema';
import type {
  CreateExpressionInput,
  ExpressionRecord,
  ExpressionStatus,
  UpdateExpressionInput,
} from '../../shared/types/library';
import { formatZodError } from './aiSchemas';

// —— 值域常量（与 shared/types/library.ts 一致）——
export const MASTERY_STATUSES = ['new', 'learning', 'familiar'] as const;
export const EXPRESSION_STATUSES = ['active', 'archived'] as const;

// —— 字段级 Schema（message 仅兜底；中文提示由 formatZodError 统一产出）
//    长度上限严格对齐 docs/03 §2.4：title≤50 / chineseMeaning≤100 / pattern≤20 /
//    example≤200 / scenario≤20 / notes≤200
const titleField = z.string().trim().min(1).max(50);
const chineseMeaningField = z.string().trim().min(1).max(100);
const patternField = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .nullable()
  .optional();
const exampleField = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .nullable()
  .optional();
const scenarioField = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .nullable()
  .optional();
const notesField = z.string().trim().min(1).max(200).nullable().optional();
const masteryField = z.enum(MASTERY_STATUSES);
const statusField = z.enum(EXPRESSION_STATUSES);

const createFields = {
  title: titleField,
  chineseMeaning: chineseMeaningField,
  pattern: patternField,
  example: exampleField,
  scenario: scenarioField,
  notes: notesField,
  masteryStatus: masteryField.optional(),
};

/** 新增载荷（T026 IPC 边界校验）。 */
export const expressionCreateSchema = z.object(createFields) as z.ZodType<CreateExpressionInput>;

/** 编辑载荷（全部可选；null 显式清空；可含 status 归档/恢复；strict：拒绝未预期字段）。 */
export const expressionUpdateSchema = z.object({
  ...createFields,
  status: statusField,
})
  .strict()
  .partial() as z.ZodType<UpdateExpressionInput>;

export const expressionIdSchema = z.string().trim().min(1).max(64) as z.ZodType<string>;
export const expressionStatusSchema = z.enum(EXPRESSION_STATUSES) as z.ZodType<ExpressionStatus>;

// —— 解析辅助（非法输入 → validation，信息用户可读）——

function toZodResult<T>(schema: z.ZodType<T>, input: unknown): Result<T> {
  const r = schema.safeParse(input);
  if (!r.success) return err('validation', formatZodError(r.error));
  return ok(r.data);
}

export function parseExpressionCreate(input: unknown): Result<CreateExpressionInput> {
  return toZodResult(expressionCreateSchema, input);
}

export function parseExpressionUpdate(input: unknown): Result<UpdateExpressionInput> {
  return toZodResult(expressionUpdateSchema, input);
}

export function parseExpressionId(input: unknown): Result<string> {
  return toZodResult(expressionIdSchema, input);
}

export function parseExpressionStatus(input: unknown): Result<ExpressionStatus> {
  return toZodResult(expressionStatusSchema, input);
}

// —— Row → 共享记录映射（显式列字段，杜绝把数据库内部字段泄露给 renderer）——
function toRecord(row: ExpressionRow): ExpressionRecord {
  return {
    id: row.id,
    title: row.title,
    chineseMeaning: row.chineseMeaning,
    pattern: row.pattern,
    example: row.example,
    scenario: row.scenario,
    notes: row.notes,
    sourceSampleId: row.sourceSampleId,
    masteryStatus: row.masteryStatus,
    nextReviewAt: row.nextReviewAt,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// —— 业务函数（仓储注入，返回统一 Result）——

/** 列出全部表达（含归档），按创建时间倒序；筛选由页面侧完成（本地数据量小）。 */
export function listExpressions(repo: ExpressionRepository): Result<ExpressionRecord[]> {
  const r = repo.listAll();
  if (!r.ok) return r;
  return ok(r.data.map(toRecord));
}

/** 新增表达。 */
export function createExpression(
  repo: ExpressionRepository,
  input: CreateExpressionInput,
): Result<ExpressionRecord> {
  const r = repo.create(input);
  if (!r.ok) return r;
  return ok(toRecord(r.data));
}

/** 编辑表达（含 status 归档/恢复）。id 不存在 → 仓储错误（经 toResult 归类）。
 *  空 patch（无有效键）→ 直接返回当前记录，不触碰 update（no-op 短路）。 */
export function updateExpression(
  repo: ExpressionRepository,
  id: string,
  patch: UpdateExpressionInput,
): Result<ExpressionRecord> {
  if (Object.keys(patch).length === 0) {
    const g = repo.get(id);
    if (!g.ok) return g;
    if (g.data === null) return err('storage', `表达不存在: ${id}`);
    return ok(toRecord(g.data));
  }
  const r = repo.update(id, patch);
  if (!r.ok) return r;
  return ok(toRecord(r.data));
}

/** 永久删除。返回是否实际删除（id 不存在 → ok(false)，不算错误）。 */
export function deleteExpression(repo: ExpressionRepository, id: string): Result<boolean> {
  return repo.delete(id);
}

/** 归档 / 恢复。 */
export function setExpressionStatus(
  repo: ExpressionRepository,
  id: string,
  status: ExpressionStatus,
): Result<ExpressionRecord> {
  const r = repo.setStatus(id, status);
  if (!r.ok) return r;
  return ok(toRecord(r.data));
}
