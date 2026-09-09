import type {
  ReviewEvaluation,
  ReviewTask,
  ReviewTaskType,
} from '../../../../shared/types/review';

export const TASK_TYPE_LABEL: Record<ReviewTaskType, string> = {
  correction: '错误纠正',
  transfer: '句型迁移',
  rewrite: '场景写作',
  free: '自由输出',
  oral: '口语表达',
};

const TODAY = new Date().toISOString();

/** Mock 复习任务（T009 占位；T029 起页面默认读库，此 mock 仅供单测/开发参考） */
export const MOCK_REVIEW_TASKS: ReviewTask[] = [
  {
    id: 't-mock-1',
    taskType: 'transfer',
    promptZh:
      '向客户说明：报告会比原计划晚一天交付，但质量会更有保障，请对方谅解。',
    context: '邮件，发给客户，语气正式',
    keywords: ['one day later', 'on time is not possible', 'apologize'],
    referenceAnswer:
      "I'm sorry that the report will be delivered one day later than planned. The extra time will ensure higher quality. Thank you for your understanding.",
    status: 'pending',
    scheduledAt: TODAY,
  },
  {
    id: 't-mock-2',
    taskType: 'correction',
    promptZh: '改正下面的句子：I have worked in this company since 3 years.',
    context: '面试自我介绍',
    keywords: ['for', 'since + 时间点'],
    referenceAnswer:
      'I have worked in this company for 3 years. / I have been in this company since 2023.',
    status: 'pending',
    scheduledAt: TODAY,
  },
  {
    id: 't-mock-3',
    taskType: 'rewrite',
    promptZh:
      '用英文告诉同事：你正在忙，请他稍后再问，你会在下午回复。',
    context: 'IM 消息，发给平级同事',
    keywords: ["I'm busy", 'later today', 'get back to you'],
    referenceAnswer:
      "I'm a bit busy right now. Could you ask me later today? I'll get back to you this afternoon.",
    status: 'pending',
    scheduledAt: TODAY,
  },
];

/**
 * Mock 评价（T009 占位；T031 替换为真实 AI 评价）。
 * 规则：答案 ≥10 字符视为核心意思正确；未用提示且未看答案才算"独立完成"。
 */
export function mockEvaluate(
  task: ReviewTask,
  answer: string,
  usedHint: boolean,
  revealed: boolean,
): Promise<ReviewEvaluation> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const core = answer.trim().length >= 10;
      resolve({
        coreMeaningCorrect: core,
        grammarCorrect: true,
        toneAppropriate: true,
        aiScore: core ? (usedHint || revealed ? 72 : 88) : 40,
        feedbackZh: core
          ? [
              '核心意思表达正确。',
              '建议：开头先说结论，再解释原因，更符合职场沟通习惯。',
            ]
          : ['核心意思不够完整，请覆盖题目中的所有信息点。'],
        improvedAnswer: task.referenceAnswer,
      });
    }, 700);
  });
}
