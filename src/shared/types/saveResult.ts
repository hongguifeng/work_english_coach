import type { AnalyzeDraftInput, AnalyzeDraftResult } from './ai';

/**
 * 保存纠错结果的 IPC 类型（T025）。
 *
 * 载荷 = T022 的「输入 + AI 结果」原样回传 + 用户在保存时的两个显式选择。
 * 主进程在 IPC 边界用 AI 契约 Zod Schema 重新校验后才写库（纵深防御）。
 */
export interface SaveCorrectionPayload {
  /** 提交给 AI 的原始输入（T022） */
  input: AnalyzeDraftInput;
  /** Zod 校验通过的纠错结果（T021/T022） */
  result: AnalyzeDraftResult;
  /** 是否保存原文（用户提交时的选择；false → original 字段为 NULL） */
  saveOriginal: boolean;
  /** 是否把自然表达版存为表达（用户勾选，默认开） */
  saveExpression: boolean;
}

/** 保存纠错的结果摘要（供 UI 成功提示 / 审计）。 */
export interface SaveCorrectionSummary {
  /** 新建 communication_samples 的主键 */
  sampleId: string;
  /** 是否写入了原文（saveOriginal 的回显） */
  savedOriginal: boolean;
  /** 写入的 detected_issues 条数 */
  issueCount: number;
  /** 重点知识点 upsert 到 skills 的 skillKey */
  skillKey: string;
  /** saveExpression=true 时创建的表达 id；未保存时为 null */
  expressionId: string | null;
}
