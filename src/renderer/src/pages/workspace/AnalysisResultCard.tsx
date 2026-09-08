import { Alert, Button, Card, Divider, Empty, Space, Spin, Tag, Typography } from 'antd';
import type {
  AnalysisIssue,
  AnalyzeDraftResult,
  IssueCategory,
  IssueSeverity,
} from '../../../../shared/types/ai';

const SEVERITY_META: Record<
  IssueSeverity,
  { color: string; label: string }
> = {
  error: { color: 'red', label: '错误' },
  suggestion: { color: 'blue', label: '表达建议' },
  tone_risk: { color: 'orange', label: '语气风险' },
  unclear: { color: 'gold', label: '意思不明确' },
};

const CATEGORY_LABEL: Record<IssueCategory, string> = {
  grammar: '语法',
  vocabulary: '词汇',
  collocation: '搭配',
  preposition: '介词',
  article: '冠词',
  tense: '时态',
  plural: '单复数',
  sentence_structure: '句式',
  tone: '语气',
  clarity: '清晰度',
  other: '其他',
};

function IssueRow({ issue }: { issue: AnalysisIssue }) {
  const severity = SEVERITY_META[issue.severity];
  return (
    <div className="wec-issue-row">
      <Space size={6} wrap>
        <Tag color={severity.color}>{severity.label}</Tag>
        <Tag>{CATEGORY_LABEL[issue.category]}</Tag>
      </Space>
      <div className="wec-issue-texts">
        <span className="wec-issue-original">{issue.originalText}</span>
        <span className="wec-issue-arrow">→</span>
        <span className="wec-issue-corrected">{issue.correctedText}</span>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {issue.explanationZh}
      </Typography.Text>
    </div>
  );
}

interface AnalysisResultCardProps {
  loading: boolean;
  result: AnalyzeDraftResult | null;
  onConfirm: () => void;
  confirmHint?: string;
}

/**
 * 工作区结果区：最小修改版 + 自然表达版 + 问题列表 + 学习点/练习预览（T008）
 */
export function AnalysisResultCard({
  loading,
  result,
  onConfirm,
  confirmHint,
}: AnalysisResultCardProps) {
  if (loading) {
    return (
      <Card>
        <div className="wec-loading-block">
          <Spin />
          <Typography.Text type="secondary">
            正在分析你的英文草稿（mock，约 1 秒）
          </Typography.Text>
        </div>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card>
        <Empty description="填写左侧表单并点击「检查」，这里会显示修改结果" />
      </Card>
    );
  }

  return (
    <Card
      title="检查结果（mock 数据）"
      extra={
        <Button
          type="primary"
          onClick={onConfirm}
          title={confirmHint}
        >
          保存并生成复习
        </Button>
      }
    >
      {result.shouldClarify ? (
        <Alert
          type="warning"
          showIcon
          className="wec-clarify-alert"
          message="AI 不确定你想表达的意思，请先确认"
          description={
            <ul className="wec-clarify-list">
              {result.clarificationQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <div className="wec-version-block">
        <Tag>最小修改版</Tag>
        <Typography.Paragraph className="wec-version-text">
          {result.minimalRevision}
        </Typography.Paragraph>
      </div>

      <div className="wec-version-block">
        <Tag color="green">自然表达版</Tag>
        <Typography.Paragraph className="wec-version-text">
          {result.naturalRevision}
        </Typography.Paragraph>
      </div>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        AI 的修改仅供参考，不能直接算作用户掌握；确认后才会生成复习任务。
      </Typography.Text>

      <Divider style={{ margin: '12px 0' }} />

      <Typography.Text strong>问题列表（{result.issues.length}）</Typography.Text>
      {result.issues.length === 0 ? (
        <Typography.Text type="secondary">
          没有发现明显问题，草稿整体可用。
        </Typography.Text>
      ) : (
        <div className="wec-issue-list">
          {result.issues.map((issue) => (
            <IssueRow key={issue.skillKey + issue.originalText} issue={issue} />
          ))}
        </div>
      )}

      <Divider style={{ margin: '12px 0' }} />

      <div className="wec-lp-block">
        <Tag color="purple">本次学习点</Tag>
        <Typography.Text strong>{result.keyLearningPoint.title}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {result.keyLearningPoint.explanationZh}
        </Typography.Text>
      </div>

      <div className="wec-lp-block">
        <Tag color="purple">迁移练习预览</Tag>
        <Typography.Text>{result.practice.instructionZh}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          场景：{result.practice.context}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          点击「保存并生成复习」后，该练习将进入今日训练（参考答案届时隐藏，需独立输出）。
        </Typography.Text>
      </div>
    </Card>
  );
}
