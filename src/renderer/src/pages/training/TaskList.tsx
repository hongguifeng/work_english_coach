import { Tag } from 'antd';
import type { ReviewTask, ReviewTaskType } from '../../../../shared/types/review';

export const TASK_TYPE_LABEL: Record<ReviewTaskType, string> = {
  rewrite: '场景写作',
  transfer: '句型迁移',
  correction: '错误纠正',
  speaking: '口语任务（二期）',
};

interface TaskListProps {
  tasks: ReviewTask[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

/** 今日任务列表（T009）：状态点 + 类型 + 题干摘要 */
export function TaskList({ tasks, selectedId, onSelect }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="wec-task-list">
        <div className="wec-task-item-disabled">今天没有到期的复习任务</div>
      </div>
    );
  }

  return (
    <div className="wec-task-list">
      {tasks.map((task) => {
        const done = task.status === 'completed';
        const skipped = task.status === 'skipped';
        const active = task.id === selectedId;
        return (
          <div
            key={task.id}
            className={`wec-task-item${active ? ' active' : ''}${
              done ? ' done' : ''
            }${skipped ? ' skipped' : ''}`}
            onClick={() => onSelect(task.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(task.id);
              }
            }}
          >
            <span
              className={`wec-task-dot ${
                done ? 'done' : skipped ? 'skipped' : 'pending'
              }`}
              aria-hidden
            />
            <div className="wec-task-body">
              <div className="wec-task-title">{task.promptZh}</div>
              <div className="wec-task-meta">
                <Tag style={{ marginRight: 4 }}>{TASK_TYPE_LABEL[task.taskType]}</Tag>
                <span>
                  {done
                    ? '已完成'
                    : skipped
                      ? '已跳过'
                      : task.context}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
