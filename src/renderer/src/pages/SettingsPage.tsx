// 设置页（T011 骨架 / T017 数据管理 / T018 API Key 凭据存储 / T019 AI 配置持久化）
// - AI 服务非密钥设置：Zod 校验后经 IPC 持久化到 SQLite settings 表（T019）；
//   挂载时从主进程回填，保存按钮带 loading。
// - API Key：独立卡片，走系统凭据存储（keytar/DPAPI，T018）。
//   * 只展示“是否已配置”，绝不显示完整 Key；保存后清空输入框，不在 UI 残留原文
// - 测试连接：mock（T021 接入真实调用）
// - 导出数据 / 删除全部数据：真实 IPC + SQLite（T017）
import { useEffect, useState } from 'react';
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
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { PageHeader } from '../components/PageHeader';
import {
  aiSettingsSchema,
  type AiSettings,
} from '../../../shared/types/settings';
import { useSettingsStore } from './settings/SettingsStore';

type TestResult =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'fail'; message: string };

/** API Key 最大长度（与主进程 secretService 保持一致）。 */
const MAX_API_KEY_LENGTH = 512;

export default function SettingsPage() {
  const ai = useSettingsStore((s) => s.ai);
  const set = useSettingsStore((s) => s.set);
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
  const [saving, setSaving] = useState(false);

  // API Key（T018）：原文只在输入框短暂存在，保存后清空；这里只跟踪“是否已配置”
  const [keyInput, setKeyInput] = useState('');
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [clearingKey, setClearingKey] = useState(false);

  // 挂载时查询是否已配置（只返回布尔，不返回 Key）
  useEffect(() => {
    let active = true;
    window.desktopAPI
      .secretIsConfigured()
      .then((r) => {
        if (active) setKeyConfigured(r.ok ? r.data : false);
      });
    return () => {
      active = false;
    };
  }, []);

  // T019：挂载时从 SQLite（经主进程）回填已持久化的 AI 配置（缺失/损坏 → 主进程给默认值）。
  useEffect(() => {
    let active = true;
    window.desktopAPI.aiConfigGet().then((r) => {
      if (!active) return;
      if (r.ok) {
        form.setFieldsValue({
          baseUrl: r.data.baseUrl,
          model: r.data.model,
          timeoutSeconds: r.data.timeoutSeconds,
          saveOriginal: r.data.saveOriginal,
          redactEnabled: r.data.redactEnabled,
        });
        set(r.data); // 同步会话态（供测试连接等读取）
      }
    });
    return () => {
      active = false;
    };
  }, [form, set]);

  const handleSaveKey = async () => {
    const k = keyInput.trim();
    if (k.length === 0) {
      message.error('请先输入 API Key');
      return;
    }
    if (k.length > MAX_API_KEY_LENGTH) {
      message.error(`API Key 过长（最多 ${MAX_API_KEY_LENGTH} 个字符）`);
      return;
    }
    setSavingKey(true);
    const r = await window.desktopAPI.secretSet(k);
    setSavingKey(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    setKeyInput(''); // 清空原文，不在输入框残留
    setKeyConfigured(true);
    message.success('API Key 已保存到系统凭据存储（未写入数据库或日志）');
  };

  const handleClearKey = async () => {
    setClearingKey(true);
    const r = await window.desktopAPI.secretClear();
    setClearingKey(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    setKeyConfigured(false);
    message.success('API Key 已清除');
  };

  const handleSave = async (values: {
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
    setSaving(true);
    const r = await window.desktopAPI.aiConfigSave(result.data as AiSettings);
    setSaving(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    set(r.data); // 同步会话态
    message.success('保存成功（设置已持久化到本地数据库；API Key 独立保存在系统凭据存储）');
  };

  const handleTest = async () => {
    setTest({ kind: 'testing' });
    // mock：T021 替换为真实 /v1/models 或最小 chat 调用
    await new Promise((r) => setTimeout(r, 800));
    const parsed = aiSettingsSchema.safeParse({
      ...ai,
      baseUrl:
        (form.getFieldValue('baseUrl') as string | undefined)?.trim() ?? ai.baseUrl,
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
        description="AI 服务与数据管理。API Key 由系统凭据存储保管（T018）；AI 配置持久化到本地数据库（T019），测试连接将在 T021 接入真实调用。"
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
                关闭后不保存原始中文/英文文本，但学习记录（错误、表达、复习进度）仍会保存
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
                message.success(`已删除 ${res.data.total} 条学习数据（设置已保留）`);
              }}
            >
              <Button danger loading={deleting}>删除全部数据</Button>
            </Popconfirm>
          </div>

          <Divider />
          <Button type="primary" htmlType="submit" loading={saving}>
            保存设置
          </Button>
        </Form>
      </Card>

      <Card
        title="API Key（系统凭据存储）"
        style={{ marginTop: 16 }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          API Key 保存在 Windows 系统凭据存储（DPAPI），仅当前 Windows 用户可读；
          不写入数据库、不进入日志。这里只展示是否已配置，不显示完整 Key。
        </Typography.Text>
        <div style={{ margin: '12px 0' }}>
          <Space>
            <Tag color={keyConfigured ? 'green' : 'default'}>
              {keyConfigured === null ? '查询中…' : keyConfigured ? '已配置' : '未配置'}
            </Tag>
          </Space>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input.Password
            placeholder={keyConfigured ? '输入新的 API Key 以更新' : 'sk-...'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            style={{ flex: '1 1 280px' }}
            autoComplete="off"
            maxLength={MAX_API_KEY_LENGTH}
          />
          <Button
            type="primary"
            loading={savingKey}
            onClick={handleSaveKey}
          >
            保存
          </Button>
          {keyConfigured ? (
            <Popconfirm
              title="确定要清除 API Key 吗？"
              description="清除后需要重新输入才能使用 AI。"
              okText="清除"
              okButtonProps={{ danger: true, loading: clearingKey }}
              cancelText="取消"
              onConfirm={handleClearKey}
            >
              <Button danger loading={clearingKey}>
                清除
              </Button>
            </Popconfirm>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
