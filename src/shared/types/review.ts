/**
 * 复习任务共享类型（字段见 docs/03-data-model.md §2.5/§2.6，
 * 评价规则见 docs/04 §7）。
 */

export type ReviewTaskType = 'rewrite' | 'transfer' | 'correction' | 'speaking';

export type ReviewTaskStatus = 'pending' | 'completed' | 'skipped';

/** UI 用的复习任务视图模型（不含敏感内部字段） */
export type ReviewTask = {
  id: number;
  taskType: ReviewTaskType;
  promptZh: string;
  context: string;
  keywords: string[];
  referenceAnswer: string;
  status: ReviewTaskStatus;
  /** ISO 时间（调度时间） */
  scheduledAt: string;
};

/** AI 对复习答案的评价（docs/04 §7：最多 3 条反馈） */
export type ReviewEvaluation = {
  coreMeaningCorrect: boolean;
  grammarCorrect: boolean;
  toneAppropriate: boolean;
  /** 0-100，辅助指标，不作为绝对评级 */
  aiScore: number;
  /** 最多 3 条，按重要性排序 */
  feedbackZh: string[];
  improvedAnswer: string;
};

/** 训练页每题的会话状态（本地 UI 状态，非持久化） */
export type TaskSession = {
  answer: string;
  usedHint: boolean;
  revealed: boolean;
  loading: boolean;
  evaluation: ReviewEvaluation | null;
};
