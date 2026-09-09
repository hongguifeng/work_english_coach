import { Card, Empty, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ReviewTask,
  TaskSession,
} from '../../../shared/types/review';
import { PageHeader } from '../components/PageHeader';
import { useDataChanged } from '../lib/useDataChanged';
import { mockEvaluate } from './training/mockReview';
import { TaskDetail } from './training/TaskDetail';
import { TaskList } from './training/TaskList';

const EMPTY_SESSION: TaskSession = {
  answer: '',
  usedHint: false,
  revealed: false,
  loading: false,
  evaluation: null,
};

/**
 * 今日训练（T009 → T029）：左侧任务列表 + 右侧任务详情。
 * T029 起任务来自真实数据库（IPC `review:today`：到期且待完成，错题优先）；
 * 头部显示「今日待完成 / 今日已完成」计数。
 * 提交后的 AI 评价仍为本地 mock（T031 替换为真实 AI 评价 + 掌握调度）。
 */
export default function TrainingPage() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [completedToday, setCompletedToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<
    Record<string, TaskSession>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const r = await window.desktopAPI.reviewToday();
    setLoading(false);
    if (!r.ok) {
      setLoadError(r.error.message);
      message.error('加载今日任务失败：' + r.error.message);
      return;
    }
    setTasks(r.data.tasks);
    setCompletedToday(r.data.completedToday);
    setSelectedId((prev) => prev ?? r.data.tasks[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(() => void load());

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );
  const session = selected
    ? sessions[selected.id] ?? EMPTY_SESSION
    : EMPTY_SESSION;

  const patchSession = useCallback(
    (id: string, patch: Partial<TaskSession>) => {
      setSessions((prev) => {
        const current = prev[id] ?? EMPTY_SESSION;
        return { ...prev, [id]: { ...current, ...patch } };
      });
    },
    [],
  );

  const patchTaskStatus = useCallback(
    (id: string, status: ReviewTask['status']) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status } : t)),
      );
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (!selected || session.answer.trim().length === 0) return;
    patchSession(selected.id, { loading: true });
    try {
      const evaluation = await mockEvaluate(
        selected,
        session.answer,
        session.usedHint,
        session.revealed,
      );
      patchSession(selected.id, { loading: false, evaluation });
      patchTaskStatus(selected.id, 'completed');
      setCompletedToday((n) => n + 1);
    } catch {
      patchSession(selected.id, { loading: false });
      message.error('提交失败，请重试');
    }
  }, [selected, session, patchSession, patchTaskStatus]);

  const handleSkip = useCallback(() => {
    if (!selected) return;
    patchTaskStatus(selected.id, 'skipped');
    const next = tasks.find(
      (t) => t.status === 'pending' && t.id !== selected.id,
    );
    if (next) {
      setSelectedId(next.id);
    } else {
      setSelectedId(null);
    }
    message.info('已跳过，本题仍会出现在之后的复习调度中（T030 生效）');
  }, [selected, tasks, patchTaskStatus]);

  const pendingCount = tasks.filter((t) => t.status === 'pending').length;

  return (
    <div>
      <PageHeader
        title="今日训练"
        description="查看到期复习任务并提交复习结果（错题优先）"
        extra={
          loadError ? (
            <span className="wec-progress-text" style={{ color: '#cf1322' }}>
              {loadError}
            </span>
          ) : tasks.length > 0 || completedToday > 0 ? (
            <span className="wec-progress-text">
              今日待完成 {pendingCount} · 已完成 {completedToday}
            </span>
          ) : undefined
        }
      />
      <div className="wec-training-columns">
        <div className="wec-panel wec-task-list-panel">
          <TaskList
            tasks={tasks}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <Card>
          {selected ? (
            <TaskDetail
              task={selected}
              answer={session.answer}
              usedHint={session.usedHint}
              revealed={session.revealed}
              loading={session.loading}
              evaluation={session.evaluation}
              onAnswerChange={(v) =>
                patchSession(selected.id, { answer: v })
              }
              onUseHint={() =>
                patchSession(selected.id, { usedHint: true })
              }
              onReveal={() => patchSession(selected.id, { revealed: true })}
              onSubmit={() => void handleSubmit()}
              onSkip={handleSkip}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                loading
                  ? '加载中…'
                  : '今天没有待完成的复习任务。完成工作区检查或从错误档案生成复习任务后，这里会显示题目。'
              }
            />
          )}
        </Card>
      </div>
    </div>
  );
}
