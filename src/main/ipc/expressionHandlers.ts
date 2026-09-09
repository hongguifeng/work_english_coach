// T026 — 表达库 IPC（主进程）
//
// 暴露的渠道：
//   ▎expression:list        列出全部表达（含归档；筛选由页面侧完成）
//   ▎expression:create      手动新增表达
//   ▎expression:update      编辑表达（含 status 归档/恢复）
//   ▎expression:delete      永久删除（UI 需二次确认；不可恢复）
//   ▎expression:set-status  归档 / 恢复
//
// 规则（docs/02、docs/06、docs/08 T026）：
// - 载荷在 IPC 边界用 Zod 重新校验（纵深防御）；非法 → validation 错误，不写库。
// - 返回统一 Result<T>；异常经 classifyError 归类，不向 UI 抛裸异常。
// - 日志只记录 id / 条数等元信息，不记录表达全文（避免敏感工作文本进日志）。
// - 不做 data:changed 广播（该事件语义为「清空全部数据」；单条增删改由页面自行刷新）。
import { ipcMain } from 'electron';
import { err } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import type { ExpressionRecord } from '../../shared/types/library';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { createRepositories } from '../db/repositories';
import { devLog } from '../log';
import {
  createExpression,
  deleteExpression,
  listExpressions,
  parseExpressionCreate,
  parseExpressionId,
  parseExpressionStatus,
  parseExpressionUpdate,
  setExpressionStatus,
  updateExpression,
} from '../services/expressionService';

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerExpressionIpc(): void {
  ipcMain.handle('expression:list', (): Result<ExpressionRecord[]> => {
    try {
      const result = listExpressions(createRepositories(getDatabase()).expressions);
      if (!result.ok) devLog('expression:list fail:', result.error.debug ?? result.error.message);
      return result;
    } catch (e) {
      devLog('expression:list error:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });

  ipcMain.handle(
    'expression:create',
    (_e, payload: unknown): Result<ExpressionRecord> => {
      try {
        const parsed = parseExpressionCreate(payload);
        if (!parsed.ok) return parsed;
        const result = createExpression(
          createRepositories(getDatabase()).expressions,
          parsed.data,
        );
        if (result.ok) devLog(`expression:create ok (id=${result.data.id})`);
        else devLog('expression:create fail:', result.error.debug ?? result.error.message);
        return result;
      } catch (e) {
        devLog('expression:create error:', e instanceof Error ? e.message : String(e));
        return errFromUnknown(e);
      }
    },
  );

  ipcMain.handle(
    'expression:update',
    (_e, id: unknown, patch: unknown): Result<ExpressionRecord> => {
      try {
        const parsedId = parseExpressionId(id);
        if (!parsedId.ok) return parsedId;
        const parsedPatch = parseExpressionUpdate(patch);
        if (!parsedPatch.ok) return parsedPatch;
        const result = updateExpression(
          createRepositories(getDatabase()).expressions,
          parsedId.data,
          parsedPatch.data,
        );
        if (result.ok) devLog(`expression:update ok (id=${result.data.id})`);
        else devLog('expression:update fail:', result.error.debug ?? result.error.message);
        return result;
      } catch (e) {
        devLog('expression:update error:', e instanceof Error ? e.message : String(e));
        return errFromUnknown(e);
      }
    },
  );

  ipcMain.handle('expression:delete', (_e, id: unknown): Result<boolean> => {
    try {
      const parsedId = parseExpressionId(id);
      if (!parsedId.ok) return parsedId;
      const result = deleteExpression(createRepositories(getDatabase()).expressions, parsedId.data);
      if (result.ok) devLog(`expression:delete ok (id=${parsedId.data}, deleted=${result.data})`);
      else devLog('expression:delete fail:', result.error.debug ?? result.error.message);
      return result;
    } catch (e) {
      devLog('expression:delete error:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });

  ipcMain.handle(
    'expression:set-status',
    (_e, id: unknown, status: unknown): Result<ExpressionRecord> => {
      try {
        const parsedId = parseExpressionId(id);
        if (!parsedId.ok) return parsedId;
        const parsedStatus = parseExpressionStatus(status);
        if (!parsedStatus.ok) return parsedStatus;
        const result = setExpressionStatus(
          createRepositories(getDatabase()).expressions,
          parsedId.data,
          parsedStatus.data,
        );
        if (result.ok) devLog(`expression:set-status ok (id=${result.data.id})`);
        else devLog('expression:set-status fail:', result.error.debug ?? result.error.message);
        return result;
      } catch (e) {
        devLog('expression:set-status error:', e instanceof Error ? e.message : String(e));
        return errFromUnknown(e);
      }
    },
  );
}
