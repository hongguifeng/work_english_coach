// T011：设置页面。
// - 非密钥设置：Zod 校验后保存到页内 Zustand（mock 持久化 localStorage）；T016 起切换 IPC + SQLite settings 表
// - API Key：密码输入框，仅内存保存，不落盘（T018 起由 DPAPI 系统凭据存储接管）
// - 测试连接：mock（T021 接入真实调用）
// - 导出数据/删除全部数据：已接入真实 IPC + SQLite（T017）；删除后向渲染进程广播 data:changed
import { useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Switch,
  Typography,
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { PageHeader } from '../components/PageHeader';
import {
  aiSettingsSchema,
  type AiSettings,
} from '../../../shared/types/settings';
import { useSettingsStore } from './settings/SettingsStore';

type TestResult = { kind: 'idle' } | { kind: 'testing' } |
  { kind: 'ok' } | { kind: 'fail'; message: string };

export default function SettingsPage() {
  const ai = useSettingsStore((s) => s.ai);
  const apiKey = useSettingsStore((s) => s.apiKey);
  const set = useSettingsStore((s) => s.set);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const { message } = AntApp.useApp();

  const [form] = Form.useForm<{
    baseUrl: string;
    model: string;
    timeoutSeconds: number;
    saveOriginal: boolean;
    redactEnabled: boolean;
  }>();
  const [test, setTest] = useState<TestResult>({ kind: 'idle' });
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = (values: {
    baseUrl: string;
    model: string;
    timeoutSeconds: number;
    saveOriginal: boolean;
    redactEnabled: boolean;
  }) => {
    const result = aiSettingsSchema.safeParse({
      baseUrl: values.baseUrl.trim(),
      model: values.model.trim(),
      timeoutSeconds: values.timeoutSeconds,
      saveOriginal: values.saveOriginal,
      redactEnabled: values.redactEnabled,
    });
    if (!result.success) {
      message.error(`保存失败：${result.error.issues[0]?.message ?? '输入不合法'}`);
      return;
    }
    set(result.data as AiSettings);
    message.success(
      '保存成功（API Key 未写入磁盘，T018 接入系统凭据存储后单独保管）',
    );
  };

  const handleTest = async () => {
    setTest({ kind: 'testing' });
    // mock：T021 替换为真实 /v1/models 或最小 chat 调用
    await new Promise((r) => setTimeout(r, 800));
    const parsed = aiSettingsSchema.safeParse({
      ...ai,
      baseUrl: (form.getFieldValue('baseUrl') as string | undefined)?.trim() ?? ai.baseUrl,
      model: (form.getFieldValue('model') as string | undefined)?.trim() ?? ai.model,
    });
    if (!parsed.success) {
      setTest({
        kind: 'fail',
        message: parsed.error.issues[0]?.message ?? '设置不合法',
      });
      return;
    }
    setTest({ kind: 'ok' });
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader
        title="设置"
        description="AI 服务、数据与隐私、数据管理（T011 mock 持久化，T016/T018/T021 接入真实存储与调用）"
      />

      <Card>
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handleSave}
          initialValues={{
            baseUrl: ai.baseUrl,
            model: ai.model,
            timeoutSeconds: ai.timeoutSeconds,
            saveOriginal: ai.saveOriginal,
            redactEnabled: ai.redactEnabled,
          }}
        >
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            AI 服务
          </Typography.Title>
          <Form.Item
            name="baseUrl"
            label="Base URL"
            tooltip="OpenAI 兼容接口地址，以 /v1 结尾"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                例如 https://api.openai.com/v1 或本地 http://127.0.0.1:12346/v1
              </Typography.Text>
            }
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            name="model"
            label="模型名称"
            tooltip="传给 chat/completions 的 model 字段"
          >
            <Input placeholder="例如 gpt-4o-mini 或 qwen3.8-27b" />
          </Form.Item>
          <Form.Item
            label="API Key"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                仅保存在内存（T011）；T018 起写入 Windows 凭据存储（DPAPI），
                绝不存入数据库或日志
              </Typography.Text>
            }
          >
            <Input.Password
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item
            name="timeoutSeconds"
            label="请求超时时间（秒）"
            rules={[{ required: true, message: '请输入超时时间' }]}
          >
            <InputNumber min={5} max={300} style={{ width: 160 }} />
          </Form.Item>

          <Form.Item>
            <Button
              icon={<ThunderboltOutlined />}
              loading={test.kind === 'testing'}
              onClick={handleTest}
            >
              测试连接
            </Button>
          </Form.Item>
          {test.kind === 'ok' ? (
            <Alert
              type="success"
              showIcon
              message="连接测试通过（mock；T021 将发起真实请求验证）"
              style={{ marginBottom: 16 }}
            />
          ) : null}
          {test.kind === 'fail' ? (
            <Alert
              type="error"
              showIcon
              message={`连接测试失败：${test.message}`}
              style={{ marginBottom: 16 }}
            />
          ) : null}

          <Divider />
          <Typography.Title level={5}>数据与隐私</Typography.Title>
          <Form.Item
            name="saveOriginal"
            valuePropName="checked"
            label="保存原始工作文本"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                关闭后不保存你的原始中文/英文文本，但学习记录（错误、表达、复习进度）仍会保存
              </Typography.Text>
            }
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="redactEnabled"
            valuePropName="checked"
            label="启用脱敏"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                发送给 AI 前，对文本中的人名、邮箱等个人信息进行掩码处理
              </Typography.Text>
            }
          >
            <Switch />
          </Form.Item>

          <Divider />
          <Typography.Title level={5}>数据管理</Typography.Title>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              loading={exporting}
              onClick={async () => {
                setExporting(true);
                const res = await window.desktopAPI.dataExport();
                setExporting(false);
                if (!res.ok) {
                  message.error(res.error.message);
                  return;
                }
                if (res.data.skipped) {
                  message.info('已取消导出');
                  return;
                }
                message.success(`已导出：${res.data.path}`);
              }}
            >
              导出数据
            </Button>
            <Popconfirm
              title="确定要删除全部数据吗？"
              description="将删除所有草稿、学习记录、表达库与复习任务，且不可恢复。API Key 不受影响。"
              okText="确认删除"
              okButtonProps={{ danger: true, loading: deleting }}
              cancelText="取消"
              onConfirm={async () => {
                setDeleting(true);
                const res = await window.desktopAPI.dataDeleteAll();
                setDeleting(false);
                if (!res.ok) {
                  message.error(res.error.message);
                  return;
                }
                message.success(
                  `已删除 ${res.data.total} 条学习数据（设置已保留）`,
                );
              }}
            >
              <Button danger loading={deleting}>删除全部数据</Button>
            </Popconfirm>
          </div>

          <Divider />
          <Button type="primary" htmlType="submit">
            保存设置
          </Button>
        </Form>
      </Card>
    </div>
  );
}
