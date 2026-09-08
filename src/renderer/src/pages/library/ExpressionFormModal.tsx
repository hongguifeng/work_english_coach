// T010（mock）：新增/编辑表达弹窗。T026 起提交动作替换为 IPC 调用（UI 不变）。
import { useEffect } from 'react';
import { App, Button, Form, Input, Modal, Select } from 'antd';
import { CATEGORY_OPTIONS } from '../../../../shared/constants/issues';
import {
  AUDIENCE_OPTIONS,
  SOURCE_TYPE_OPTIONS,
} from '../../../../shared/constants/scenes';
import type {
  ExpressionRecord,
  MasteryLevel,
} from '../../../../shared/types/library';
import type { Audience, IssueCategory, SourceType } from '../../../../shared/types/ai';
import { useExpressionStore } from './ExpressionStore';

interface FormValues {
  scene: SourceType;
  audience: Audience;
  originalExpression: string;
  correctedExpression: string;
  errorCategory?: IssueCategory;
  aiSummary?: string;
  masteryLevel: MasteryLevel;
}

export interface ExpressionFormModalProps {
  open: boolean;
  /** 传入则为编辑模式，否则为新增模式 */
  initial?: ExpressionRecord | null;
  onClose: () => void;
}

const MASTERY_OPTIONS: { value: MasteryLevel; label: string }[] = [
  { value: 'needs_review', label: '待复习' },
  { value: 'mastered', label: '已掌握' },
];

export function ExpressionFormModal({ open, initial, onClose }: ExpressionFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const add = useExpressionStore((s) => s.add);
  const update = useExpressionStore((s) => s.update);
  const isEdit = initial !== null && initial !== undefined;

  useEffect(() => {
    if (!open) return;
    if (isEdit && initial) {
      form.setFieldsValue({
        scene: initial.scene,
        audience: initial.audience,
        originalExpression: initial.originalExpression,
        correctedExpression: initial.correctedExpression,
        errorCategory: initial.errorCategory ?? undefined,
        aiSummary: initial.aiSummary ?? undefined,
        masteryLevel: initial.masteryLevel,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        scene: 'email',
        audience: 'colleague',
        masteryLevel: 'needs_review',
      });
    }
  }, [open, isEdit, initial, form]);

  const handleFinish = (values: FormValues) => {
    const payload = {
      scene: values.scene,
      audience: values.audience,
      originalExpression: values.originalExpression.trim(),
      correctedExpression: values.correctedExpression.trim(),
      errorCategory: values.errorCategory ?? null,
      aiSummary: values.aiSummary?.trim() ? values.aiSummary.trim() : null,
      masteryLevel: values.masteryLevel,
    };
    if (isEdit && initial) {
      update(initial.id, payload);
      message.success('表达已更新');
    } else {
      add(payload);
      message.success('表达已添加到库');
    }
    onClose();
  };

  return (
    <Modal
      title={isEdit ? '编辑表达' : '新增表达'}
      open={open}
      onCancel={onClose}
      width={560}
      destroyOnHidden
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" htmlType="submit">
            保存
          </Button>
        </>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        requiredMark={false}
        initialValues={{
          scene: 'email',
          audience: 'colleague',
          masteryLevel: 'needs_review',
        }}
      >
        <Form.Item
          name="scene"
          label="场景"
          rules={[{ required: true, message: '请选择场景' }]}
        >
          <Select options={SOURCE_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="audience"
          label="沟通对象"
          rules={[{ required: true, message: '请选择沟通对象' }]}
        >
          <Select options={AUDIENCE_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="originalExpression"
          label="原始表达（你的写法）"
          rules={[
            { required: true, message: '请输入原始表达' },
            { min: 1, message: '原始表达不能为空' },
            { max: 2000, message: '原始表达不能超过 2000 字符' },
          ]}
        >
          <Input.TextArea rows={3} placeholder="例如：We are very sorry, the product have many problems." />
        </Form.Item>
        <Form.Item
          name="correctedExpression"
          label="推荐表达（修改后）"
          rules={[
            { required: true, message: '请输入推荐表达' },
            { min: 1, message: '推荐表达不能为空' },
            { max: 2000, message: '推荐表达不能超过 2000 字符' },
          ]}
        >
          <Input.TextArea
            rows={3}
            placeholder="例如：We sincerely apologize for the issues with the product."
          />
        </Form.Item>
        <Form.Item
          name="errorCategory"
          label="错误类别（可选）"
          tooltip="用于后续按类别统计与筛选"
        >
          <Select
            allowClear
            placeholder="选择错误类别"
            options={CATEGORY_OPTIONS}
          />
        </Form.Item>
        <Form.Item
          name="aiSummary"
          label="要点说明（可选）"
          tooltip="为什么这样改？1-2 句话即可"
        >
          <Input.TextArea rows={2} placeholder="例如：向上级询问预算用 Could you let me know...，避免质问感" />
        </Form.Item>
        <Form.Item
          name="masteryLevel"
          label="掌握状态"
          rules={[{ required: true, message: '请选择掌握状态' }]}
        >
          <Select options={MASTERY_OPTIONS} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
