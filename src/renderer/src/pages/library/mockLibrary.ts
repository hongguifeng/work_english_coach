// T010（mock）：表达库示例数据。T026 起替换为 IPC + SQLite 数据。
import type { ExpressionRecord } from '../../../../shared/types/library';
import type { Audience, IssueCategory, SourceType } from '../../../../shared/types/ai';

export interface SeedExpression {
  scene: SourceType;
  audience: Audience;
  originalExpression: string;
  correctedExpression: string;
  errorCategory: IssueCategory | null;
  aiSummary: string | null;
  masteryLevel: 'needs_review' | 'mastered';
  status: 'active' | 'archived';
  createdAt: string;
  lastPracticedAt: string | null;
  timesPracticed: number;
}

const SEEDS: SeedExpression[] = [
  {
    scene: 'email',
    audience: 'client',
    originalExpression: 'We are very sorry, the product have many problems.',
    correctedExpression: 'We sincerely apologize for the issues with the product.',
    errorCategory: 'grammar',
    aiSummary: '向客户致歉时用 sincerely apologize for...，避免 have many problems 的口语化与语法问题。',
    masteryLevel: 'mastered',
    status: 'active',
    createdAt: '2026-06-20',
    lastPracticedAt: '2026-07-07',
    timesPracticed: 6,
  },
  {
    scene: 'email',
    audience: 'manager',
    originalExpression: 'I want to know when will you give the budget.',
    correctedExpression: 'Could you let me know when the budget will be approved?',
    errorCategory: 'tone',
    aiSummary: '向上级询问预算用 Could you let me know...，避免 want to know 的质问感与倒装语序错误。',
    masteryLevel: 'mastered',
    status: 'active',
    createdAt: '2026-06-25',
    lastPracticedAt: '2026-07-06',
    timesPracticed: 4,
  },
  {
    scene: 'email',
    audience: 'client',
    originalExpression: 'We can not do this request.',
    correctedExpression: 'Unfortunately, we are unable to accommodate this request at this time.',
    errorCategory: 'tone',
    aiSummary: '拒绝客户请求用 unfortunately + unable to accommodate，避免 can not do 的生硬与拼写（cannot）。',
    masteryLevel: 'needs_review',
    status: 'active',
    createdAt: '2026-07-01',
    lastPracticedAt: null,
    timesPracticed: 0,
  },
  {
    scene: 'instant_message',
    audience: 'colleague',
    originalExpression: 'I will do it soon, do not worry.',
    correctedExpression: 'I’ll take care of it shortly — no need to worry.',
    errorCategory: 'collocation',
    aiSummary: 'IM 快速回应用 take care of it shortly；do not worry 略显说教，no need to worry 更自然。',
    masteryLevel: 'needs_review',
    status: 'active',
    createdAt: '2026-07-02',
    lastPracticedAt: null,
    timesPracticed: 0,
  },
  {
    scene: 'instant_message',
    audience: 'manager',
    originalExpression: 'I cannot come to the meeting, I am busy now.',
    correctedExpression: 'I’m afraid I won’t be able to make the meeting — I’m tied up with an urgent task right now.',
    errorCategory: 'tone',
    aiSummary: '向上级说明无法参会要给出原因（tied up with...），I am busy now 显得敷衍。',
    masteryLevel: 'needs_review',
    status: 'active',
    createdAt: '2026-07-05',
    lastPracticedAt: '2026-07-08',
    timesPracticed: 1,
  },
  {
    scene: 'meeting',
    audience: 'other',
    originalExpression: 'Your idea is not good, we should do other things.',
    correctedExpression: 'That’s an interesting direction, but I’d suggest we also consider the delivery risk before deciding.',
    errorCategory: 'tone',
    aiSummary: '跨部门会议上否定他人意见要先肯定再转折，并给出具体理由，避免 not good 的直白否定。',
    masteryLevel: 'needs_review',
    status: 'archived',
    createdAt: '2026-06-10',
    lastPracticedAt: null,
    timesPracticed: 0,
  },
];

export function createMockLibrary(): ExpressionRecord[] {
  return SEEDS.map((seed, i) => ({ id: i + 1, ...seed }));
}
