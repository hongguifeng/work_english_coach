// 训练模式（T029 真实任务查询 + T030 答题界面）
//
// - T029：任务来自 review:today IPC（错题优先排序、待完成/已完成计数）
// - T030：答题界面（docs/08 T030 验收）——
//   · 默认不展示参考答案（须主动点击「显示参考答案」才显示，并如实记 revealedAnswer）
//   · 「使用提示」显示关键词，并如实记 usedHint
//   · 提交前校验（buildEvaluateInput：空白答案/非法 → 错误提示，不发请求）
//   · 防重复提交：作答中（loading）或已有评价（answered）时提交禁用
// - 评价当前为 mock（mockEvaluate）；T031 替换为真实 AI 评价并持久化 review_attempt
// - 跳过/下一题：本地状态（T031 持久化 skipped 与 complete）
import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useDataChanged } from '../lib/useDataChanged';
import { TaskList } from './training/TaskList';
import { mockEvaluate, TASK_TYPE_LABEL } from './training/mockReview';
import { buildEvaluateInput } from '../../../shared/logic/evaluateInput';
import { createTaskSession, type ReviewTask, type TaskSession } from '../../../shared/types/review';

const { Text, Paragraph } = Typography;

/** 头部计数（T029） */
function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <span title={label} style={{ whiteSpace: 'nowrap' }}>
      {label} <b>{value}</b>
    </span>
  );
}

/** 加载失败（error 状态 + 重试，docs/02 要求） */
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert
      type="error"
      showIcon
      message="加载今日任务失败"
      description={message}
      action={
        <Button size="small" onClick={onRetry}>
          重试
        </Button>
      }
      style={{ marginBottom: 12 }}
    />
  );
}

