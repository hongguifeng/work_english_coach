// T026：表达库页面（真实数据：列表/新增/编辑/归档/删除全部经 IPC 读写 SQLite）。
// 搜索与筛选在页面侧完成（IPC 只返回全量，本地数据量小，docs/08 T026）。
// 空库提示：先去做一次 AI 纠错并勾选保存，或手动添加。
// 数据变更订阅：data:changed 语义为「清空全部数据」（设置页删除），此处重新拉取。
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { PageHeader } from '../components/PageHeader';
import { useDataChanged } from '../lib/useDataChanged';
import { SOURCE_TYPE_OPTIONS } from '../../../shared/constants/scenes';
import type { Result } from '../../../shared/types/app';
import { MASTERY_STATUS_LABELS } from '../../../shared/types/library';
import type {
  ExpressionRecord,
  ExpressionStatus,
  MasteryStatus,
} from '../../../shared/types/library';
import ExpressionFormModal, {
  type ExpressionFormValues,
} from './library/ExpressionFormModal';
import ExpressionDetailModal from './library/ExpressionDetailModal';

type ListState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; items: ExpressionRecord[] };

type MasteryFilter = MasteryStatus | 'all';
type SceneFilter = (typeof SOURCE_TYPE_OPTIONS)[number]['value'] | 'all';

const SCENE_LABELS = new Map<string, string>(SOURCE_TYPE_OPTIONS.map((o) => [o.value, o.label]));

