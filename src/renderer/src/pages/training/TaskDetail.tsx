import { Alert, Button, Divider, Input, Space, Tag, Typography } from 'antd';
import type { ReviewEvaluation, ReviewTask } from '../../../../shared/types/review';
import { TASK_TYPE_LABEL } from './TaskList';

interface TaskDetailProps {
  task: ReviewTask;
  answer: string;
  usedHint: boolean;
  revealed: boolean;
  loading: boolean;
  evaluation: ReviewEvaluation | null;
  onAnswerChange: (value: string) => void;
  onUseHint: () => void;
  onReveal: () => void;
  onSubmit: () => void;
  onSkip: () => void;
}

/**
 * 任务详情：题干 + 场景 + 提示 + 参考答案 + 作答 + 提交（AI 评价结果在下方展示）
 */
export function TaskDetail({
  task,
  answer,
  usedHint,
  revealed,
  loading,
  evaluation,
  onAnswerChange,
  onUseHint,
  onReveal,
  onSubmit,
  onSkip,
}: TaskDetailProps) {
  const submitted = evaluation !== null;

  return (
    <div>
      <Space size={8} wrap>
        <Tag color="geekblue">{TASK_TYPE_LABEL[task.taskType]}</Tag>
        <Typography.Text type="secondary">{task.context}</Typography.Text>
      </Space>

      <Typography.Paragraph className="wec-task-prompt">
        <Typography.Text strong>题目：</Typography.Text>
        {task.promptZh}
      </Typography.Paragraph>

      {usedHint ? (
        <Alert
          type="info"
          showIcon
          message="提示（关键词）"
          description={
            <span>
              {task.keywords.map((k) => (
                <Tag key={k}>{k}</Tag>
              ))}
            </span>
          }
          className="wec-hint-alert"
        />
      ) : null}

      {revealed ? (
        <Alert
          type="warning"
          showIcon
          message="参考答案（查看后本题将安排在明天重做）"
          description={task.referenceAnswer}
          className="wec-hint-alert"
        />
      ) : null}

      <div className="wec-answer-block">
        <Input.TextArea
          rows={4}
          placeholder="先用英文写出你的答案（不要看参考答案）…"
          value={answer}
          disabled={submitted}
          onChange={(e) => onAnswerChange(e.target.value)}
          maxLength={5000}
        />
      </div>

      {submitted ? (
        <Alert
          type="success"
          showIcon
          message={`已提交。本次${usedHint ? '使用了提示' : '未使用提示'}${
            revealed ? '，查看了参考答案' : ''
          }`}
          className="wec-hint-alert"
        />
      ) : (
        <Space wrap>
          <Button
            type="primary"
            loading={loading}
            disabled={loading || answer.trim().length === 0}
            onClick={onSubmit}
          >
            {loading ? 'AI 评价中…' : '提交答案'}
          </Button>
          <Button disabled={usedHint || loading} onClick={onUseHint}>
            提示（关键词）
          </Button>
          <Button disabled={revealed || loading} onClick={onReveal}>
            参考答案
          </Button>
          <Button type="text" disabled={loading} onClick={onSkip}>
            跳过本题
          </Button>
        </Space>
      )}

      {evaluation ? (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <Space size={8} wrap>
            <Tag color={evaluation.coreMeaningCorrect ? 'green' : 'red'}>
              核心意思 {evaluation.coreMeaningCorrect ? '✓' : '✗'}
            </Tag>
            <Tag color={evaluation.grammarCorrect ? 'green' : 'red'}>
              语法 {evaluation.grammarCorrect ? '✓' : '✗'}
            </Tag>
            <Tag color={evaluation.toneAppropriate ? 'green' : 'red'}>
              职场语气 {evaluation.toneAppropriate ? '✓' : '✗'}
            </Tag>
            <Tag>AI 评分 {evaluation.aiScore}/100（辅助指标）</Tag>
          </Space>
          <div className="wec-feedback-list">
            {evaluation.feedbackZh.map((f) => (
              <Typography.Text key={f} style={{ fontSize: 13 }}>
                • {f}
              </Typography.Text>
            ))}
          </div>
          <div className="wec-version-block">
            <Tag color="green">改进版</Tag>
            <Typography.Paragraph className="wec-version-text">
              {evaluation.improvedAnswer}
            </Typography.Paragraph>
          </div>
        </>
      ) : null}
    </div>
  );
}
