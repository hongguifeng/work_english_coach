// T033 — 学习统计 IPC（主进程）
//
// 暴露的渠道：
//   stats:study  基础学习统计（本周练习/独立完成/待复习/高频错误/近七天趋势）
//
// 安全与规则（docs/02、docs/08 T033）：
// - 纯 DB 查询，无 AI、无副作用。
// - 统计基于 review_attempts（AI 自动修改不算掌握；不生成等级分数）。
// - 返回统一 Result<StudyStatsView>；日志只记录结果码与计数，不记录工作文本。
import { ipcMain } from 'electron';
import { err } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import type { StudyStatsView } from '../../shared/types/studyStats';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { createRepositories } from '../db/repositories';
import { getStudyStats } from '../services/studyStatsService';
import { devLog } from '../log';

function errFromUnknown(e: unknown): Result<StudyStatsView> {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerStatsIpc(): void {
  ipcMain.handle('stats:study', async (): Promise<Result<StudyStatsView>> => {
    try {
      const r = getStudyStats(createRepositories(getDatabase()));
      if (r.ok) {
        // 只记录计数，不记录错误原文/知识点明细（避免敏感工作文本进日志）
        devLog(
          `stats:study -> ok (week=${r.data.weekPracticeCount}, independent=${r.data.independentCount}, ` +
            `pending=${r.data.pendingTaskCount}, topErrors=${r.data.topErrors.length}, hasData=${r.data.hasAnyData})`,
        );
      }
      return r;
    } catch (e) {
      devLog('stats:study fail:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });
}
