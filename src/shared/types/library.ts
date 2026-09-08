// 表达库共享类型（与 docs/04-api-and-ai-contract.md 的 ExpressionRecord 字段一致）
import type { Audience, IssueCategory, SourceType } from './ai';

export type MasteryLevel = 'needs_review' | 'mastered';
export type ExpressionStatus = 'active' | 'archived';

export interface ExpressionRecord {
  id: number;
  scene: SourceType;
  audience: Audience;
  originalExpression: string;
  correctedExpression: string;
  errorCategory: IssueCategory | null;
  aiSummary: string | null;
  masteryLevel: MasteryLevel;
  status: ExpressionStatus;
  /** ISO 日期字符串（date） */
  createdAt: string;
  /** ISO 日期字符串（date），从未练习为 null */
  lastPracticedAt: string | null;
  timesPracticed: number;
}

export interface AddExpressionInput {
  scene: SourceType;
  audience: Audience;
  originalExpression: string;
  correctedExpression: string;
  errorCategory: IssueCategory | null;
  aiSummary: string | null;
  masteryLevel: MasteryLevel;
}

export type UpdateExpressionInput = Partial<AddExpressionInput> & {
  status?: ExpressionStatus;
};
