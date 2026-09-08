// T010（mock）：表达详情弹窗（含编辑 / 归档 / 恢复入口）。T026 起操作替换为 IPC 调用。
import { App, Button, Descriptions, Modal, Popconfirm, Tag } from 'antd';
import {
  CATEGORY_LABELS,
} from '../../../../shared/constants/issues';
import {
  AUDIENCE_OPTIONS,
  SOURCE_TYPE_OPTIONS,
} from '../../../../shared/constants/scenes';
import type { ExpressionRecord } from '../../../../shared/types/library';
import { useExpressionStore } from './ExpressionStore';

export interface ExpressionDetailModalProps {
  open: boolean;
  record: ExpressionRecord | null;
  onClose: () => void;
  onEdit: (record: ExpressionRecord) => void;
}

function labelOf<T extends string>(
  options: { value: T; label: string }[],
  value: T | null | undefined,
): string {
  if (!value) return '—';
  return options.find((o) => o.value === value)?.label ?? value;
}

export function ExpressionDetailModal({
  open,
  record,
  onClose,
  onEdit,
}: ExpressionDetailModalProps) {
  const { message } = App.useApp();
  const archive = useExpressionStore((s) => s.archive);
  const restore = useExpressionStore((s) => s.restore);
  const archived = record?.status === 'archived';

  return (
    <Modal
      title="表达详情"
      open={open}
      onCancel={onClose}
      width={640}
      footer={
        record ? (
          <>
            <Popconfirm
              title={archived ? '恢复这条表达？' : '归档这条表达？'}
              description={
                archived
                  ? '恢复后它会重新出现在“使用中”列表。'
                  : '归档后它不会再默认显示，也不会再用于生成复习任务。'
              }
              okText={archived ? '恢复' : '归档'}
              cancelText="取消"
              onConfirm={() => {
                if (archived) {
                  restore(record.id);
                  message.success('已恢复');
                } else {
                  archive(record.id);
                  message.success('已归档');
                }
                onClose();
              }}
            >
              <Button danger={!archived}>
                {archived ? '恢复使用' : '归档'}
              </Button>
            </Popconfirm>
            <Button onClick={onClose}>关闭</Button>
            <Button type="primary" onClick={() => onEdit(record)}>
              编辑
            </Button>
          </>
        ) : null
      }
    >
      {record ? (
        <Descriptions column={1} size="small" labelStyle={{ width: 90 }}>
          <Descriptions.Item label="场景">
            <Tag color="blue">{labelOf(SOURCE_TYPE_OPTIONS, record.scene)}</Tag>
            <Tag>{labelOf(AUDIENCE_OPTIONS, record.audience)}</Tag>
            {record.errorCategory ? (
              <Tag color="orange">
                {CATEGORY_LABELS[record.errorCategory]}
              </Tag>
            ) : null}
          </Descriptions.Item>
          <Descriptions.Item label="原始表达">
            <span style={{ textDecoration: 'line-through', opacity: 0.75 }}>
              {record.originalExpression}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="推荐表达">
            <strong>{record.correctedExpression}</strong>
          </Descriptions.Item>
          <Descriptions.Item label="要点说明">
            {record.aiSummary ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="掌握状态">
            {record.masteryLevel === 'mastered' ? (
              <Tag color="green">已掌握</Tag>
            ) : (
              <Tag color="orange">待复习</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="练习情况">
            累计练习 {record.timesPracticed} 次
            {record.lastPracticedAt ?
              `，最近一次 ${record.lastPracticedAt}` :
              '，尚未练习'}
          </Descriptions.Item>
          <Descriptions.Item label="添加日期">
            {record.createdAt}
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Modal>
  );
}
