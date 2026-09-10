// T026：表达详情弹窗（真实数据：掌握状态修改 / 归档 / 删除由父页面经 IPC 执行）。
// 注：nextReviewAt 由 T027 复习循环维护，此版本只展示、不提供编辑入口。
import { Button, Modal, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { MASTERY_STATUS_LABELS } from '../../../../shared/types/library';
import type {
  ExpressionRecord,
  ExpressionStatus,
  MasteryStatus,
} from '../../../../shared/types/library';

export interface ExpressionDetailModalProps {
  open: boolean;
  record: ExpressionRecord | null;
  /** 掌握状态修改 / 归档 飞行中 */
  busy: boolean;
  /** 删除飞行中 */
  deleting: boolean;
  onClose: () => void;
  /** 修改掌握状态（父页面经 IPC 执行并刷新列表） */
  onChangeMastery: (status: MasteryStatus) => void;
  /** 归档 / 恢复 */
  onToggleStatus: (status: ExpressionStatus) => void;
  /** 永久删除（点击已带 Popconfirm 二次确认） */
  onDelete: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', padding: '6px 0', gap: 12 }}>
      <div style={{ width: 96, color: 'rgba(0,0,0,0.45)', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

export default function ExpressionDetailModal({
  open,
  record,
  busy,
  deleting,
  onClose,
  onChangeMastery,
  onToggleStatus,
  onDelete,
}: ExpressionDetailModalProps): React.ReactElement | null {
  if (!record) return null;

  return (
    <Modal
      open={open}
      title={record.title}
      onCancel={onClose}
      footer={
        <Space wrap>
          <Popconfirm
            title="永久删除这条表达？"
            description="删除后不可恢复。如果只是暂时不想看，建议用「归档」。"
            okText="确认删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={onDelete}
            disabled={deleting || busy}
          >
            <Button danger loading={deleting}>
              永久删除
            </Button>
          </Popconfirm>
          <Button
            loading={busy}
            onClick={() => onToggleStatus(record.status === 'active' ? 'archived' : 'active')}
          >
            {record.status === 'active' ? '归档' : '恢复'}
          </Button>
          <Button type="primary" onClick={onClose} disabled={busy || deleting}>
            关闭
          </Button>
        </Space>
      }
      width={560}
      destroyOnHidden
    >
      <div style={{ marginBottom: 12 }}>
        {record.status === 'archived' && (
          <Tag color="orange" style={{ marginRight: 8 }}>
            已归档
          </Tag>
        )}
        <Tag color="blue">{MASTERY_STATUS_LABELS[record.masteryStatus]}</Tag>
      </div>

      <Row label="中文释义">
        <Typography.Paragraph style={{ margin: 0 }}>{record.chineseMeaning || '—'}</Typography.Paragraph>
      </Row>
      {record.pattern && (
        <Row label="固定搭配">
          <Typography.Text>{record.pattern}</Typography.Text>
        </Row>
      )}
      {record.example && (
        <Row label="例句">
          <Typography.Paragraph style={{ margin: 0 }}>{record.example}</Typography.Paragraph>
        </Row>
      )}
      {record.scenario && (
        <Row label="场景">
          <Tag>{record.scenario}</Tag>
        </Row>
      )}
      {record.notes && (
        <Row label="备注">
          <Typography.Paragraph style={{ margin: 0 }}>{record.notes}</Typography.Paragraph>
        </Row>
      )}
      <Row label="掌握状态">
        <Select
          value={record.masteryStatus}
          disabled={record.status === 'archived' || busy}
          style={{ width: 200 }}
          onChange={(v: MasteryStatus) => onChangeMastery(v)}
          options={[
            { value: 'new', label: '新学（刚加入）' },
            { value: 'learning', label: '学习中' },
            { value: 'familiar', label: '已熟悉（可降频）' },
          ]}
        />
      </Row>
      <Row label="下次复习">
        {record.nextReviewAt ? (
          <Typography.Text>{dayjs(record.nextReviewAt).format('YYYY-MM-DD')}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">
            未安排（由复习循环自动维护）
          </Typography.Text>
        )}
      </Row>
      <Row label="创建时间">
        <Typography.Text type="secondary">
          {dayjs(record.createdAt).format('YYYY-MM-DD HH:mm')}
        </Typography.Text>
      </Row>
      {record.updatedAt && (
        <Row label="更新时间">
          <Typography.Text type="secondary">
            {dayjs(record.updatedAt).format('YYYY-MM-DD HH:mm')}
          </Typography.Text>
        </Row>
      )}
    </Modal>
  );
}
