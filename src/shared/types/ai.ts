/**
 * AI 契约共享类型（见 docs/04-api-and-ai-contract.md）。
 * Main / Renderer 均从此处导入，禁止各自复制定义。
 */

export type SourceType = 'email' | 'instant_message' | 'meeting' | 'report';

export type Audience = 'colleague' | 'manager' | 'client' | 'supplier' | 'other';

export type Tone = 'neutral' | 'formal' | 'friendly' | 'firm';

export type AnalyzeDraftInput = {
  originalChinese?: string;
  originalEnglish: string;
  sourceType: SourceType;
  audience: Audience;
  tone: Tone;
  extraInstruction?: string;
};

export type IssueCategory =
  | 'grammar'
  | 'vocabulary'
  | 'collocation'
  | 'preposition'
  | 'article'
  | 'tense'
  | 'plural'
  | 'sentence_structure'
  | 'tone'
  | 'clarity'
  | 'other';

/** 区分真实错误 / 表达建议 / 语气风险 / 意思不明确 */
export type IssueSeverity = 'error' | 'suggestion' | 'tone_risk' | 'unclear';

export type AnalysisIssue = {
  category: IssueCategory;
  /** 对应 skills 表的知识点 key（如 tense:will-vs-going-to） */
  skillKey: string;
  originalText: string;
  correctedText: string;
  explanationZh: string;
  severity: IssueSeverity;
};

export type KeyLearningPoint = {
  skillKey: string;
  title: string;
  explanationZh: string;
};

/** 迁移练习素材（用于生成 review_task，参考答案不直接展示在结果页） */
export type PracticeTask = {
  instructionZh: string;
  context: string;
  referenceAnswer: string;
  keywords: string[];
};

export type AnalyzeDraftResult = {
  minimalRevision: string;
  naturalRevision: string;
  shouldClarify: boolean;
  clarificationQuestions: string[];
  issues: AnalysisIssue[];
  keyLearningPoint: KeyLearningPoint;
  practice: PracticeTask;
};
