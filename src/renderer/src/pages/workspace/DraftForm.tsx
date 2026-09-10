import { useCallback, useState } from 'react';
import {
  Button,
  Checkbox,
  Col,
  Form,
  Input,
  App as AntApp,
  Row,
  Segmented,
  Select,
} from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import {
  AUDIENCE_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  TONE_OPTIONS,
} from '../../../../shared/constants/scenes';
import type { AnalyzeDraftInput } from '../../../../shared/types/ai';

export type DraftFormValues = {
  originalChinese?: string;
  originalEnglish: string;
  sourceType: AnalyzeDraftInput['sourceType'];
  audience: AnalyzeDraftInput['audience'];
  tone: AnalyzeDraftInput['tone'];
  saveOriginal: boolean;
};

export type DraftFormSubmit = {
  input: AnalyzeDraftInput;
  saveOriginal: boolean;
};

interface DraftFormProps {
  loading: boolean;
  onSubmit: (submit: DraftFormSubmit) => void;
  initialValues?: DraftFormValues;
  onValuesChange?: (changedValues: Partial<DraftFormValues>) => void;
}

export const INITIAL_VALUES: DraftFormValues = {
  originalChinese: '',
  originalEnglish: '',
  sourceType: 'email',
  audience: 'colleague',
  tone: 'neutral',
  saveOriginal: true,
};

/**
 * 工作区表单：中文原意 + 英文草稿 + 场景/对象/语气（T008）
 */
export function DraftForm({ loading, onSubmit, initialValues = INITIAL_VALUES, onValuesChange }: DraftFormProps) {
  const [form] = Form.useForm<DraftFormValues>();
  const { message } = AntApp.useApp();
  const [pasting, setPasting] = useState(false);

  /** 从系统剪贴板粘贴英文草稿（sandbox 渲染进程无法直接读剪贴板，走 IPC） */
  const handlePasteEnglish = useCallback(async () => {
    setPasting(true);
    const r = await window.desktopAPI.clipboardRead();
    setPasting(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    const text = r.data.trim();
    if (!text) {
      message.warning('剪贴板内容为空');
      return;
    }
    if (text.length > 10000) {
      message.error('剪贴板内容超过 10000 字符，无法粘贴');
      return;
    }
    form.setFieldValue('originalEnglish', text);
    // setFieldValue 不触发 onValuesChange，手动同步给父组件（持久化到 store）
    onValuesChange?.({ originalEnglish: text });
    message.success('已从剪贴板粘贴');
  }, [form, message, onValuesChange]);

  const handleFinish = (values: DraftFormValues) => {
    const {
      originalChinese,
      originalEnglish,
      sourceType,
      audience,
      tone,
      saveOriginal,
    } = values;
    const input: AnalyzeDraftInput = {
      originalEnglish: originalEnglish.trim(),
      sourceType,
      audience,
      tone,
    };
    const trimmedChinese = originalChinese?.trim();
    if (trimmedChinese) {
      input.originalChinese = trimmedChinese;
    }
    onSubmit({ input, saveOriginal });
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onValuesChange={(changedValues) => onValuesChange?.(changedValues)}
      onFinish={handleFinish}
      requiredMark={false}
    >
      <Form.Item
        name="originalChinese"
        label="中文原意（可选）"
        extra="填写后 AI 会检查英文草稿是否与你的本意一致"
      >
        <Input.TextArea
          rows={3}
          maxLength={2000}
          showCount
          placeholder="我想表达的中文内容，例如：告诉对方报告会延迟到明天下午"
        />
      </Form.Item>

      <Form.Item
        name="originalEnglish"
        label={
          <span>
            英文草稿（必填）
            <Button
              type="link"
              size="small"
              icon={<CopyOutlined />}
              loading={pasting}
              onClick={handlePasteEnglish}
              style={{ padding: 0, marginLeft: 8 }}
            >
              从剪贴板粘贴
            </Button>
          </span>
        }
        rules={[
          { required: true, message: '请输入英文草稿' },
          { min: 1, message: '英文草稿不能为空' },
          { max: 10000, message: '英文草稿不能超过 10000 字符' },
        ]}
      >
        <Input.TextArea
          rows={5}
          maxLength={10000}
          showCount
          placeholder={'Paste your English draft here, e.g.\nHi John, the report will be delayed to tomorrow afternoon...'}
        />
      </Form.Item>

      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="sourceType" label="场景">
            <Select options={SOURCE_TYPE_OPTIONS} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="audience" label="沟通对象">
            <Select options={AUDIENCE_OPTIONS} />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item name="tone" label="语气">
        <Segmented options={TONE_OPTIONS} block />
      </Form.Item>

      <Form.Item
        name="saveOriginal"
        valuePropName="checked"
        className="wec-form-item-plain"
      >
        <Checkbox>保存原文（取消勾选后原文不会写入数据库）</Checkbox>
      </Form.Item>

      <Button
        type="primary"
        htmlType="submit"
        block
        size="large"
        loading={loading}
        disabled={loading}
      >
        {loading ? 'AI 检查中…' : '检查'}
      </Button>
    </Form>
  );
}
