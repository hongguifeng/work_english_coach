// 表达库共享类型（T026 起与 docs/03 §2.4 expressions 表字段一致）
//
// 历史说明：T010 曾使用旧版字段模型（scene/audience/originalExpression/
// correctedExpression/aiSummary/masteryLevel），与已落库的 expressions 表不符。
// T026 起以数据库为准（T025 自动保存也写入该模型）。
// 练习次数等派生统计不在 expressions 表内，由 T027+ 的 review 表支撑。

export type MasteryStatus = 'new' | 'learning' | 'familiar';
export type ExpressionStatus = 'active' | 'archived';

/** expressions 表的行结构（与 main/db/schema.ts 的 ExpressionRow 对应）。 */
export interface ExpressionRecord {
  id: string;
  /** 表达标题（可短于 example，用于列表展示与检索） */
  title: string;
  /** 中文含义（必填；T025 在 saveOriginal=false 时写入空串） */
  chineseMeaning: string;
  /** 句式模板（可选，如 "Could you let me know when ...?"） */
  pattern: string | null;
  /** 完整示例句（可选） */
  example: string | null;
  /** 场景（可选；取值与 SOURCE_TYPE_OPTIONS 一致，但列本身是自由文本） */
  scenario: string | null;
  /** 备注（可选；T025 写入 "{audience} / {tone}"） */
  notes: string | null;
  /** 来源样本（手动添加时为空） */
  sourceSampleId: string | null;
  masteryStatus: MasteryStatus;
  /** ISO 日期字符串（下次复习时间；由复习循环 T027+ 维护） */
  nextReviewAt: string | null;
  status: ExpressionStatus;
  createdAt: string;
  updatedAt: string;
}

/** 手动新增表达（title / chineseMeaning 必填，其余可选）。 */
export interface CreateExpressionInput {
  title: string;
  chineseMeaning: string;
  pattern?: string | null;
  example?: string | null;
  scenario?: string | null;
  notes?: string | null;
  masteryStatus?: MasteryStatus;
}

/** 编辑表达（全部可选；null 表示显式清空该可选字段；status 支持归档/恢复）。 */
export type UpdateExpressionInput = Partial<CreateExpressionInput> & {
  status?: ExpressionStatus;
};

/** 掌握状态 → 中文标签（UI 展示用）。 */
export const MASTERY_STATUS_LABELS: Record<MasteryStatus, string> = {
  new: '新学',
  learning: '学习中',
  familiar: '已熟悉',
};
