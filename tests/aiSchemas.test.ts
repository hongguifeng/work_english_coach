// T021 — Zod AI 输出 Schema 测试
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  extractJson,
  formatZodError,
  parseDraftAnalysis,
  parseReviewGeneration,
  parseReviewEvaluation,
  draftAnalysisSchema,
  reviewEvaluationSchema,
} from '../src/main/services/aiSchemas';

// —— 合法样例 ——
function validDraftAnalysis(): Record<string, unknown> {
  return {
    minimalRevision: 'I will send the report by Friday.',
    naturalRevision: "I'll get the report to you by Friday.",
    shouldClarify: false,
    clarificationQuestions: [],
    issues: [
      {
        category: 'tense',
        skillKey: 'tense:will-vs-going-to',
        originalText: 'I send the report',
        correctedText: 'I will send the report',
        explanationZh: '将来动作用 will，而非一般现在时。',
        severity: 'error',
      },
    ],
    keyLearningPoint: {
      skillKey: 'tense:will-vs-going-to',
      title: 'will vs going to',
      explanationZh: '表达承诺/决定用 will。',
    },
    practice: {
      instructionZh: '用 will 表达你会在周一前提交方案。',
      context: '邮件里向经理承诺。',
      referenceAnswer: 'I will submit the proposal by Monday.',
      keywords: ['will', 'submit'],
    },
  };
}

function validReviewGeneration(): Record<string, unknown> {
  return {
    taskType: 'transfer',
    promptZh: '把"我会跟进这件事"改写为正式邮件语气。',
    context: '回复客户邮件。',
    keywords: ['follow up'],
    referenceAnswer: 'I will follow up on this matter.',
  };
}

function validReviewEvaluation(): Record<string, unknown> {
  return {
    coreMeaningCorrect: true,
    grammarCorrect: true,
    toneAppropriate: true,
    aiScore: 88,
    feedbackZh: ['时态可以更自然'],
    improvedAnswer: 'I will follow up on this matter shortly.',
  };
}

describe('extractJson', () => {
  it('strips markdown fences', () => {
    const raw = '```json\n{"a": 1}\n```';
    expect(extractJson(raw)).toBe('{"a": 1}');
  });

  it('extracts JSON embedded in surrounding prose', () => {
    const raw = '好的，结果如下：\n{"a": {"b": 2}}\n希望有帮助！';
    expect(extractJson(raw)).toBe('{"a": {"b": 2}}');
  });

  it('returns trimmed string when no braces (for JSON.parse to reject)', () => {
    expect(extractJson('not json at all')).toBe('not json at all');
  });

  it('returns null for empty input', () => {
    expect(extractJson('   ')).toBeNull();
  });
});

describe('parseDraftAnalysis', () => {
  it('accepts a valid plain JSON object', () => {
    const res = parseDraftAnalysis(JSON.stringify(validDraftAnalysis()));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.issues[0]?.category).toBe('tense');
      expect(res.data.keyLearningPoint.skillKey).toBe('tense:will-vs-going-to');
      expect(res.data.practice.keywords).toEqual(['will', 'submit']);
    }
  });

  it('accepts JSON wrapped in markdown fences with surrounding text', () => {
    const raw = '分析结果：\n```json\n' + JSON.stringify(validDraftAnalysis()) + '\n```\n以上。';
    const res = parseDraftAnalysis(raw);
    expect(res.ok).toBe(true);
  });

  it('rejects non-JSON with a friendly parse error (no throw)', () => {
    const res = parseDraftAnalysis('I cannot return JSON today, sorry.');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('parse');
      expect(res.error.message).toContain('JSON');
    }
  });

  it('rejects a missing required object (keyLearningPoint) with field message', () => {
    const obj = validDraftAnalysis();
    delete obj.keyLearningPoint;
    const res = parseDraftAnalysis(JSON.stringify(obj));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('parse');
      expect(res.error.message).toContain('keyLearningPoint');
    }
  });

  it('rejects an invalid issue category enum with field message', () => {
    const obj = validDraftAnalysis();
    const issues = obj.issues as Array<Record<string, unknown>>;
    issues[0] = { ...issues[0], category: 'not_a_real_category' };
    const res = parseDraftAnalysis(JSON.stringify(obj));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('parse');
      expect(res.error.message).toContain('category');
    }
  });

  it('rejects an invalid severity value', () => {
    const obj = validDraftAnalysis();
    const issues = obj.issues as Array<Record<string, unknown>>;
    issues[0] = { ...issues[0], severity: 'loud' };
    const res = parseDraftAnalysis(JSON.stringify(obj));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('parse');
  });
});

