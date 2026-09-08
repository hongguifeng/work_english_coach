import type { AnalyzeDraftInput, AnalyzeDraftResult } from '../../../../shared/types/ai';

const MOCK_DELAY_MS = 700;

/**
 * Mock 分析（T008 占位，T022 替换为真实 AI 调用）。
 * 返回结构必须满足 shared/types/ai 的 AnalyzeDraftResult。
 */
export function mockAnalyze(input: AnalyzeDraftInput): Promise<AnalyzeDraftResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        minimalRevision: `${input.originalEnglish.trim()}`,
        naturalRevision:
          "Hi, the report will be delayed to tomorrow afternoon. I'll send it to you as soon as it's ready.",
        shouldClarify: false,
        clarificationQuestions: [],
        issues: [
          {
            category: 'tense',
            skillKey: 'tense:will-vs-going-to',
            originalText: 'the report will be delay to tomorrow',
            correctedText: 'the report will be delayed to tomorrow',
            explanationZh:
              '被动语态需要用过去分词 delayed，而不是动词原形 delay。',
            severity: 'error',
          },
          {
            category: 'collocation',
            skillKey: 'collocation:as-soon-as',
            originalText: "I will send it in the first time",
            correctedText: "I'll send it to you as soon as it's ready",
            explanationZh:
              '「一……就……」的职场常用结构是 as soon as，比 in the first time 更自然。',
            severity: 'suggestion',
          },
        ],
        keyLearningPoint: {
          skillKey: 'tense:will-vs-going-to',
          title: 'will 的被动结构：will be + 过去分词',
          explanationZh:
            '表达"将会被……"时用 will be + 过去分词（will be delayed / will be sent），这是职场邮件中的高频结构。',
        },
        practice: {
          instructionZh:
            '用英文向同事说明：某个交付物会推迟一天，并承诺完成后立即发送。',
          context: 'IM 消息，发给平级同事',
          referenceAnswer:
            "The deliverable will be delayed by one day. I'll send it to you as soon as it's done.",
          keywords: ['will be delayed', "as soon as"],
        },
      });
    }, MOCK_DELAY_MS);
  });
}
