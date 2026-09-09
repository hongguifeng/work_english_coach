import type { IssueCategory, IssueSeverity } from './ai';

/** 错误档案中的一条示例（最近出现的原始错误） */
export interface ErrorArchiveExample {
  originalText: string;
  correctedText: string;
  explanationZh: string;
  severity: IssueSeverity;
  createdAt: string;
}

/**
 * 错误档案条目：按 skillKey 聚合（同一个知识点可聚合多次错误）。
 * 掌握度由复习尝试推导（AI 修改不算掌握，产品原则 3）。
 */
export interface ErrorArchiveEntry {
  skillKey: string;
  title: string;
  category: IssueCategory;
  explanationZh: string;
  /** 该知识点累计出现次数（error + suggestion + 其他） */
  count: number;
  /** 其中 severity=error 的次数（真正错误） */
  errorCount: number;
  /** 其中 severity != error 的次数（表达建议 / 语气风险 / 意思不明确） */
  suggestionCount: number;
  /** 最近出现时间（ISO） */
  lastSeenAt: string;
  /** 最近练习时间（ISO；从未练习为 null） */
  lastPracticeAt: string | null;
  /** 最近练习是否独立答对（未练习为 null） */
  lastPracticeCorrect: boolean | null;
  /** 掌握状态（由练习历史推导） */
  masteryStatus: 'new' | 'learning' | 'familiar';
  /** 最近至多 3 条示例（按时间倒序） */
  examples: ErrorArchiveExample[];
}

/** 错误档案查询过滤 */
export interface ErrorArchiveFilter {
  category?: IssueCategory;
  /** error = 只看真正错误；suggestion = 只看建议类；缺省 = 全部 */
  severity?: 'error' | 'suggestion';
}
