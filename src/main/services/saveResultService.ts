// T025 — 保存纠错结果（主进程内部服务，electron-free）
//
// 职责（docs/08 T025、docs/03 核心闭环第 3-6 步）：
// - 用户确认纠错结果后，把「样本 + 错误列表」原子写入 communication_samples / detected_issues。
// - 重点知识点 upsert 到 skills（按 skillKey 去重复用；重复时更新最新标题/说明/分类）。
// - 其余错误知识点的 skillKey：skills 表无该行时创建（标题取修改后表达）；已有行不覆盖。
//   （错误档案按 issue.skillKey 聚合，复习任务生成要求每个 skillKey 都有主表行——
//   只写 keyLearningPoint 会导致非重点知识点的「生成复习任务」失败，2026-07-23 生产包 CDP 验收发现。）
// - （可选）把自然表达版存为 expressions 中的可复习表达（masteryStatus=new，关联样本）。
// - 隐私（docs/01）：saveOriginal=false 时不写入原文（NULL），但知识点/表达仍然支撑复习闭环
//   （T025 验收标准：「不保存原文时，知识点仍然可以用于复习」）。
//
// 本模块只依赖 repositories 聚合与 shared 类型（无 electron 导入），
// 可在纯 Node 下用 node:sqlite 测试。
import { err, ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import type {
  AnalyzeDraftResult,
  AnalysisIssue,
  IssueCategory,
  IssueSeverity,
} from '../../shared/types/ai';
import type {
  SaveCorrectionPayload,
  SaveCorrectionSummary,
} from '../../shared/types/saveResult';
import { classifyError } from '../db/errors';
import type { Repositories } from '../db/repositories';

/** 严重程度优先级（越大越严重）。用于从最严重问题推导重点知识点的分类。 */
const SEVERITY_PRIORITY: Record<IssueSeverity, number> = {
  error: 3,
  unclear: 2,
  tone_risk: 1,
  suggestion: 0,
};

/**
 * 推导重点知识点的分类（T025）。
 * AI 契约（docs/04 §3）的 keyLearningPoint 不带 category 字段，
 * 取本样本中最严重问题（error > unclear > tone_risk > suggestion）的分类；
 * 没有问题时回退 'other'。
 */
function deriveSkillCategory(result: AnalyzeDraftResult): IssueCategory {
  let top: AnalysisIssue | null = null;
  for (const issue of result.issues) {
    if (top === null || SEVERITY_PRIORITY[issue.severity] > SEVERITY_PRIORITY[top.severity]) {
      top = issue;
    }
  }
  return top !== null ? top.category : 'other';
}

/** 推导标题：取文本前 40 字符（超长加省略号，避免标题过长）。 */
function deriveTitle(text: string): string {
  const t = text.trim();
  return t.length <= 40 ? t : `${t.slice(0, 40)}…`;
}

/** 推导表达标题：取自然表达版前 40 字符。 */
function deriveExpressionTitle(naturalRevision: string): string {
  return deriveTitle(naturalRevision);
}

/**
 * 保存纠错结果（T025）。
 *
 * 写入顺序：① 样本+错误（事务内原子）→ ② skills upsert（keyLearningPoint）→
 * ②-b 其余错误知识点 skills 补建（仅无行时）→ ③（可选）expressions。
 * 任一步失败返回统一 Result（repository 内部已归类为 storage 等）；
 * 单用户本地工具不做跨步骤回滚——前序成功的数据是真实学习记录，保留比静默回滚更诚实。
 */
export function saveCorrectionResult(
  repos: Repositories,
  payload: SaveCorrectionPayload,
): Result<SaveCorrectionSummary> {
  try {
    const { input, result, saveOriginal, saveExpression } = payload;

    // ① 样本 + 错误列表（saveWithIssues 内部事务，二者要么都写要么都不写）
    const sampleResult = payload.sampleId
      ? (() => {
          const sample = repos.samples.get(payload.sampleId);
          if (!sample.ok) return sample;
          if (sample.data === null) return err('storage', '历史记录不存在');
          const issues = repos.issues.getBySampleId(payload.sampleId);
          if (!issues.ok) return issues;
          return ok({ ...sample.data, issues: issues.data });
        })()
      : repos.samples.saveWithIssues(
          {
            sourceType: input.sourceType,
            audience: input.audience,
            tone: input.tone,
            // 隐私：不保存原文 → 两个原文字段均为 NULL（知识点/表达不受影响）
            originalChinese: saveOriginal ? (input.originalChinese ?? null) : null,
            originalEnglish: saveOriginal ? input.originalEnglish : null,
            minimalRevision: result.minimalRevision,
            naturalRevision: result.naturalRevision,
            shouldClarify: result.shouldClarify,
            clarificationQuestions: result.shouldClarify ? result.clarificationQuestions : null,
            keyLearningPoint: result.keyLearningPoint,
            practice: result.practice,
          },
          result.issues.map((i) => ({
            category: i.category,
            skillKey: i.skillKey,
            originalText: i.originalText,
            correctedText: i.correctedText,
            explanationZh: i.explanationZh,
            severity: i.severity,
          })),
        );
    if (!sampleResult.ok) return { ok: false, error: sampleResult.error };

    // ② 重点知识点 → skills upsert（按 skillKey 去重复用）
    const klp = result.keyLearningPoint;
    const skillResult = repos.skills.upsert({
      skillKey: klp.skillKey,
      title: klp.title,
      category: deriveSkillCategory(result),
      explanationZh: klp.explanationZh,
    });
    if (!skillResult.ok) return { ok: false, error: skillResult.error };

    // ②-b 其余错误知识点 → skills 补建（仅当该 skillKey 尚无行；已有行不覆盖，
    // 避免用 issue 的修正文本覆盖此前 keyLearningPoint 写入的更完整标题/说明）
    const upsertedKeys = new Set<string>([klp.skillKey]);
    for (const issue of result.issues) {
      if (upsertedKeys.has(issue.skillKey)) continue;
      upsertedKeys.add(issue.skillKey);
      const existing = repos.skills.getByKey(issue.skillKey);
      if (!existing.ok) return { ok: false, error: existing.error };
      if (existing.data !== null) continue; // 已存在 → 复用，不覆盖
      const create = repos.skills.upsert({
        skillKey: issue.skillKey,
        title: deriveTitle(issue.correctedText),
        category: issue.category,
        explanationZh: issue.explanationZh,
      });
      if (!create.ok) return { ok: false, error: create.error };
    }

    // ③（可选）保存自然表达版到表达库
    let expressionId: string | null = null;
    if (saveExpression) {
      const exprResult = repos.expressions.create({
        title: deriveExpressionTitle(result.naturalRevision),
        // 隐私：不保存原文时，表达只留英文与场景元数据（chineseMeaning 非空约束用空串）
        chineseMeaning: saveOriginal ? (input.originalChinese ?? '') : '',
        example: result.naturalRevision,
        scenario: input.sourceType,
        notes: `${input.audience} / ${input.tone}`,
        sourceSampleId: sampleResult.data.id,
        masteryStatus: 'new',
      });
      if (!exprResult.ok) return { ok: false, error: exprResult.error };
      expressionId = exprResult.data.id;
    }

    return ok({
      sampleId: sampleResult.data.id,
      savedOriginal: saveOriginal,
      issueCount: result.issues.length,
      skillKey: klp.skillKey,
      expressionId,
    });
  } catch (e) {
    // repository 层已捕获驱动异常；这里是兜底（纯函数/意外错误）
    const a = classifyError(e);
    return err(a.code, a.message, a.debug);
  }
}
