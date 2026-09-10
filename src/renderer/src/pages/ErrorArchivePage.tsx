// T027：错误档案页面（真实数据：按 skillKey 聚合 detected_issues，经 IPC 读 SQLite）。
// - 区分「真正错误」（severity=error）与「表达建议」（其余 severity）：筛选 + 标签
// - 显示出现次数 / 最近出现 / 最近练习 / 掌握状态（由独立练习历史推导，AI 修改不算掌握）
// - 「查看示例」抽屉展示最近至多 3 条原始错误
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useDataChanged } from '../lib/useDataChanged';
import {
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  SEVERITY_LABELS,
  SEVERITY_TAG_COLORS,
} from '../../../shared/constants/issues';
import { MASTERY_STATUS_LABELS } from '../../../shared/types/library';
import type {
  ErrorArchiveEntry,
  ErrorArchiveExample,
  ErrorArchiveFilter,
} from '../../../shared/types/errorArchive';
import type { ReviewTaskGeneratedView } from '../../../shared/types/review';
import type { Result } from '../../../shared/types/app';

type SeverityFilter = 'all' | 'error' | 'suggestion';

const MASTERY_TAG: Record<ErrorArchiveEntry['masteryStatus'], { color: string; label: string }> = {
  new: { color: 'default', label: MASTERY_STATUS_LABELS.new },
  learning: { color: 'gold', label: MASTERY_STATUS_LABELS.learning },
  familiar: { color: 'green', label: MASTERY_STATUS_LABELS.familiar },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function ExampleList({ examples }: { examples: ErrorArchiveExample[] }) {
  if (examples.length === 0) return <Empty description="暂无示例" />;
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {examples.map((ex, i) => (
        <Descriptions
          key={i}
          size="small"
          bordered
          column={1}
        >
          <Descriptions.Item label="类型">
            <Tag color={SEVERITY_TAG_COLORS[ex.severity]}>{SEVERITY_LABELS[ex.severity]}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="原文">
            <Typography.Text delete type="danger">
              {ex.originalText}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="修改">
            <Typography.Text strong>{ex.correctedText}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="解释">
            {ex.explanationZh}
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              {formatDateTime(ex.createdAt)}
            </Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      ))}
    </Space>
  );
}

