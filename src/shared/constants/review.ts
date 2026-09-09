// 复习题型常量（docs/07 §5.2，权威来源；renderer/main 共用）
// correction=错误纠正 / transfer=句型迁移 / rewrite=场景写作 / free=自由输出 / oral=口语表达
//
// 与 src/shared/types/review.ts 的 ReviewTaskType 字面量联合保持一致。

export const REVIEW_TASK_TYPES = ['correction', 'transfer', 'rewrite', 'free', 'oral'] as const;
