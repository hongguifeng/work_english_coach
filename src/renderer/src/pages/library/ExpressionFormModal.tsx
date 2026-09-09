// T026：新增/编辑表达弹窗（真实数据：提交动作由父页面经 IPC 执行）。
// 表单字段与 expressions 表对齐：title / chineseMeaning / pattern / example /
// scenario / notes / masteryStatus（nextReviewAt 由复习循环维护，不在此编辑）。
import { useEffect } from 'react';
import { App, Form, Input, Modal, Select } from 'antd';
import { SOURCE_TYPE_OPTIONS } from '../../../../shared/constants/scenes';
import type { ExpressionRecord, MasteryStatus } from '../../../../shared/types/library';

export interface ExpressionFormValues {
  title: string;
  chineseMeaning: string;
  pattern?: string | null;
  example?: string | null;
  scenario?: string | null;
  notes?: string | null;
  masteryStatus: MasteryStatus;
}

export interface ExpressionFormModalProps {
  open: boolean;
  /** 传入则为编辑模式，否则为新增模式 */
  initial?: ExpressionRecord | null;
  /** 提交中（父页面 IPC 飞行中；按钮 loading + 禁用关闭） */
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: ExpressionFormValues) => void;
}

const MASTERY_OPTIONS: { value: MasteryStatus; label: string }[] = [
  { value: 'new', label: '新学（刚加入）' },
  { value: 'learning', label: '学习中' },
  { value: 'familiar', label: '已熟悉（可降频）' },
];

function buildInitial(initial?: ExpressionRecord | null): ExpressionFormValues {
  if (initial) {
    return {
      title: initial.title,
      chineseMeaning: initial.chineseMeaning,
      pattern: initial.pattern,
      example: initial.example,
      scenario: initial.scenario,
      notes: initial.notes,
      masteryStatus: initial.masteryStatus,
    };
  }
  return {
    title: '',
    chineseMeaning: '',
    pattern: '',
    example: '',
    scenario: null,
    notes: '',
    masteryStatus: 'new',
  };
}

export default function ExpressionFormModal({
  open,
  initial,
  submitting,
  onClose,
  onSubmit,
}: ExpressionFormModalProps): React.ReactElement {
  const { message } = App.useApp();
  const [form] = Form.useForm<ExpressionFormValues>();

  useEffect(() => {
    if (open) {
      form.setFieldsValue(buildInitial(initial));
    }
  }, [open, initial, form]);

  const handleOk = async () => {
    try {
      const v = await form.validateFields();
      onSubmit(v);
    } catch {
      message.warning('请先填写必填字段');
    }
  };

  return (
    <Modal
      open={open}
      title={initial ? '编辑表达' : '新增表达'}
      onCancel={submitting ? undefined : onClose}
      maskClosable={!submitting}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => {
        void handleOk();
      }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={buildInitial(initial)}>
        <Form.Item
          name="title"
          label="标题"
          rules={[
            { required: true, message: '请输入标题' },
            { max: 50, message: '最多 50 个字符' },
          ]}
        >
          <Input placeholder="如：By the end of Q3（表截止日期）" />
        </Form.Item>
        <Form.Item
          name="chineseMeaning"
          label="中文释义"
          // 长度上限必须与主进程 expressionService 的 Zod schema 保持一致
          rules={[
            { required: true, message: '请输入中文释义' },
            { max: 100, message: '最多 100 个字符' },
          ]}
        >
          <Input placeholder="一句话说明这个表达的意思" />
        </Form.Item>
        <Form.Item
          name="pattern"
          label="固定搭配/句型（可选）"
          rules={[{ max: 20, message: '最多 20 个字符' }]}
        >
          <Input placeholder="如：by + 时间点 / as of + 时间点" />
        </Form.Item>
        <Form.Item
          name="example"
          label="例句（可选）"
          rules={[{ max: 200, message: '最多 200 个字符' }]}
        >
          <Input.TextArea rows={2} placeholder="尽量写真实工作场景里的句子" />
        </Form.Item>
        <Form.Item
          name="scenario"
          label="场景（可选）"
          rules={[{ max: 20, message: '最多 20 个字符' }]}
        >
          <Select
            allowClear
            placeholder="选择出现场景"
            options={[...SOURCE_TYPE_OPTIONS]}
          />
        </Form.Item>
        <Form.Item
          name="notes"
          label="备注（可选）"
          rules={[{ max: 200, message: '最多 200 个字符' }]}
        >
          <Input.TextArea rows={2} placeholder="易混点、使用限制等" />
        </Form.Item>
        <Form.Item
          name="masteryStatus"
          label="掌握状态"
          rules={[{ required: true, message: '请选择掌握状态' }]}
        >
          <Select options={[...MASTERY_OPTIONS]} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
