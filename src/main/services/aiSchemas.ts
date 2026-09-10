// T021 — Zod AI 输出 Schema（electron-free，可纯 Node 测试）
//
// 职责（docs/08 T021、docs/04 契约）：
// - 把 AI 返回的 content 字符串（可能带 Markdown 围栏 / 前后多余文字）稳健地提取成 JSON，
//   并用 Zod 校验成结构化结果（Draft Analysis / Review Generation / Review Evaluation）。
// - 字段缺失 / 类型不符 / 非法枚举值 等一律转换为「用户可理解」的中文提示（code: 'parse'），
//   绝不把 Zod 技术细节或原始异常抛给上层，也绝不让非法输入导致崩溃。
// - 字段名与值域严格对齐 docs/04（见 shared/types/ai.ts、review.ts）。
import { z } from 'zod';
import { REVIEW_TASK_TYPES } from '../../shared/constants/review';
import { err, ok } from '../../shared/types/app';

// 复用 shared 权威常量（5 题型，docs/07 §5.2）；保留 re-export 供 aiPrompts/reviewTaskHandlers
export { REVIEW_TASK_TYPES };
import type { Result } from '../../shared/types/app';
import type {
  AnalyzeDraftInput,
  AnalyzeDraftResult,
  IssueCategory,
  IssueSeverity,
} from '../../shared/types/ai';
import type { AiConnectionTestInput } from '../../shared/types/settings';
import {
  aiBaseUrlSchema,
  aiModelSchema,
  aiTimeoutSecondsSchema,
} from '../../shared/types/settings';
import type {
  ReviewEvaluation,
  ReviewGenerationResult,
} from '../../shared/types/review';

// —— 值域常量（与 shared/types 完全一致；用 as const 得到字面量联合）——
export const ISSUE_CATEGORIES = [
  'grammar',
  'vocabulary',
  'collocation',
  'preposition',
  'article',
  'tense',
  'plural',
  'sentence_structure',
  'tone',
  'clarity',
  'other',
] as const;

export const ISSUE_SEVERITIES = ['error', 'suggestion', 'tone_risk', 'unclear'] as const;

// —— 子对象 Schema ——
const analysisIssueSchema: z.ZodType<{
  category: IssueCategory;
  skillKey: string;
  originalText: string;
  correctedText: string;
  explanationZh: string;
  severity: IssueSeverity;
}> = z.object({
  category: z.enum(ISSUE_CATEGORIES),
  skillKey: z.string().min(1),
  originalText: z.string(),
  correctedText: z.string(),
  explanationZh: z.string(),
  severity: z.enum(ISSUE_SEVERITIES),
});

const keyLearningPointSchema: z.ZodType<{
  skillKey: string;
  title: string;
  explanationZh: string;
}> = z.object({
  skillKey: z.string().min(1),
  title: z.string().min(1),
  explanationZh: z.string(),
});

const practiceSchema: z.ZodType<{
  instructionZh: string;
  context: string;
  referenceAnswer: string;
  keywords: string[];
}> = z.object({
  instructionZh: z.string(),
  context: z.string(),
  referenceAnswer: z.string(),
  keywords: z.array(z.string()),
});

// —— 三个顶层 Schema（输出类型锁定为 shared 契约类型）——
export const draftAnalysisSchema = z.object({
  minimalRevision: z.string(),
  naturalRevision: z.string(),
  shouldClarify: z.boolean().default(false),
  clarificationQuestions: z.array(z.string()).default([]),
  issues: z.array(analysisIssueSchema),
  keyLearningPoint: keyLearningPointSchema,
  practice: practiceSchema,
}) as z.ZodType<AnalyzeDraftResult>;

export const reviewGenerationSchema: z.ZodType<ReviewGenerationResult> = z.object({
  taskType: z.enum(REVIEW_TASK_TYPES),
  promptZh: z.string().min(1),
  context: z.string(),
  keywords: z.array(z.string()),
  referenceAnswer: z.string(),
});

export const reviewEvaluationSchema: z.ZodType<ReviewEvaluation> = z.object({
  coreMeaningCorrect: z.boolean(),
  grammarCorrect: z.boolean(),
  toneAppropriate: z.boolean(),
  /** 是否使用了目标知识点（docs/04 §7 优先级 5；模型遗漏时不导致 parse 失败） */
  usedTargetKnowledge: z.boolean().optional(),
  aiScore: z.number().min(0).max(100),
  feedbackZh: z.array(z.string()),
  improvedAnswer: z.string(),
});

// —— 稳健 JSON 提取：剥离 Markdown 围栏，截取第一个 { 到最后一个 } ——
export function extractJson(raw: string): string | null {
  let s = (raw ?? '').trim();
  if (s.length === 0) return null;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) return s.slice(start, end + 1);
  // 无花括号：原样返回，交给 JSON.parse 判定（失败会转为友好 parse 错误）
  return s;
}

// —— 把 Zod 错误翻译成「用户可理解」的中文提示（最多列 3 条）——
export function formatZodError(error: z.ZodError): string {
  const issues = error.issues.slice(0, 3);
  if (issues.length === 0) return '返回内容与预期结构不符';
  const parts = issues.map((it) => describeIssue(it));
  return parts.join('；');
}

