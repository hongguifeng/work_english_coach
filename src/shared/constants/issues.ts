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
