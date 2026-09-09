import type { ReviewOutcome } from './reviewSchedule';

/**
 * 掌握度推导（纯函数，docs/04 §7 + 产品原则 3：AI 的修改不算用户掌握）。
 *
 * 规则：
 * - 从未练习 → new
 * - 最近一次「独立答对」（未用提示、未查看答案且核心意思正确）→ familiar
 * - 其余（用过提示 / 查看答案 / 答错 / 未评上）→ learning（学习中，不算掌握）
 */
export function deriveMasteryStatus(
  outcomes: readonly ReviewOutcome[] | null | undefined,
): 'new' | 'learning' | 'familiar' {
  if (!outcomes || outcomes.length === 0) return 'new';
  const last = outcomes[outcomes.length - 1];
  return last === 'correct_no_hint' ? 'familiar' : 'learning';
}

/**
 * 把一次复习尝试映射为复习结果（T031/T032 共用）。
 * - 未评上（coreMeaningCorrect 为空，AI 失败/暂存）→ 按答错处理（重置间隔、不升级掌握）
 * - 核心意思错误 → wrong
 * - 核心意思对 + 用了提示 → used_hint
 * - 核心意思对 + 查看答案 → revealed
 * - 核心意思对 + 未提示未查看 → correct_no_hint
 */
export function outcomeFromAttempt(attempt: {
  coreMeaningCorrect?: boolean | null;
  usedHint: boolean;
  revealedAnswer: boolean;
}): ReviewOutcome {
  if (attempt.coreMeaningCorrect === null || attempt.coreMeaningCorrect === undefined) {
    return 'wrong';
  }
  if (!attempt.coreMeaningCorrect) return 'wrong';
  if (attempt.revealedAnswer) return 'revealed';
  if (attempt.usedHint) return 'used_hint';
  return 'correct_no_hint';
}