export default function LibraryPage(): React.ReactElement {
  const { message } = App.useApp();
  const [list, setList] = useState<ListState>({ phase: 'loading' });
  const [search, setSearch] = useState('');
  const [mastery, setMastery] = useState<MasteryFilter>('all');
  const [scene, setScene] = useState<SceneFilter>('all');
  const [status, setStatus] = useState<ExpressionStatus>('active');

  // 弹窗状态
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpressionRecord | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [detail, setDetail] = useState<ExpressionRecord | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailDeleting, setDetailDeleting] = useState(false);

  const loadList = useCallback(async () => {
    setList({ phase: 'loading' });
    const r: Result<ExpressionRecord[]> =
      await window.desktopAPI.expressionList();
    if (!r.ok) {
      setList({ phase: 'error', message: r.error.message });
      return;
    }
    setList({ phase: 'ready', items: r.data });
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // 「清空全部数据」事件后重新拉取（列表会空）。
  useDataChanged(() => {
    void loadList();
  });

  const rows = useMemo(() => {
    if (list.phase !== 'ready') return [];
    const q = search.trim().toLowerCase();
    return list.items.filter((it) => {
      if (it.status !== status) return false;
      if (mastery !== 'all' && it.masteryStatus !== mastery) return false;
      if (scene !== 'all' && it.scenario !== scene) return false;
      if (!q) return true;
      return [it.title, it.chineseMeaning, it.pattern ?? '', it.example ?? '', it.notes ?? '']
        .join('\n')
        .toLowerCase()
        .includes(q);
    });
  }, [list, search, mastery, scene, status]);

  // ---- 新增 / 编辑（共用表单弹窗）-----------------------------------------
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (record: ExpressionRecord) => {
    setEditing(record);
    setFormOpen(true);
  };

  // 可选字段：表单空串 → null（schema 的 min(1) 拒绝空串；null = 显式清空该字段）。
  const cleanOptional = (s?: string | null): string | null =>
    typeof s === 'string' && s.trim() !== '' ? s : null;

  const handleFormSubmit = async (values: ExpressionFormValues) => {
    setFormSubmitting(true);
    const payload = {
      title: values.title,
      chineseMeaning: values.chineseMeaning,
      pattern: cleanOptional(values.pattern),
      example: cleanOptional(values.example),
      scenario: cleanOptional(values.scenario),
      notes: cleanOptional(values.notes),
      masteryStatus: values.masteryStatus,
    };
    const r = editing
      ? await window.desktopAPI.expressionUpdate(editing.id, payload)
      : await window.desktopAPI.expressionCreate(payload);
    setFormSubmitting(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    message.success(editing ? '已保存修改' : '已新增表达');
    setFormOpen(false);
    setEditing(null);
    void loadList();
  };

  // ---- 详情弹窗操作：掌握状态 / 归档 / 删除 -------------------------------
  const handleDetailMastery = async (m: MasteryStatus) => {
    if (!detail) return;
    setDetailBusy(true);
    const r = await window.desktopAPI.expressionUpdate(detail.id, {
      masteryStatus: m,
    });
    setDetailBusy(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    setDetail(r.data);
    message.success('掌握状态已更新');
    void loadList();
  };

  const handleDetailToggleStatus = async (s: ExpressionStatus) => {
    if (!detail) return;
    setDetailBusy(true);
    const r = await window.desktopAPI.expressionSetStatus(detail.id, s);
    setDetailBusy(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    setDetail(r.data);
    message.success(s === 'archived' ? '已归档' : '已恢复');
    void loadList();
  };

  const handleDetailDelete = async () => {
    if (!detail) return;
    setDetailDeleting(true);
    const r = await window.desktopAPI.expressionDelete(detail.id);
    setDetailDeleting(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    message.success('已删除（不可恢复）');
    setDetail(null);
    void loadList();
  };

  // ---- 表格内快速操作：归档 / 删除 ----------------------------------------
  const handleQuickArchive = async (record: ExpressionRecord) => {
    const r = await window.desktopAPI.expressionSetStatus(
      record.id,
      record.status === 'active' ? 'archived' : 'active',
    );
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    message.success(record.status === 'active' ? '已归档' : '已恢复');
    void loadList();
  };

  const handleQuickDelete = async (record: ExpressionRecord) => {
    const r = await window.desktopAPI.expressionDelete(record.id);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    message.success('已删除（不可恢复）');
    void loadList();
  };

  const isArchivedView = status === 'archived';

  return (
    <div>
      <PageHeader
        extra={
          <Space>
            <Segmented
              value={status}
              onChange={(v) => setStatus(v as ExpressionStatus)}
              options={[
                { value: 'active', label: '使用中' },
                { value: 'archived', label: '归档' },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void loadList()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增表达
            </Button>
          </Space>
        }
      />

      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="搜索标题 / 释义 / 例句 / 备注"
          allowClear
          style={{ width: 320 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={mastery}
          onChange={setMastery}
          style={{ width: 150 }}
          options={[
            { value: 'all', label: '全部掌握状态' },
            { value: 'new', label: MASTERY_STATUS_LABELS.new },
            { value: 'learning', label: MASTERY_STATUS_LABELS.learning },
            { value: 'familiar', label: MASTERY_STATUS_LABELS.familiar },
          ]}
        />
        <Select
          value={scene}
          onChange={setScene}
          style={{ width: 150 }}
          options={[
            { value: 'all', label: '全部场景' },
            ...SOURCE_TYPE_OPTIONS.map((o) => ({
              value: o.value as SceneFilter,
              label: o.label,
            })),
          ]}
        />
      </Space>

      {list.phase === 'loading' && (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin />
        </div>
      )}

      {list.phase === 'error' && (
        <Empty
          description={
            <span>
              加载失败：{list.message}
            </span>
          }
        >
          <Button type="primary" onClick={() => void loadList()}>
            重试
          </Button>
        </Empty>
      )}

      {list.phase === 'ready' && (
        <Table<ExpressionRecord>
          rowKey="id"
          dataSource={rows}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{
            emptyText: isArchivedView ? (
              '归档区是空的'
            ) : rows.length === 0 && search.trim() ? (
              '没有匹配的表达'
            ) : (
              <span>
                还没有表达。可以做一次{' '}
                <a href="#/workspace">AI 纠错</a>
                并勾选「保存到表达库」，或者点击「新增表达」手动添加。
              </span>
            ),
          }}
          columns={[
            {
              title: '标题',
              dataIndex: 'title',
              key: 'title',
              width: 220,
              ellipsis: true,
              render: (t: string, r) => (
                <a onClick={() => setDetail(r)}>{t}</a>
              ),
            },
            {
              title: '中文释义',
              dataIndex: 'chineseMeaning',
              key: 'chineseMeaning',
              ellipsis: true,
            },
            {
              title: '场景',
              dataIndex: 'scenario',
              key: 'scenario',
              width: 100,
              render: (v: string | null) =>
                v ? <Tag>{SCENE_LABELS.get(v) ?? v}</Tag> : <span style={{ color: 'rgba(0,0,0,0.25)' }}>—</span>,
            },
            {
              title: '掌握状态',
              dataIndex: 'masteryStatus',
              key: 'masteryStatus',
              width: 110,
              render: (v: MasteryStatus) => (
                <Tag
                  color={
                    v === 'familiar'
                      ? 'green'
                      : v === 'learning'
                        ? 'blue'
                        : 'default'
                  }
                >
                  {MASTERY_STATUS_LABELS[v]}
                </Tag>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 190,
              render: (_: unknown, r) => (
                <Space>
                  <a onClick={() => openEdit(r)}>编辑</a>
                  <a onClick={() => void handleQuickArchive(r)}>
                    {r.status === 'active' ? '归档' : '恢复'}
                  </a>
                  <Popconfirm
                    title="永久删除这条表达？不可恢复。"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() => void handleQuickDelete(r)}
                  >
                    <a style={{ color: '#ff4d4f' }}>删除</a>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}

      <ExpressionFormModal
        open={formOpen}
        initial={editing}
        submitting={formSubmitting}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={(v) => void handleFormSubmit(v)}
      />

      <ExpressionDetailModal
        open={detail !== null}
        record={detail}
        busy={detailBusy}
        deleting={detailDeleting}
        onClose={() => setDetail(null)}
        onChangeMastery={(m) => void handleDetailMastery(m)}
        onToggleStatus={(s) => void handleDetailToggleStatus(s)}
        onDelete={() => void handleDetailDelete()}
      />
    </div>
  );
}
