/**
 * 复习任务共享类型（字段见 docs/03-data-model.md §2.5/§2.6，
 * 评价规则见 docs/04 §7）。
 */

export type ReviewTaskType = 'correction' | 'transfer' | 'rewrite' | 'free' | 'oral';

export type ReviewTaskStatus = 'pending' | 'completed' | 'skipped';

/** UI 用的复习任务视图模型（不含敏感内部字段） */
export type ReviewTask = {
  id: string;
  taskType: ReviewTaskType;
  promptZh: string;
  context: string;
  keywords: string[];
  referenceAnswer: string;
  status: ReviewTaskStatus;
  /** ISO 时间（调度时间） */
  scheduledAt: string;
  /** 来源（可选）：错题（skills）或表达（expressions）——训练页用于区分“错题复习/表达复习” */
  skillId?: string;
  expressionId?: string;
};

/**
 * T029：今日任务查询结果。
 * - tasks：已到期（scheduledAt <= 当前）且待完成的任务，
 *   优先显示错题（关联知识点）其次到期表达，再按到期时间；
 * - completedToday：今日已完成数（completedAt >= 今日 0:00）；
 * - pending：tasks 数量（待完成）。
 */
export type TodayReviewView = {
  tasks: ReviewTask[];
  completedToday: number;
  pending: number;
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
  /** 是否使用了目标知识点（docs/04 §7 优先级 5；mock 评价可能无此字段） */
  usedTargetKnowledge?: boolean;
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

/**
 * T030/T031：复习答题提交输入（docs/07 §5.3 评价 prompt 输入 + review_attempt 记录字段）。
 * `userAnswer`/`usedHint`/`revealedAnswer` 来自答题界面（T030）；其余来自任务本身。
 */
export interface EvaluateReviewInput {
  taskType: ReviewTaskType;
  promptZh: string;
  context: string;
  keywords: string[];
  referenceAnswer: string;
  /** 用户本次作答（英文，≥1 个非空白字符）。 */
  userAnswer: string;
  /** 作答前是否使用了关键词提示（如实记录，影响掌握度判断）。 */
  usedHint: boolean;
  /** 作答前是否查看了参考答案（如实记录）。 */
  revealedAnswer: boolean;
}

/**
 * T031：复习答案评价请求（IPC 入参 = 评价输入 + 任务主键）。
 * 成功后主进程写 review_attempt（含 usedHint/revealedAnswer/评价字段）。
 */
export type ReviewEvaluateAnswerPayload = EvaluateReviewInput & {
  /** review_tasks.id（review_attempt.taskId） */
  taskId: string;
};

/** 新建/重置一个题目会话（T030 答题界面初始状态：未用提示、未看答案、无评价）。 */
export function createTaskSession(): TaskSession {
  return { answer: '', usedHint: false, revealed: false, loading: false, evaluation: null };
}
