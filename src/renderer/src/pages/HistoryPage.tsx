import { useEffect, useState } from 'react';
import {
  Alert,
  Card,
  Descriptions,
  Empty,
  List,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { Link } from 'react-router-dom';
import { BoldText } from '../components/BoldText';
import { CATEGORY_LABELS, SEVERITY_LABELS, SEVERITY_TAG_COLORS } from '../../../shared/constants/issues';
import { stripBoldMarks } from '../../../shared/utils/bold';
import type { HistoryRecord, HistoryRecordSummary } from '../../../shared/types/history';
import type { Audience, SourceType, Tone } from '../../../shared/types/ai';

const SOURCE_LABELS: Record<SourceType, string> = {
  email: '邮件',
  instant_message: '即时消息',
  meeting: '会议',
  report: '报告',
};

const AUDIENCE_LABELS: Record<Audience, string> = {
  colleague: '同事',
  manager: '经理',
  client: '客户',
  supplier: '供应商',
  other: '其他',
};

const TONE_LABELS: Record<Tone, string> = {
  neutral: '中性',
  formal: '正式',
  friendly: '友好',
  firm: '坚定',
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false });
}

function recordTitle(record: HistoryRecordSummary): string {
  return record.originalEnglish?.trim() || record.naturalRevision || '未保存原文的检查记录';
}

function HistoryDetail({ record }: { record: HistoryRecord }): JSX.Element {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="检查信息">
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label="场景">{SOURCE_LABELS[record.sourceType]}</Descriptions.Item>
          <Descriptions.Item label="对象">{AUDIENCE_LABELS[record.audience]}</Descriptions.Item>
          <Descriptions.Item label="语气">{TONE_LABELS[record.tone]}</Descriptions.Item>
          <Descriptions.Item label="检查时间">{formatDateTime(record.createdAt)}</Descriptions.Item>
        </Descriptions>
      </Card>

      {record.originalChinese || record.originalEnglish ? (
        <Card title="检查输入">
          <Descriptions column={1} size="small">
            {record.originalChinese ? <Descriptions.Item label="中文原意">{record.originalChinese}</Descriptions.Item> : null}
            {record.originalEnglish ? <Descriptions.Item label="英文草稿">{record.originalEnglish}</Descriptions.Item> : null}
          </Descriptions>
        </Card>
      ) : null}

      <Card title="AI 修改结果">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="最小修改版">
            <Typography.Paragraph copyable={{ text: stripBoldMarks(record.minimalRevision) }} style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              <BoldText text={record.minimalRevision} />
            </Typography.Paragraph>
          </Descriptions.Item>
          <Descriptions.Item label="自然表达版">
            <Typography.Paragraph copyable={{ text: record.naturalRevision }} style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              {record.naturalRevision}
            </Typography.Paragraph>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {record.clarificationQuestions.length > 0 ? (
        <Card title="需要确认的问题">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {record.clarificationQuestions.map((question) => <li key={question}>{question}</li>)}
          </ul>
        </Card>
      ) : null}

      <Card title={`问题与解释（${record.issues.length}）`}>
        {record.issues.length === 0 ? (
          <Empty description="没有检出明显问题" />
        ) : (
          <List
            dataSource={record.issues}
            renderItem={(issue) => (
              <List.Item>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag color={SEVERITY_TAG_COLORS[issue.severity]}>{SEVERITY_LABELS[issue.severity]}</Tag>
                    <Tag>{CATEGORY_LABELS[issue.category]}</Tag>
                    <Typography.Text delete type="danger">{issue.originalText}</Typography.Text>
                    <span>→</span>
                    <Typography.Text type="success">{issue.correctedText}</Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ color: 'rgba(0, 0, 0, 0.65)' }}>
                    {issue.explanationZh}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Card>

      {record.keyLearningPoint ? (
        <Card title="今日重点">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text strong>{record.keyLearningPoint.title}</Typography.Text>
            <Typography.Text>{record.keyLearningPoint.explanationZh}</Typography.Text>
          </Space>
        </Card>
      ) : null}

      {record.practice ? (
        <Card title="训练提示">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text>{record.practice.instructionZh}</Typography.Text>
            <Typography.Text type="secondary">
              场景：{record.practice.context}
              {record.practice.keywords.length > 0 ? ` · 关键词：${record.practice.keywords.join('、')}` : ''}
            </Typography.Text>
          </Space>
        </Card>
      ) : null}
    </Space>
  );
}

export default function HistoryPage(): JSX.Element {
  const [records, setRecords] = useState<HistoryRecordSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.desktopAPI.historyList().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.error.message);
        setLoading(false);
        return;
      }
      setRecords(result.data);
      setSelectedId(result.data[0]?.id ?? null);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    void window.desktopAPI.historyGet(selectedId).then((result) => {
      if (!active) return;
      setDetailLoading(false);
      if (!result.ok) setError(result.error.message);
      else setDetail(result.data);
    });
    return () => { active = false; };
  }, [selectedId]);

  return (
    <div>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      {loading ? <Card><Spin /></Card> : records.length === 0 ? (
        <Card><Empty description={<span>还没有检查记录，先去<Link to="/">工作区</Link>检查一段英文。</span>} /></Card>
      ) : (
        <div className="wec-history-layout">
          <Card className="wec-history-list" bodyStyle={{ padding: 0 }}>
            <List
              dataSource={records}
              renderItem={(record) => (
                <List.Item
                  className={record.id === selectedId ? 'wec-history-list-item-selected' : 'wec-history-list-item'}
                  onClick={() => setSelectedId(record.id)}
                >
                  <List.Item.Meta
                    title={recordTitle(record)}
                    description={(
                      <Space size={6} wrap>
                        <span>{SOURCE_LABELS[record.sourceType]}</span>
                        <span>{formatDateTime(record.createdAt)}</span>
                        <Tag>{record.issueCount} 个问题</Tag>
                      </Space>
                    )}
                  />
                </List.Item>
              )}
            />
          </Card>
          <div className="wec-history-detail">
            {detailLoading ? <Card><Spin /></Card> : detail ? <HistoryDetail record={detail} /> : <Card><Empty description="请选择一条历史记录" /></Card>}
          </div>
        </div>
      )}
    </div>
  );
}