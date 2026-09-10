// 设置共享类型（与 docs/03 settings 表、docs/02 settings:get/save IPC 对齐）
// 注意：API Key 不进入该类型、不写入数据库（docs/01 §5.5、docs/03 §2.7），
// 由系统凭据存储（DPAPI）单独保管（T018）。
import { z } from 'zod';

/**
 * AI 配置三个字段的独立 Schema（T042 复用）：
 * aiSettingsSchema（完整保存）与 aiConnectionTestInputSchema（仅测试连接）
 * 共用同一套规则/提示，避免两处漂移。
 */
export const aiBaseUrlSchema = z
  .string()
  .min(1, 'Base URL 不能为空')
  .max(500, 'Base URL 过长')
  .url('Base URL 必须是合法的 http(s) 地址');
export const aiModelSchema = z
  .string()
  .min(1, '模型名称不能为空')
  .max(100, '模型名称过长');
export const aiTimeoutSecondsSchema = z
  .number()
  .int('超时时间必须为整数')
  .min(5, '最小 5 秒')
  .max(300, '最大 300 秒');
export const aiReasoningEffortSchema = z.enum(['none', 'low', 'medium', 'high', 'xhigh']);
/** AI 接口类型：OpenAI Chat Completions（/chat/completions）或 Responses（/responses）。 */
export const aiApiEndpointSchema = z.enum(['chatCompletions', 'responses']);
export type AiApiEndpoint = z.infer<typeof aiApiEndpointSchema>;

export const aiSettingsSchema = z.object({
  /** AI 凭据来源；缺失时兼容旧配置，按 API Key 处理。 */
  provider: z.enum(['apiKey', 'githubCopilot']).optional(),
  /** OpenAI 兼容服务地址，如 https://api.openai.com/v1 或 http://127.0.0.1:12346/v1 */
  baseUrl: aiBaseUrlSchema,
  /** 模型名称，如 gpt-4o-mini、qwen3.8-27b */
  model: aiModelSchema,
  /** 请求超时时间（秒） */
  timeoutSeconds: aiTimeoutSecondsSchema,
  /** 推理强度；旧配置缺失时按 none 处理。 */
  reasoningEffort: aiReasoningEffortSchema.optional(),
  /** API 接口类型；旧配置缺失时按 chatCompletions 处理（GitHub Copilot 模式下忽略，由系统自动选择）。 */
  apiEndpoint: aiApiEndpointSchema.optional(),
  /** 是否保存原始工作文本（用户数据可选择不保存） */
  saveOriginal: z.boolean(),
  /** 是否启用脱敏（发送前对人名、邮箱等做掩码） */
  redactEnabled: z.boolean(),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

/** T042 测试连接输入：设置页表单当前的三个 AI 字段（不含 Key、不含保存原文/脱敏开关）。 */
export interface AiConnectionTestInput {
  provider?: 'apiKey' | 'githubCopilot';
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  reasoningEffort?: z.infer<typeof aiReasoningEffortSchema>;
  apiEndpoint?: AiApiEndpoint;
}

/** T042 测试连接成功结果：仅返回耗时（响应内容丢弃，不展示、不存储）。 */
export interface AiConnectionTestResult {
  latencyMs: number;
}

export interface CopilotLoginInfo {
  userCode: string;
  verificationUri: string;
}

export interface CopilotModel {
  id: string;
  name: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'apiKey',
  baseUrl: 'http://127.0.0.1:12346/v1',
  model: 'qwen3.8-27b',
  timeoutSeconds: 60,
  reasoningEffort: 'none',
  apiEndpoint: 'chatCompletions',
  saveOriginal: true,
  redactEnabled: true,
};