function describeIssue(it: z.ZodIssue): string {
  const path = it.path.length > 0 ? it.path.map(String).join('.') : '整体结构';
  const field = it.path.length > 0 ? `字段「${path}」` : '整体结构';
  switch (it.code) {
    case 'invalid_type':
      if (it.received === 'undefined') return `缺少${field}`;
      return `${field} 类型不符（期望 ${it.expected}）`;
    case 'invalid_enum_value': {
      const opts =
        'options' in it && Array.isArray(it.options)
          ? (it.options as readonly string[]).join(' / ')
          : '';
      return opts ? `${field} 取值非法（应为 ${opts}）` : `${field} 取值非法`;
    }
    case 'too_small':
      return `${field} 太${it.type === 'number' ? '小' : '短'}（最小 ${it.minimum}）`;
    case 'too_big':
      return `${field} 太${it.type === 'number' ? '大' : '长'}（最大 ${it.maximum}）`;
    case 'invalid_string':
      return `${field} 格式无效（${it.validation}）`;
    case 'unrecognized_keys': {
      if (it.path.length > 0) return `${field} 含未预期字段`;
      const keys = it.keys.join('、');
      return keys ? `含未预期字段「${keys}」` : '整体结构 含未预期字段';
    }
    default:
      return `${field}：${it.message}`;
  }
}

// —— 通用解析入口：提取 JSON → 校验 → Result ——
function parseAiJson<T>(raw: string, schema: z.ZodSchema<T>, name: string): Result<T> {
  const jsonStr = extractJson(raw);
  if (jsonStr === null) return err('parse', `${name}：返回内容为空或找不到 JSON`);
  let data: unknown;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    return err('parse', `${name}：JSON 格式非法，无法解析`);
  }
  const res = schema.safeParse(data);
  if (!res.success) return err('parse', `${name}：${formatZodError(res.error)}`);
  return ok(res.data);
}

/** 解析「纠错（Draft Analysis）」AI 输出 → AnalyzeDraftResult。 */
export function parseDraftAnalysis(raw: string): Result<AnalyzeDraftResult> {
  return parseAiJson(raw, draftAnalysisSchema, 'AI 纠错结果');
}

/** 解析「复习题生成（Review Generation）」AI 输出 → ReviewGenerationResult。 */
export function parseReviewGeneration(raw: string): Result<ReviewGenerationResult> {
  return parseAiJson(raw, reviewGenerationSchema, '复习题生成');
}

/** 解析「复习评价（Review Evaluation）」AI 输出 → ReviewEvaluation。 */
export function parseReviewEvaluation(raw: string): Result<ReviewEvaluation> {
  return parseAiJson(raw, reviewEvaluationSchema, '复习评价');
}

// —— 输入 Schema（T022：草稿检查入参）——
// 值域与 shared/types/ai 完全一致（as const 得到字面量联合，供 z.enum）。
const SOURCE_TYPES = ['email', 'instant_message', 'meeting', 'report'] as const;
const AUDIENCES = ['colleague', 'manager', 'client', 'supplier', 'other'] as const;
const TONES = ['neutral', 'formal', 'friendly', 'firm'] as const;

/**
 * 草稿检查的输入契约（T022）。
 * 在把输入交给 AI 前先校验，保证“非法输入不会发送到 AI”（docs/08 T022 验收标准）。
 */
export const analyzeDraftInputSchema = z.object({
  originalEnglish: z
    .string({
      required_error: 'originalEnglish 必填',
      invalid_type_error: 'originalEnglish 必须是字符串',
    })
    .trim()
    .min(1, '英文草稿不能为空')
    .max(10000, '英文草稿过长'),
  originalChinese: z
    .string({ invalid_type_error: 'originalChinese 必须是字符串' })
    .trim()
    .max(2000, '中文原意过长')
    .optional(),
  sourceType: z.enum(SOURCE_TYPES),
  audience: z.enum(AUDIENCES),
  tone: z.enum(TONES),
  extraInstruction: z
    .string({ invalid_type_error: 'extraInstruction 必须是字符串' })
    .trim()
    .max(2000, '额外说明过长')
    .optional(),
});

/** 校验草稿输入；非法时返回 validation 错误（不会发送 AI）。 */
export function parseAnalyzeDraftInput(raw: unknown): Result<AnalyzeDraftInput> {
  const r = analyzeDraftInputSchema.safeParse(raw);
  if (!r.success) return err('validation', formatZodError(r.error));
  return ok(r.data as AnalyzeDraftInput);
}

// —— T042 测试连接输入（设置页表单当前的三个 AI 字段；规则与 aiSettingsSchema 共用）——

export const aiConnectionTestInputSchema = z.object({
  provider: z.enum(['apiKey', 'githubCopilot']).optional(),
  baseUrl: aiBaseUrlSchema,
  model: aiModelSchema,
  timeoutSeconds: aiTimeoutSecondsSchema,
  reasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
  apiEndpoint: z.enum(['chatCompletions', 'responses']).optional(),
});

/** 校验测试连接输入；非法时返回 validation 错误（不会发送 AI）。 */
export function parseAiConnectionTestInput(raw: unknown): Result<AiConnectionTestInput> {
  const r = aiConnectionTestInputSchema.safeParse(raw);
  if (!r.success) return err('validation', formatZodError(r.error));
  return ok(r.data);
}
