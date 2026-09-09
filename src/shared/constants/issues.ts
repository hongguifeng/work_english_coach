// 错误类别中文标签（值域=docs/04 契约 issue.category，11 类）
import type { IssueCategory } from '../types/ai';

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  grammar: '语法',
  vocabulary: '词汇',
  collocation: '搭配',
  preposition: '介词',
  article: '冠词',
  tense: '时态',
  plural: '单复数',
  sentence_structure: '句子结构',
  tone: '语气',
  clarity: '清晰度',
  other: '其他',
};

export const CATEGORY_OPTIONS: { value: IssueCategory; label: string }[] = (
  Object.keys(CATEGORY_LABELS) as IssueCategory[]
).map((value) => ({ value, label: CATEGORY_LABELS[value] }));

// 错误严重度中文标签（T027：页面上区分「真正错误」与「表达建议」）
import type { IssueSeverity } from '../types/ai';

export const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  error: '错误',
  suggestion: '建议',
  tone_risk: '语气风险',
  unclear: '意思不明确',
};

/** antd Tag 颜色（T027） */
export const SEVERITY_TAG_COLORS: Record<IssueSeverity, string> = {
  error: 'red',
  suggestion: 'blue',
  tone_risk: 'orange',
  unclear: 'purple',
};
