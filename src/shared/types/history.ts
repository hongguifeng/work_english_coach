import type { Audience, IssueCategory, IssueSeverity, KeyLearningPoint, PracticeTask, SourceType, Tone } from './ai';

export interface HistoryRecordSummary {
  id: string;
  sourceType: SourceType;
  audience: Audience;
  tone: Tone;
  originalEnglish: string | null;
  minimalRevision: string;
  naturalRevision: string;
  shouldClarify: boolean;
  keyLearningPoint: KeyLearningPoint | null;
  practice: PracticeTask | null;
  issueCount: number;
  createdAt: string;
}

export interface HistoryIssue {
  id: string;
  category: IssueCategory;
  skillKey: string;
  originalText: string;
  correctedText: string;
  explanationZh: string;
  severity: IssueSeverity;
}

export interface HistoryRecord extends HistoryRecordSummary {
  /** AI 推断的用户想表达的意思（新记录有值；旧记录为 null） */
  translationZh: string | null;
  originalChinese: string | null;
  clarificationQuestions: string[];
  issues: HistoryIssue[];
}