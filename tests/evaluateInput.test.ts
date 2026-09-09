// T030 — buildEvaluateInput 单元测试（docs/02：共享纯逻辑必须有测试）
//
// 验收覆盖（docs/08 T030）：
// - 提交前校验：空白/空答案 → 结构化错误（不发请求）
// - usedHint / revealedAnswer 如实记录（答题界面捕获 → 评价与 review_attempt 使用）
// - taskType/promptZh/context/keywords/referenceAnswer 从任务透传
import { describe, it, expect } from 'vitest';
import { buildEvaluateInput } from '../src/shared/logic/evaluateInput';
import type { ReviewTask } from '../src/shared/types/review';

const task: ReviewTask = {
  id: 'task-1',
  taskType: 'transfer',
  promptZh: '用英文请同事帮忙 review 你的 SQL 改动',
  context: '代码评审',
  keywords: ['review', 'changes'],
  referenceAnswer: 'Could you take a look at my SQL changes?',
  status: 'pending',
  scheduledAt: '2026-07-24T00:00:00.000Z',
  skillId: 'skill-1',
  expressionId: undefined,
};

describe('buildEvaluateInput', () => {
  it('有效作答 → ok:true，字段透传且答案去首尾空白', () => {
    const r = buildEvaluateInput(task, '  Could you review my changes?  ', true, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.userAnswer).toBe('Could you review my changes?');
    expect(r.data.promptZh).toBe(task.promptZh);
    expect(r.data.context).toBe(task.context);
    expect(r.data.keywords).toEqual(['review', 'changes']);
    expect(r.data.referenceAnswer).toBe(task.referenceAnswer);
    expect(r.data.taskType).toBe('transfer');
    expect(r.data.usedHint).toBe(true);
    expect(r.data.revealedAnswer).toBe(false);
  });

  it('空答案 → ok:false（防空白提交）', () => {
    const r = buildEvaluateInput(task, '', false, false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/作答无效/);
  });

  it('纯空白答案 → ok:false', () => {
    const r = buildEvaluateInput(task, '   \n\t  ', false, false);
    expect(r.ok).toBe(false);
  });

  it('usedHint 如实记录（true → 透传 true）', () => {
    const r = buildEvaluateInput(task, 'please check my code', true, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.usedHint).toBe(true);
  });

  it('revealedAnswer 如实记录（true → 透传 true）', () => {
    const r = buildEvaluateInput(task, 'could you review it', false, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.revealedAnswer).toBe(true);
  });

  it('两种 flags 同时为真 → 均记录', () => {
    const r = buildEvaluateInput(task, 'can you review my changes', true, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.usedHint).toBe(true);
    expect(r.data.revealedAnswer).toBe(true);
  });

  it('taskType 透传（free 题型）', () => {
    const freeTask: ReviewTask = { ...task, taskType: 'free', promptZh: '自由写一段会议总结' };
    const r = buildEvaluateInput(freeTask, 'Here is a summary of today', false, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.taskType).toBe('free');
  });
});
