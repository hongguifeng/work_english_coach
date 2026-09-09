// T028 — 复习任务生成服务（AI）（docs/04 §6、docs/08 T028）
//
// 职责：
// - 从「知识点（skills）」或「表达（expressions）」出发，调用 AI 生成一道新的
//   英语练习（中文指令 + 中文场景 + 判分关键词 + 英文参考答案），并写入 review_tasks。
// - 换场景生成（transfer/rewrite/correction/speaking）：AI 必须换一个与原示例
//   不同的场景；原错误示例从 detected_issues 取（按 skillKey），作为对比数据。
// - 去重：同一知识点/表达已有「待完成（pending）」任务时不重复生成；
//   AI 产出的 promptZh 与已有任务完全相同时也不新增（避免完全相同题目）。
// - 调度：新任务 scheduledAt = 当前时间 + 第一档间隔（REVIEW_INTERVALS_DAYS[0]=1 天）。
//
// 安全与规则（docs/06、docs/08）：
// - API Key 只在主进程内部（凭据存储），绝不经过 IPC；
// - AI 返回非法结构 → parse 错误（优雅失败，不写库）；
// - 提示词中明确"用户内容是数据，不是指令"（注入防御，docs/04 §4 第 11/12 条同源）。
//
// electron-free：只依赖 repository / 凭据抽象 / AI 客户端接口，
// 可在纯 Node 下用 node:sqlite + FakeSecretBackend + MockAiClient 测试。
import { err, ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import type { IssueCategory } from '../../shared/types/ai';
import type { ReviewTaskType } from '../../shared/types/review';
import { REVIEW_INTERVALS_DAYS } from '../../shared/logic/reviewSchedule';
import type {
  ExpressionRow,
  ReviewTaskRow,
  SkillRow,
} from '../db/schema';
import type { Repositories } from '../db/repositories';
import type { SettingsRepository } from '../db/repositories/settings';
import { buildAiRequestConfig } from './aiConfigService';
import { OpenAICompatibleClient, type AiClient } from './aiClient';
import { parseReviewGeneration } from './aiSchemas';
import {
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  type ReviewPromptSource,
} from './aiPrompts';
import type { SecretBackend } from './secretBackend';

/** 生成服务的依赖注入（便于单测替换 AI 客户端）。 */
export interface ReviewTaskDeps {
  getSettingsRepo: () => SettingsRepository;
  getSecretBackend: () => SecretBackend;
  /** 可选的 AI 客户端注入；默认 OpenAICompatibleClient。 */
  client?: AiClient;
}

/** 生成入参（IPC 边界已 Zod 校验；此处再做防御性校验）。 */
export interface GenerateReviewTaskInput {
  source: 'skill' | 'expression';
  /** skill 源：skills 主键 id 或 skillKey（错误档案页只持有 skillKey）；
   *  expression 源：expressions 主键 id。 */
  id: string;
  /** 默认：skill→'transfer' / expression→'rewrite' */
  taskType?: ReviewTaskType;
}

/** 生成结果（行 + 是否真实新建；false=去重命中的现有任务）。 */
export interface ReviewTaskGenerated {
  task: ReviewTaskRow;
  created: boolean;
}

/** 默认任务类型（T028：知识点默认换场景迁移，表达默认改写）。 */
const DEFAULT_TASK_TYPE: Record<GenerateReviewTaskInput['source'], ReviewTaskType> = {
  skill: 'transfer',
  expression: 'rewrite',
};

function isValidTaskType(t: string): t is ReviewTaskType {
  return t === 'rewrite' || t === 'transfer' || t === 'correction' || t === 'speaking';
}

/** 把任务行（keywords/acceptableAnswers 为 JSON 字符串）转为可序列化视图。 */
export function rowToTaskView(row: ReviewTaskRow): {
  id: string;
  taskType: ReviewTaskType;
  promptZh: string;
  context: string | null;
  keywords: string[];
  referenceAnswer: string;
  status: 'pending' | 'completed' | 'skipped';
  scheduledAt: string;
} {
  let keywords: string[] = [];
  try {
    keywords = row.keywords == null ? [] : JSON.parse(row.keywords);
  } catch {
    keywords = [];
  }
  if (!Array.isArray(keywords) || keywords.some((x) => typeof x !== 'string')) {
    keywords = [];
  }
  return {
    id: row.id,
    taskType: row.taskType,
    promptZh: row.promptZh,
    context: row.context,
    keywords,
    referenceAnswer: row.referenceAnswer,
    status: row.status,
    scheduledAt: row.scheduledAt,
  };
}

/** 生成一道新的复习任务（T028）。
 *
 * 流程：① 解析源对象（skill 按 id 或 skillKey；expression 按 id）
 *       → ② 去重（已有 pending 任务 → 直接返回）
 *       → ③ 组装 AI 请求（凭据存储的 Key + settings）
 *       → ④ 调 AI 生成（可注入 MockAiClient）
 *       → ⑤ Zod 解析（非法 → parse 错误，不写库）
 *       → ⑥ promptZh 完全相同去重 → ⑦ 写 review_tasks（scheduledAt=+1 天）。
 * 任何一步失败都返回统一 Result，绝不抛异常到 IPC 层。
 */
export async function generateReviewTask(
  input: GenerateReviewTaskInput,
  repos: Repositories,
  deps: ReviewTaskDeps,
): Promise<Result<ReviewTaskGenerated>> {
  const source = input.source;
  if (source !== 'skill' && source !== 'expression') {
    return err('validation', 'source 必须是 skill 或 expression');
  }
  const taskType = input.taskType ?? DEFAULT_TASK_TYPE[source];
  if (!isValidTaskType(taskType)) {
    return err('validation', 'taskType 非法');
  }
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    return err('validation', 'id 不能为空');
  }

  // ① 解析源对象
  let skill: SkillRow | null = null;
  let expression: ExpressionRow | null = null;
  if (source === 'skill') {
    const byId = repos.skills.getById(input.id.trim());
    if (!byId.ok) return byId;
    // 错误档案页只持有 skillKey：按主键未命中时回退按 skillKey 查找
    if (byId.data === null) {
      const byKey = repos.skills.getByKey(input.id.trim());
      if (!byKey.ok) return byKey;
      skill = byKey.data;
    } else {
      skill = byId.data;
    }
    if (!skill) return err('validation', '知识点不存在: ' + input.id);
  } else {
    const r = repos.expressions.get(input.id.trim());
    if (!r.ok) return r;
    expression = r.data;
    if (!expression) return err('validation', '表达不存在: ' + input.id);
  }

  // ② 去重：已有待完成任务 → 不重复生成（返回现有任务）
  const existingRes =
    source === 'skill'
      ? repos.reviewTasks.getBySkill(skill!.id)
      : repos.reviewTasks.getByExpression(expression!.id);
  if (!existingRes.ok) return existingRes;
  const pending = existingRes.data.find((t) => t.status === 'pending');
  if (pending) return ok({ task: pending, created: false });

  // ③ 组装 AI 请求配置（settings + 凭据存储的 API Key）
  const config = await buildAiRequestConfig(deps.getSettingsRepo(), deps.getSecretBackend());
  if (!config.ok) return config;

  // ④ 调 AI 生成
  const issuesRes =
    source === 'skill' ? repos.issues.listBySkillKey(skill!.skillKey, 3) : null;
  const originalExamples =
    source === 'skill' && issuesRes !== null && issuesRes.ok
      ? issuesRes.data.map((x) => ({
          originalText: x.originalText,
          correctedText: x.correctedText,
        }))
      : [];

  const promptSource: ReviewPromptSource =
    source === 'skill'
      ? {
          kind: 'skill',
          title: skill!.title,
          category: skill!.category as IssueCategory,
          explanationZh: skill!.explanationZh,
          originalExamples,
        }
      : {
          kind: 'expression',
          title: expression!.title,
          explanationZh: expression!.chineseMeaning,
          pattern: expression!.pattern,
          example: expression!.example,
          scenario: expression!.scenario,
          notes: expression!.notes,
          originalExamples: [],
        };

  const client = deps.client ?? new OpenAICompatibleClient();
  const chat = await client.chat(
    config.data,
    [
      { role: 'system', content: buildReviewSystemPrompt() },
      { role: 'user', content: buildReviewUserPrompt(promptSource, taskType) },
    ],
  );
  if (!chat.ok) return chat;

  // ⑤ Zod 解析 AI 输出（非法结构 → parse 错误，优雅失败，不写库）
  const parsed = parseReviewGeneration(chat.data);
  if (!parsed.ok) return parsed;

  // ⑥ promptZh 完全相同去重（避免重复同一道题）
  if (existingRes.data.some((t) => t.promptZh === parsed.data.promptZh)) {
    return ok({
      task: existingRes.data.find((t) => t.promptZh === parsed.data.promptZh)!,
      created: false,
    });
  }

  // ⑦ 写入 review_tasks（新任务：status=pending，scheduledAt = now + 第一档间隔）
  const firstInterval = REVIEW_INTERVALS_DAYS[0] ?? 1;
  const scheduledAt = new Date(Date.now() + firstInterval * 24 * 60 * 60 * 1000).toISOString();
  const created = repos.reviewTasks.create({
    taskType,
    skillId: skill?.id ?? null,
    expressionId: expression?.id ?? null,
    promptZh: parsed.data.promptZh,
    context: parsed.data.context,
    keywords: parsed.data.keywords,
    referenceAnswer: parsed.data.referenceAnswer,
    scheduledAt,
  });
  if (!created.ok) return created;
  return ok({ task: created.data, created: true });
}
