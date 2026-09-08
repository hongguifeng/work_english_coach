// T010：表达库页面（mock 数据）。T026 起列表/操作替换为 IPC + SQLite，组件结构不变。
import { useMemo, useState } from 'react';
import {
  Button,
  Empty,
  Input,
  Popconfirm,
  Select,
  Tag,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { PageHeader } from '../components/PageHeader';
import {
  AUDIENCE_OPTIONS,
  SOURCE_TYPE_OPTIONS,
} from '../../../shared/constants/scenes';
import type {
  ExpressionRecord,
  ExpressionStatus,
  MasteryLevel,
} from '../../../shared/types/library';
import type { SourceType } from '../../../shared/types/ai';
import { useExpressionStore } from './library/ExpressionStore';
import { ExpressionDetailModal } from './library/ExpressionDetailModal';
import { ExpressionFormModal } from './library/ExpressionFormModal';

type SceneFilter = 'all' | SourceType;
type MasteryFilter = 'all' | MasteryLevel;

const SCENE_FILTER_OPTIONS = [
  { value: 'all' as const, label: '全部场景' },
  ...SOURCE_TYPE_OPTIONS,
];

const MASTERY_FILTER_OPTIONS: { value: MasteryFilter; label: string }[] = [
  { value: 'all', label: '全部掌握状态' },
  { value: 'needs_review', label: '待复习' },
  { value: 'mastered', label: '已掌握' },
];

const STATUS_FILTER_OPTIONS: { value: ExpressionStatus; label: string }[] = [
  { value: 'active', label: '使用中' },
  { value: 'archived', label: '已归档' },
];

function labelOf<T extends string>(
  options: { value: T; label: string }[],
  value: T,
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export default function LibraryPage() {
  const items = useExpressionStore((s) => s.items);
  const archive = useExpressionStore((s) => s.archive);
  const restore = useExpressionStore((s) => s.restore);

  const [search, setSearch] = useState('');
  const [scene, setScene] = useState<SceneFilter>('all');
  const [mastery, setMastery] = useState<MasteryFilter>('all');
  const [status, setStatus] = useState<ExpressionStatus>('active');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpressionRecord | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      if (item.status !== status) return false;
      if (scene !== 'all' && item.scene !== scene) return false;
      if (mastery !== 'all' && item.masteryLevel !== mastery) return false;
      if (keyword) {
        const haystack =
          `${item.originalExpression} ${item.correctedExpression} ${item.aiSummary ?? ''}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }, [items, search, scene, mastery, status]);

  const detailRecord =
    detailId === null
      ? null
      : (items.find((i) => i.id === detailId) ?? null);

  return (
    <div>
      <PageHeader
        title="表达库"
        description="积累工作场景中可直接复用的推荐表达（mock 数据，T026 接入数据库）"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            新增表达
          </Button>
        }
      />

      <div className="wec-library-toolbar">
        <Input
          allowClear
          className="wec-library-search"
          prefix={<SearchOutlined />}
          placeholder="搜索原始表达、推荐表达或说明"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={scene}
          options={SCENE_FILTER_OPTIONS}
          onChange={(v) => setScene(v)}
          style={{ width: 150 }}
        />
        <Select
          value={mastery}
          options={MASTERY_FILTER_OPTIONS}
          onChange={(v) => setMastery(v)}
          style={{ width: 140 }}
        />
        <Select
          value={status}
          options={STATUS_FILTER_OPTIONS}
          onChange={(v) => setStatus(v)}
          style={{ width: 110 }}
        />
      </div>

      {filtered.length === 0 ? (
        <Empty
          className="wec-library-empty"
          description={
            status === 'archived'
              ? '没有已归档的表达'
              : '没有匹配的表达，试试调整搜索或筛选，或新增一条'
          }
        />
      ) : (
        <div className="wec-library-grid">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="wec-lib-card"
              onClick={() => setDetailId(item.id)}
            >
              <div className="wec-lib-card-tags">
                <Tag color="blue">{labelOf(SOURCE_TYPE_OPTIONS, item.scene)}</Tag>
                <Tag>{labelOf(AUDIENCE_OPTIONS, item.audience)}</Tag>
                {item.masteryLevel === 'mastered' ? (
                  <Tag color="green">已掌握</Tag>
                ) : (
                  <Tag color="orange">待复习</Tag>
                )}
                {item.status === 'archived' ? <Tag>已归档</Tag> : null}
              </div>
              <div className="wec-lib-card-corrected">
                {item.correctedExpression}
              </div>
              <div className="wec-lib-card-original">
                原：{item.originalExpression}
              </div>
              <div className="wec-lib-card-footer">
                <span className="wec-lib-card-meta">
                  练习 {item.timesPracticed} 次
                </span>
                <span className="wec-lib-card-actions">
                  <a onClick={(e) => { e.stopPropagation(); setDetailId(item.id); }}>
                    详情
                  </a>
                  <a
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(item);
                      setFormOpen(true);
                    }}
                  >
                    编辑
                  </a>
                  <Popconfirm
                    title={
                      item.status === 'archived'
                        ? '恢复这条表达？'
                        : '归档这条表达？'
                    }
                    description="归档后不再默认显示，也不会用于生成复习任务。"
                    okText={item.status === 'archived' ? '恢复' : '归档'}
                    cancelText="取消"
                    onConfirm={() => {
                      if (item.status === 'archived') restore(item.id);
                      else archive(item.id);
                    }}
                  >
                    <a
                      className="wec-lib-archive"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {item.status === 'archived' ? '恢复' : '归档'}
                    </a>
                  </Popconfirm>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <ExpressionFormModal
        open={formOpen}
        initial={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
      <ExpressionDetailModal
        open={detailRecord !== null}
        record={detailRecord}
        onClose={() => setDetailId(null)}
        onEdit={(record) => {
          setDetailId(null);
          setEditing(record);
          setFormOpen(true);
        }}
      />
    </div>
  );
}