describe('parseReviewGeneration', () => {
  it('accepts a valid object', () => {
    const res = parseReviewGeneration(JSON.stringify(validReviewGeneration()));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.taskType).toBe('transfer');
  });

  it('rejects an invalid taskType', () => {
    const obj = validReviewGeneration();
    obj.taskType = 'essay';
    const res = parseReviewGeneration(JSON.stringify(obj));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('parse');
      expect(res.error.message).toContain('taskType');
    }
  });

  it('rejects empty promptZh (min 1)', () => {
    const obj = validReviewGeneration();
    obj.promptZh = '';
    const res = parseReviewGeneration(JSON.stringify(obj));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('parse');
  });
});

describe('parseReviewEvaluation', () => {
  it('accepts a valid object', () => {
    const res = parseReviewEvaluation(JSON.stringify(validReviewEvaluation()));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.aiScore).toBe(88);
  });

  it('rejects aiScore above 100', () => {
    const obj = validReviewEvaluation();
    obj.aiScore = 150;
    const res = parseReviewEvaluation(JSON.stringify(obj));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('parse');
      expect(res.error.message).toContain('aiScore');
    }
  });

  it('rejects aiScore below 0', () => {
    const obj = validReviewEvaluation();
    obj.aiScore = -5;
    const res = parseReviewEvaluation(JSON.stringify(obj));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('parse');
  });

  it('accepts an empty feedbackZh array', () => {
    const obj = validReviewEvaluation();
    obj.feedbackZh = [];
    const res = parseReviewEvaluation(JSON.stringify(obj));
    expect(res.ok).toBe(true);
  });

  it('rejects aiScore given as a string', () => {
    const obj = validReviewEvaluation();
    obj.aiScore = '88';
    const res = parseReviewEvaluation(JSON.stringify(obj));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('parse');
  });

  it('accepts usedTargetKnowledge when present (T031)', () => {
    const obj = validReviewEvaluation();
    obj.usedTargetKnowledge = true;
    const res = parseReviewEvaluation(JSON.stringify(obj));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.usedTargetKnowledge).toBe(true);
  });

  it('accepts missing usedTargetKnowledge (optional, T031)', () => {
    const res = parseReviewEvaluation(JSON.stringify(validReviewEvaluation()));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.usedTargetKnowledge).toBeUndefined();
  });
});

describe('formatZodError', () => {
  it('produces readable Chinese for two wrong values on a complete object', () => {
    const bad = { ...validReviewEvaluation(), aiScore: 200, feedbackZh: 'not-array' };
    const res = reviewEvaluationSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const msg = formatZodError(res.error);
      expect(msg).toContain('aiScore');
      expect(msg).toContain('feedbackZh');
    }
  });

  it('caps listed issues at 3', () => {
    const res = draftAnalysisSchema.safeParse({});
    expect(res.success).toBe(false);
    if (!res.success) {
      const msg = formatZodError(res.error);
      // 多个缺失字段，但仍只展示前 3 条
      expect(msg.split('；').length).toBeLessThanOrEqual(3);
    }
  });

  it('describeIssue handles invalid_value options', () => {
    const s = z.object({ t: z.enum(['a', 'b']) });
    const res = s.safeParse({ t: 'c' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(formatZodError(res.error)).toContain('a / b');
    }
  });
});
