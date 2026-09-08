import { Card, Empty, message } from 'antd';
import { useCallback, useMemo, useState } from 'react';
import type {
  ReviewTask,
  TaskSession,
} from '../../../shared/types/review';
import { PageHeader } from '../components/PageHeader';
import { mockEvaluate, MOCK_REVIEW_TASKS } from './training/mockReview';
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
 * 今日训练（T009）：左侧任务列表 + 右侧任务详情（mock 数据）。
 * T028–T032 将替换为数据库任务与真实评价/调度。
 */
export default function TrainingPage() {
  const [tasks, setTasks] = useState<ReviewTask[]>(MOCK_REVIEW_TASKS);
  const [selectedId, setSelectedId] = useState<number | null>(
    MOCK_REVIEW_TASKS[0]?.id ?? null,
  );
  const [sessions, setSessions] = useState<
    Record<number, TaskSession>
  >({});

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );
  const session = selected
    ? sessions[selected.id] ?? EMPTY_SESSION
    : EMPTY_SESSION;

  const patchSession = useCallback(
    (id: number, patch: Partial<TaskSession>) => {
      setSessions((prev) => {
        const current = prev[id] ?? EMPTY_SESSION;
        return { ...prev, [id]: { ...current, ...patch } };
      });
    },
    [],
  );

  const patchTaskStatus = useCallback((id: number, status: ReviewTask['status']) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status } : t)),
    );
  }, []);

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

  const doneCount = tasks.filter((t) => t.status !== 'pending').length;

  return (
    <div>
      <PageHeader
        title="今日训练"
        description="查看到期复习任务并提交复习结果"
        extra={
          tasks.length > 0 ? (
            <span className="wec-progress-text">
              已完成 {doneCount} / {tasks.length}
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
              description="今天没有待完成的复习任务。完成工作区检查后，系统会生成复习任务。"
            />
          )}
        </Card>
      </div>
    </div>
  );
}
