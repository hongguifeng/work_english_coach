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

/**
 * AI 生成的复习题（docs/04 §6）：中文场景 + 关键词 + 参考答案，且与原始例句不同。
 * 系统据此创建 review_tasks 行（id / status / scheduledAt 由系统补全）。
 */
export type ReviewGenerationResult = {
  taskType: ReviewTaskType;
  promptZh: string;
  context: string;
  keywords: string[];
  referenceAnswer: string;
};

/**
 * T028：复习任务生成入参（IPC 边界再经 Zod 校验）。
 * - skill 源：id 可以是 skills 主键或 skillKey（错误档案页持有 skillKey）；
 * - expression 源：id 必须是 expressions 主键。
 */
export type ReviewGenerateTaskInput = {
  source: 'skill' | 'expression';
  id: string;
  /** 默认：skill→'transfer'（换场景迁移） / expression→'rewrite'（改写） */
  taskType?: ReviewTaskType;
};

/**
 * T028：生成结果（IPC 返回给渲染进程的视图模型）。
 * `created=false` 表示该知识点/表达已有待完成任务（去重，返回现有任务）。
 */
export type ReviewTaskGeneratedView = {
  created: boolean;
  task: {
    id: string;
    taskType: ReviewTaskType;
    promptZh: string;
    context: string | null;
    keywords: string[];
    referenceAnswer: string;
    status: ReviewTaskStatus;
    scheduledAt: string;
  };
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