export function TrainingPage() {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<ReviewTask[] | null>(null);
  const [completedToday, setCompletedToday] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<TaskSession>(createTaskSession());
  const [showKeywords, setShowKeywords] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  // T029：真实查询（今日到期任务 + 今日已完成数）
  function load() {
    const call = window.desktopAPI?.reviewToday;
    if (!call) {
      setLoadError('桌面 API 不可用（请通过 Electron 启动应用）');
      return;
    }
    setLoadError(null);
    void call().then((r) => {
      if (r.ok) {
        setTasks(r.data.tasks);
        setCompletedToday(r.data.completedToday);
        if (r.data.tasks.length > 0) {
          const first = r.data.tasks.find((t) => t.status === 'pending') ?? r.data.tasks[0];
          setSelectedId(first.id);
        } else {
          setSelectedId(null);
        }
        setSession(createTaskSession());
        setShowKeywords(false);
        setShowReference(false);
        setInputError(null);
      } else {
        setTasks(null);
        setLoadError(r.error.message);
      }
    });
  }

  useEffect(load, []);
  useDataChanged(load);

  const selected = tasks?.find((t) => t.id === selectedId) ?? null;
  const submitting = session.loading;
  const answered = session.evaluation !== null;
  const canSubmit = !submitting && !answered && session.answer.trim().length > 0;

  function selectTask(id: string) {
    setSelectedId(id);
    setSession(createTaskSession());
    setShowKeywords(false);
    setShowReference(false);
    setInputError(null);
  }

  /** T030：提交作答 —— 校验 →（T031 替换）真实 AI 评价 → 展示。 */
  function submit() {
    if (!selected || !canSubmit) return;
    const built = buildEvaluateInput(
      selected,
      session.answer,
      session.usedHint,
      session.revealed,
    );
    if (!built.ok) {
      setInputError(built.error);
      return;
    }
    setInputError(null);
    setSession((s) => ({ ...s, loading: true }));
    void mockEvaluate(selected, built.data.userAnswer, built.data.usedHint, built.data.revealedAnswer).then(
      (ev) => {
        setSession((s) => ({ ...s, loading: false, evaluation: ev }));
        message.success('已提交，查看评价');
      },
    );
  }

  /** 跳过（本地；T031 持久化 skipped） */
  function skip() {
    if (!selected || submitting) return;
    if (tasks) {
      setTasks(tasks.map((t) => (t.id === selected.id ? { ...t, status: 'skipped' } : t)));
    }
    const next = tasks?.find((t) => t.status === 'pending' && t.id !== selected.id);
    if (next) selectTask(next.id);
    else {
      setSelectedId(null);
      setSession(createTaskSession());
    }
  }

  /** 下一题 */
  function nextTask() {
    if (!tasks) return;
    const next = tasks.find((t) => t.status === 'pending' && t.id !== selectedId);
    if (next) selectTask(next.id);
    else {
      setSelectedId(null);
      setSession(createTaskSession());
    }
  }

  const ev = session.evaluation;

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <Card
        size="small"
        title={
          <Space size={12}>
            今日复习任务
            {tasks && (
              <SummaryCount label="待完成" value={tasks.filter((t) => t.status === 'pending').length} />
            )}
            {tasks && <SummaryCount label="已完成" value={completedToday} />}
          </Space>
        }
        style={{ width: 340, flexShrink: 0 }}
      >
        {loadError ? (
          <LoadError message={loadError} onRetry={load} />
        ) : !tasks ? (
          <Spin />
        ) : tasks.length === 0 ? (
          <Empty description="暂无今日任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <TaskList tasks={tasks} selectedId={selectedId} onSelect={selectTask} />
        )}
      </Card>

      <Card size="small" style={{ flex: 1, minWidth: 0 }}>
        {selected ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space size={8}>
              <Tag>{TASK_TYPE_LABEL[selected.taskType]}</Tag>
              <Tag color={selected.skillId ? 'orange' : 'blue'}>
                {selected.skillId ? '错题复习' : '表达复习'}
              </Tag>
            </Space>

            <Paragraph style={{ marginBottom: 0 }}>{selected.promptZh}</Paragraph>

            {selected.context ? (
              <Text type="secondary">场景：{selected.context}</Text>
            ) : null}

            {/* T030：关键词提示（点按钮才显示，且如实记 usedHint） */}
            {showKeywords && selected.keywords.length > 0 ? (
              <Space size={4} wrap>
                <Text type="secondary">关键词：</Text>
                {selected.keywords.map((k) => (
                  <Tag key={k}>{k}</Tag>
                ))}
              </Space>
            ) : null}

            {/* T030：参考答案默认隐藏；点「显示参考答案」才显示（如实记 revealedAnswer） */}
            {!answered && showReference ? (
              <Alert
                type="info"
                showIcon
                message="参考答案（提交时将记录你查看过答案）"
                description={selected.referenceAnswer}
                style={{ marginBottom: 0 }}
              />
            ) : null}

            {!answered ? (
              <>
                <Input.TextArea
                  rows={4}
                  placeholder="Enter your answer in English…"
                  value={session.answer}
                  onChange={(e) => {
                    setInputError(null);
                    setSession((s) => ({ ...s, answer: e.target.value }));
                  }}
                  disabled={submitting}
                />
                {inputError ? (
                  <Alert type="error" message={inputError} style={{ marginBottom: 0 }} />
                ) : null}
                <Space>
                  <Button type="primary" disabled={!canSubmit} loading={submitting} onClick={submit}>
                    提交
                  </Button>
                  <Button disabled={submitting} onClick={skip}>
                    跳过
                  </Button>
                  {selected.keywords.length > 0 ? (
                    <Button
                      type="link"
                      disabled={submitting || session.usedHint}
                      onClick={() => {
                        setShowKeywords(true);
                        setSession((s) => ({ ...s, usedHint: true }));
                      }}
                    >
                      使用提示
                    </Button>
                  ) : null}
                  <Button
                    type="link"
                    disabled={submitting || session.revealed}
                    onClick={() => {
                      setShowReference(true);
                      setSession((s) => ({ ...s, revealed: true }));
                    }}
                  >
                    显示参考答案
                  </Button>
                </Space>
              </>
            ) : (
              <>
                {ev ? (
                  <Alert
                    type={ev.coreMeaningCorrect ? 'success' : 'error'}
                    showIcon
                    message={
                      <Space size={6} wrap>
                        <span>核心意思 {ev.coreMeaningCorrect ? '✓' : '✗'}</span>
                        <span>语法 {ev.grammarCorrect ? '✓' : '✗'}</span>
                        <span>语气 {ev.toneAppropriate ? '✓' : '✗'}</span>
                        <Text type="secondary">AI 分（辅助）：{ev.aiScore}</Text>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {ev.feedbackZh.map((f) => (
                          <span key={f}>{f}</span>
                        ))}
                      </Space>
                    }
                  />
                ) : null}

                <div>
                  <Text type="secondary">你的答案：{session.answer.trim()}</Text>
                  <br />
                  <Text type="secondary">参考答案：{selected.referenceAnswer}</Text>
                  <br />
                  <Text type="secondary">改进版：{ev?.improvedAnswer ?? selected.referenceAnswer}</Text>
                </div>

                <Space>
                  <Button type="primary" onClick={nextTask}>
                    下一题
                  </Button>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    提示已用：{session.usedHint ? '是' : '否'} · 参考已看：
                    {session.revealed ? '是' : '否'}（如实记录，T031 写入 review_attempt）
                  </Text>
                </Space>
              </>
            )}
          </Space>
        ) : (
          <Empty
            description={loadError ? '加载失败，见左侧' : '暂无今日任务'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Card>
    </div>
  );
}

export default TrainingPage;
