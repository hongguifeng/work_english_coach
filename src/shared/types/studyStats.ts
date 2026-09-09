// T033 — 基础学习统计视图（共享类型）
//
// 数据来源全部是 review_attempts / review_tasks / detected_issues（docs/08 T033 注意）：
// - 不把 AI 自动修改次数算作掌握；不生成没有可靠依据的英语等级分数。
// - 统计口径：练习 = review_attempts 记录（一次提交一次计数）。

/** 近七天趋势的单日点（date = 本地日期 YYYY-MM-DD）。 */
export interface TrendPoint {
  date: string;
  count: number;
}

/** 高频错误条目（key = 知识点 skillKey）。 */
export interface TopErrorItem {
  key: string;
  count: number;
}

export interface StudyStatsView {
  /** 本周练习次数（本周一至现在，review_attempts）。 */
  weekPracticeCount: number;
  /** 本周独立完成次数（独立答对：coreMeaningCorrect 且未用提示、未查看）。 */
  independentCount: number;
  /** 待复习任务数量（status='pending'）。 */
  pendingTaskCount: number;
  /** 高频错误（按知识点 skillKey 累计，最多 5 条，按次数降序）。 */
  topErrors: TopErrorItem[];
  /** 近七天练习趋势（本地日期，最旧在前，共 7 个点）。 */
  trend: TrendPoint[];
  /** 是否有任何数据（false → UI 显示空状态）。 */
  hasAnyData: boolean;
}
