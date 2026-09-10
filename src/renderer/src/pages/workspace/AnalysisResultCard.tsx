import { useEffect, useRef, useState } from 'react';
import { Card, Checkbox, Descriptions, Empty, Space, Tag, Button, Typography } from 'antd';
import type { AnalyzeDraftResult } from '../../../../shared/types/ai';
import { CATEGORY_LABELS } from '../../../../shared/constants/issues';
import { stripBoldMarks } from '../../../../shared/utils/bold';
import { BoldText } from '../../components/BoldText';

type SeverityColor = 'red' | 'orange' | 'purple' | 'blue';

const SEVERITY_COLOR: Record<AnalyzeDraftResult['issues'][number]['severity'], SeverityColor> = {
  error: 'red',
  suggestion: 'orange',
  tone_risk: 'purple',
  unclear: 'blue',
};

/**
 * T024：复制按钮（含成功/失败提示）。
 * 通过 typed IPC `clipboardWrite` 写入系统剪贴板（沙箱 renderer 不可靠 navigator.clipboard）。
 * 点击后按钮短暂变为「已复制」/「复制失败」，1.6s 后复位。
 */
function CopyButton({ text }: { text: string }): JSX.Element {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function handleCopy(): Promise<void> {
    if (!window.desktopAPI) {
      setState('fail');
      return;
    }
    const r = await window.desktopAPI.clipboardWrite(text);
    setState(r.ok ? 'ok' : 'fail');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1600);
  }

  return (
    <Button size="small" type={state === 'ok' ? 'primary' : 'default'} onClick={handleCopy}>
      {state === 'ok' ? '已复制' : state === 'fail' ? '复制失败' : '复制'}
    </Button>
  );
}

export interface AnalysisResultCardProps {
  result: AnalyzeDraftResult | null;
  loading: boolean;
  error: string | null;
  /** 当前结果是否已保存（确认按钮禁用并变「已保存」）（T025） */
  saved?: boolean;
  /** 保存中（确认按钮 loading）（T025） */
  saving?: boolean;
  /** 是否勾选「保存自然表达版到表达库」（默认开）（T025） */
  saveExpression?: boolean;
  onConfirm?: () => void;
  onToggleSaveExpression?: (checked: boolean) => void;
  onCancel?: () => void;
  onRetry?: () => void;
}

export function AnalysisResultCard({
  result,
  loading,
  error,
  saved = false,
  saving = false,
  saveExpression = true,
  onConfirm = () => {},
  onToggleSaveExpression = () => {},
  onCancel = () => {},
  onRetry = () => {},
}: AnalysisResultCardProps): JSX.Element {
  if (loading) {
    return (
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Typography.Text type="secondary">正在分析你的草稿…（约 20~60 秒）</Typography.Text>
          <Button onClick={onCancel}>取消</Button>
        </Space>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="danger">{error}</Typography.Text>
          <Space>
            <Button type="primary" onClick={onRetry}>
              重试
            </Button>
            <Button onClick={onCancel}>取消</Button>
          </Space>
        </Space>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card>
        <Empty description="还没有分析结果。填写左侧草稿并点击「检查」开始。" />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="wec-result-card" title="版本对比">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="最小修改版">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div className="wec-version-min">
                <BoldText text={result.minimalRevision} />
              </div>
              <CopyButton text={stripBoldMarks(result.minimalRevision)} />
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="自然表达版">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div className="wec-version-natural">{result.naturalRevision}</div>
              <CopyButton text={result.naturalRevision} />
            </Space>
          </Descriptions.Item>
          {result.clarificationQuestions.length > 0 && (
            <Descriptions.Item label="需要你确认">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {result.clarificationQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Card className="wec-result-card" title={`问题与解释（${result.issues.length}）`}>
        {result.issues.length === 0 ? (
          <Empty description="没有检出明显问题" />
        ) : (
          <ul className="wec-issue-list">
            {result.issues.map((issue, i) => (
              <li key={i} className="wec-issue-item">
                <Space wrap>
                  <Tag color={SEVERITY_COLOR[issue.severity]}>{CATEGORY_LABELS[issue.category]}</Tag>
                  {issue.severity !== 'error' && (
                    <Tag>{issue.severity === 'tone_risk' ? '语气风险' : issue.severity === 'unclear' ? '意思不清' : '建议'}</Tag>
                  )}
                  <Typography.Text code>{issue.originalText}</Typography.Text>
                  <span>→</span>
                  <Typography.Text code>{issue.correctedText}</Typography.Text>
                </Space>
                <Typography.Text
                  type="secondary"
                  style={{ display: 'block', marginTop: 4, color: 'rgba(0, 0, 0, 0.65)' }}
                >
                  {issue.explanationZh}
                </Typography.Text>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="wec-result-card" title="今日重点">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text strong>{result.keyLearningPoint.title}</Typography.Text>
          <Typography.Text>{result.keyLearningPoint.explanationZh}</Typography.Text>
        </Space>
      </Card>

      <Card className="wec-result-card" title="训练提示">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>{result.practice.instructionZh}</Typography.Text>
          <Typography.Text type="secondary">
            场景：{result.practice.context}
            {result.practice.keywords.length > 0 ? ` · 关键词：${result.practice.keywords.join('、')}` : ''}
          </Typography.Text>
        </Space>
      </Card>

      <Space wrap align="center">
        <Checkbox
          checked={saveExpression}
          disabled={saved || saving}
          onChange={(e) => onToggleSaveExpression(e.target.checked)}
        >
          把自然表达版保存到表达库
        </Checkbox>
        <Button type="primary" onClick={onConfirm} loading={saving} disabled={saved}>
          {saved ? '已保存' : '确认并保存'}
        </Button>
        <Button onClick={onRetry}>重试</Button>
        <Button onClick={onCancel}>取消</Button>
      </Space>
    </Space>
  );
}
