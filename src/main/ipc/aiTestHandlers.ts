// T042 — 设置页「测试连接」IPC（主进程）
//
// 暴露的渠道：
//   ai:test-connection   用表单当前的 Base URL / 模型 / 超时发起一次真实最小 AI 调用
//
// 安全与规则（docs/02、docs/06、docs/08 T042）：
// - 入参先经 Zod 校验（非法输入不会发送到 AI）；只接收三个 AI 字段。
// - API Key 只在主进程内部（凭据存储）读取，从不经过 IPC，也不出现在入参里。
// - 所有渠道返回统一 Result<T>；异常经 classifyError 归类，绝不把原始堆栈抛给 UI。
// - 日志只记录结果码与耗时，不记录密钥或响应内容。
import { ipcMain } from 'electron';
import { err } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import type { AiConnectionTestResult } from '../../shared/types/settings';
import { classifyError } from '../db/errors';
import { devLog } from '../log';
import { testAiConnection } from '../services/aiConnectionTestService';
import { getSharedSecretBackend } from '../services/secretService';

export function registerAiTestIpc(): void {
  ipcMain.handle(
    'ai:test-connection',
    async (_e, input: unknown): Promise<Result<AiConnectionTestResult>> => {
      const deps = {
        getSecretBackend: () => getSharedSecretBackend(),
      };
      try {
        const r = await testAiConnection(input, deps);
        const raw = input as { provider?: string; apiEndpoint?: string };
        devLog(
          `ai:test-connection endpoint=${raw.provider === 'githubCopilot' ? 'auto(copilot)' : (raw.apiEndpoint ?? 'chatCompletions')} -> ${r.ok ? `ok(${r.data.latencyMs}ms)` : r.error.code}`,
        );
        return r;
      } catch (e) {
        devLog('ai:test-connection fail:', e instanceof Error ? e.message : String(e));
        return err(classifyError(e).code, classifyError(e).message, classifyError(e).debug);
      }
    },
  );
}