export default function ErrorArchivePage() {
  const { message } = App.useApp();
  const [entries, setEntries] = useState<ErrorArchiveEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [openEntry, setOpenEntry] = useState<ErrorArchiveEntry | null>(null);
  const [generating, setGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<ReviewTaskGeneratedView | null>(null);

  const filter: ErrorArchiveFilter = useMemo(
    () => ({
      category: category as ErrorArchiveFilter['category'],
      severity: severity === 'all' ? undefined : severity,
    }),
    [category, severity],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const r: Result<ErrorArchiveEntry[]> =
      await window.desktopAPI.errorArchiveList(filter);
    if (r.ok) {
      setEntries(r.data);
    } else {
      message.error('加载错误档案失败：' + r.error.message);
      setEntries([]);
    }
    setLoading(false);
  }, [filter, message]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(() => void load());

  const generateReview = useCallback(
    async (entry: ErrorArchiveEntry) => {
      setGenerating(true);
      setLastGenerated(null);
      const r: Result<ReviewTaskGeneratedView> = await window.desktopAPI.reviewGenerateTask({
        source: 'skill',
        id: entry.skillKey,
      });
      setGenerating(false);
      if (!r.ok) {
        message.error('生成复习任务失败：' + r.error.message);
        return;
      }
      setLastGenerated(r.data);
      if (r.data.created) {
        message.success('已生成新的复习任务（明天开始复习）');
      } else {
        message.info('该知识点已有待复习任务，未重复生成');
      }
    },
    [message],
  );

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="错误类别"
          style={{ width: 160 }}
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(v) => setCategory(v)}
        />
        <Segmented
          options={[
            { label: '全部', value: 'all' },
            { label: '错误', value: 'error' },
            { label: '表达建议', value: 'suggestion' },
          ]}
          value={severity}
          onChange={(v) => setSeverity(v as SeverityFilter)}
        />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>

      {loading ? (
        <Spin />
      ) : !entries || entries.length === 0 ? (
        <Empty description="暂无错误档案。完成一次 AI 纠错并保存后，这里会按知识点聚合展示。" />
      ) : (
        <Table<ErrorArchiveEntry>
          rowKey="skillKey"
          size="small"
          pagination={false}
          dataSource={entries}
          columns={[
            {
              title: '知识点',
              dataIndex: 'title',
              render: (_, r) => (
                <span>
                  {r.title}
                  <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                    {r.skillKey}
                  </Typography.Text>
                </span>
              ),
            },
            {
              title: '类别',
              dataIndex: 'category',
              width: 90,
              render: (c: ErrorArchiveEntry['category']) => <Tag>{CATEGORY_LABELS[c]}</Tag>,
            },
            {
              title: '出现次数',
              dataIndex: 'count',
              width: 140,
              render: (_, r) => (
                <Space size={4}>
                  <span>{r.count} 次</span>
                  {r.errorCount > 0 && <Tag color="red">{SEVERITY_LABELS.error} {r.errorCount}</Tag>}
                  {r.suggestionCount > 0 && (
                    <Tag color="blue">{SEVERITY_LABELS.suggestion} {r.suggestionCount}</Tag>
                  )}
                </Space>
              ),
            },
            {
              title: '最近出现',
              dataIndex: 'lastSeenAt',
              width: 160,
              render: (v: string) => formatDateTime(v),
            },
            {
              title: '最近练习',
              dataIndex: 'lastPracticeAt',
              width: 170,
              render: (_, r) =>
                r.lastPracticeAt === null ? (
                  <Typography.Text type="secondary">未练习</Typography.Text>
                ) : (
                  <span>
                    {formatDateTime(r.lastPracticeAt)}
                    {r.lastPracticeCorrect === true && (
                      <Tag color="green" style={{ marginLeft: 6 }}>
                        独立答对
                      </Tag>
                    )}
                    {r.lastPracticeCorrect === false && (
                      <Tag color="orange" style={{ marginLeft: 6 }}>
                        未独立掌握
                      </Tag>
                    )}
                  </span>
                ),
            },
            {
              title: '掌握状态',
              dataIndex: 'masteryStatus',
              width: 100,
              render: (m: ErrorArchiveEntry['masteryStatus']) => (
                <Tag color={MASTERY_TAG[m].color}>{MASTERY_TAG[m].label}</Tag>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 100,
              render: (_, r) => (
                <Button size="small" type="link" onClick={() => setOpenEntry(r)}>
                  查看示例
                </Button>
              ),
            },
          ]}
        />
      )}

      <Drawer
        title={openEntry ? `${openEntry.title}（${openEntry.skillKey}）` : '示例'}
        width={560}
        open={openEntry !== null}
        onClose={() => {
          setOpenEntry(null);
          setLastGenerated(null);
        }}
        extra={
          openEntry && (
            <Button
              type="primary"
              loading={generating}
              onClick={() => void generateReview(openEntry)}
            >
              生成复习任务
            </Button>
          )
        }
      >
        {openEntry && (
          <>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              {openEntry.explanationZh}
            </Typography.Paragraph>
            <ExampleList examples={openEntry.examples} />
            {lastGenerated && (
              <Descriptions size="small" bordered column={1} style={{ marginTop: 12 }}>
                <Descriptions.Item label="练习指令">
                  {lastGenerated.task.promptZh}
                </Descriptions.Item>
                <Descriptions.Item label="场景">
                  {lastGenerated.task.context || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="参考答案">
                  {lastGenerated.task.referenceAnswer}
                </Descriptions.Item>
                <Descriptions.Item label="计划复习">
                  {formatDateTime(lastGenerated.task.scheduledAt)}
                </Descriptions.Item>
              </Descriptions>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
