// 设置页（T011 骨架 / T017 数据管理 / T018 API Key 凭据存储 / T019 AI 配置持久化 / T042 测试连接）
// - AI 服务非密钥设置：Zod 校验后经 IPC 持久化到 SQLite settings 表（T019）；
//   挂载时从主进程回填，保存按钮带 loading。
// - API Key：独立卡片，走系统凭据存储（keytar/DPAPI，T018）。
//   * 只展示“是否已配置”，绝不显示完整 Key；保存后清空输入框，不在 UI 残留原文
// - 测试连接（T042）：真实最小 AI 调用（复用纠错/评价的 /chat/completions 通道）；
//   Key 由主进程从凭据存储读取（不经过 IPC），响应内容丢弃，只返回耗时。
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
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import {
  aiSettingsSchema,
  type CopilotModel,
  type AiSettings,
} from '../../../shared/types/settings';
import { useSettingsStore } from './settings/SettingsStore';

type TestResult =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'fail'; message: string };

/** 把测试连接失败映射为可理解的中文（与 WorkspacePage 的 humanMessage 同风格）。 */
function testErrorMessage(code: string, message: string | null): string {
  if (message && message.trim()) return message;
  switch (code) {
    case 'config':
      return '配置错误：请检查当前凭据方式、登录状态和模型名称';
    case 'timeout':
      return '请求超时，请检查网络或调大超时时间';
    case 'network':
      return '网络错误：无法连接到该 AI 服务，请检查 Base URL 是否可达';
    case 'parse':
      return 'AI 服务返回了无法解析的响应，请检查服务状态';
    case 'validation':
      return '输入不符合要求，请检查后重试';
    default:
      return '发生未知错误，请重试';
  }
}

/** API Key 最大长度（与主进程 secretService 保持一致）。 */
const MAX_API_KEY_LENGTH = 512;

export default function SettingsPage() {
  const ai = useSettingsStore((s) => s.ai);
  const set = useSettingsStore((s) => s.set);
  const { message } = AntApp.useApp();

  const [form] = Form.useForm<{
    baseUrl: string;
    model: string;
    provider: 'apiKey' | 'githubCopilot';
    apiEndpoint: 'chatCompletions' | 'responses';
    timeoutSeconds: number;
    reasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
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
  const [copilotConfigured, setCopilotConfigured] = useState<boolean | null>(null);
  const [copilotLogin, setCopilotLogin] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [startingCopilotLogin, setStartingCopilotLogin] = useState(false);
  const [completingCopilotLogin, setCompletingCopilotLogin] = useState(false);
  const [loggingOutCopilot, setLoggingOutCopilot] = useState(false);
  const [copilotModels, setCopilotModels] = useState<CopilotModel[]>([]);
  const [loadingCopilotModels, setLoadingCopilotModels] = useState(false);
  const [copilotModelsError, setCopilotModelsError] = useState<string | null>(null);
  const selectedProvider = Form.useWatch('provider', form) ?? ai.provider ?? 'apiKey';

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

  useEffect(() => {
    if (selectedProvider !== 'githubCopilot' || copilotConfigured !== true) {
      setCopilotModels([]);
      setCopilotModelsError(null);
      return;
    }
    let active = true;
    setLoadingCopilotModels(true);
    setCopilotModelsError(null);
    window.desktopAPI.copilotListModels().then((r) => {
      if (!active) return;
      setLoadingCopilotModels(false);
      if (!r.ok) {
        setCopilotModelsError(r.error.message);
        return;
      }
      setCopilotModels(r.data);
      const currentModel = form.getFieldValue('model') as string | undefined;
      if (!currentModel || !r.data.some((model) => model.id === currentModel)) {
        form.setFieldValue('model', r.data[0]?.id);
      }
    });
    return () => {
      active = false;
    };
  }, [copilotConfigured, form, selectedProvider]);

  useEffect(() => {
    let active = true;
    window.desktopAPI.copilotIsConfigured().then((r) => {
      if (active) setCopilotConfigured(r.ok ? r.data : false);
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
          provider: r.data.provider ?? 'apiKey',
          baseUrl: r.data.baseUrl,
          model: r.data.model,
          timeoutSeconds: r.data.timeoutSeconds,
          reasoningEffort: r.data.reasoningEffort ?? 'none',
          apiEndpoint: r.data.apiEndpoint ?? 'chatCompletions',
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
    provider: 'apiKey' | 'githubCopilot';
    baseUrl?: string;
    model?: string;
    timeoutSeconds: number;
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
    apiEndpoint?: 'chatCompletions' | 'responses';
    saveOriginal: boolean;
    redactEnabled: boolean;
  }) => {
    const result = aiSettingsSchema.safeParse({
      provider: values.provider,
      // Copilot 不展示 Base URL，但数据库 schema 保留该字段以兼容旧配置。
      baseUrl: values.baseUrl?.trim() || ai.baseUrl,
      model: values.model?.trim() || ai.model,
      timeoutSeconds: values.timeoutSeconds,
      reasoningEffort: values.reasoningEffort ?? 'none',
      apiEndpoint: values.apiEndpoint ?? 'chatCompletions',
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
    message.success(
      selectedProvider === 'githubCopilot'
        ? 'Copilot 设置已保存；请求将使用 GitHub Copilot 订阅'
        : 'API 设置已保存；请求将使用 API Key 和 Base URL',
    );
  };

  const handleTest = async () => {
    setTest({ kind: 'testing' });
    const provider = selectedProvider;
    // T042：用表单「当前」值（未保存也能测）；Key 由主进程从凭据存储读取（不经过 IPC）
    const baseUrl = provider === 'githubCopilot'
      ? ai.baseUrl
      : ((form.getFieldValue('baseUrl') as string | undefined)?.trim() || ai.baseUrl);
    const model =
      (form.getFieldValue('model') as string | undefined)?.trim() || ai.model;
    const timeoutSeconds =
      (form.getFieldValue('timeoutSeconds') as number | undefined) ?? ai.timeoutSeconds;
    const reasoningEffort =
      (form.getFieldValue('reasoningEffort') as 'none' | 'low' | 'medium' | 'high' | 'xhigh' | undefined) ??
      ai.reasoningEffort ??
      'none';
    const apiEndpoint =
      (form.getFieldValue('apiEndpoint') as 'chatCompletions' | 'responses' | undefined) ??
      ai.apiEndpoint ??
      'chatCompletions';
    const r = await window.desktopAPI.aiTestConnection({
      provider,
      baseUrl,
      model,
      timeoutSeconds,
      reasoningEffort,
      apiEndpoint: provider === 'githubCopilot' ? undefined : apiEndpoint,
    });
    if (r.ok) {
      setTest({ kind: 'ok', latencyMs: r.data.latencyMs });
    } else {
      setTest({ kind: 'fail', message: testErrorMessage(r.error.code, r.error.message) });
    }
  };

  const beginCopilotLogin = async () => {
    setStartingCopilotLogin(true);
    const r = await window.desktopAPI.copilotBeginLogin();
    setStartingCopilotLogin(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    setCopilotLogin(r.data);
    window.open(r.data.verificationUri, '_blank', 'noopener,noreferrer');
  };

  const completeCopilotLogin = async () => {
    setCompletingCopilotLogin(true);
    const r = await window.desktopAPI.copilotCompleteLogin();
    setCompletingCopilotLogin(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    setCopilotLogin(null);
    setCopilotConfigured(true);
    message.success('GitHub Copilot 登录成功');
  };

  const logoutCopilot = async () => {
    setLoggingOutCopilot(true);
    const r = await window.desktopAPI.copilotLogout();
    setLoggingOutCopilot(false);
    if (!r.ok) {
      message.error(r.error.message);
      return;
    }
    setCopilotConfigured(false);
    setCopilotLogin(null);
    message.success('已退出 GitHub Copilot');
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <Card>
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handleSave}
          initialValues={{
            provider: ai.provider ?? 'apiKey',
            baseUrl: ai.baseUrl,
            model: ai.model,
            timeoutSeconds: ai.timeoutSeconds,
            reasoningEffort: ai.reasoningEffort ?? 'none',
            apiEndpoint: ai.apiEndpoint ?? 'chatCompletions',
            saveOriginal: ai.saveOriginal,
            redactEnabled: ai.redactEnabled,
          }}
        >
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            AI 连接方式
          </Typography.Title>
          <Form.Item name="provider" label="凭据方式">
            <Select
              options={[
                { value: 'apiKey', label: 'API Key' },
                { value: 'githubCopilot', label: 'GitHub Copilot 订阅' },
              ]}
            />
          </Form.Item>
          {selectedProvider === 'apiKey' ? (
            <>
              <Alert
                type="info"
                showIcon
                message="当前请求使用 API Key"
                description="请求会发送到下面的 Base URL，并使用 API Key 卡片中保存的密钥。"
                style={{ marginBottom: 16 }}
              />
              <Form.Item
                name="baseUrl"
                label="Base URL"
                tooltip="OpenAI 兼容服务地址，请求会发送到 {baseUrl} 下的所选接口"
                extra={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    例如 https://api.openai.com/v1 或本地 http://127.0.0.1:12346/v1
                  </Typography.Text>
                }
              >
                <Input placeholder="https://api.openai.com/v1" />
              </Form.Item>
              <Form.Item
                name="apiEndpoint"
                label="API 接口"
                tooltip="Chat Completions 是 OpenAI 标准的 /chat/completions；Responses 是 OpenAI /responses 接口（部分兼容服务也提供）"
              >
                <Select
                  style={{ width: 260 }}
                  options={[
                    { value: 'chatCompletions', label: 'Chat Completions（/chat/completions）' },
                    { value: 'responses', label: 'Responses（/responses）' },
                  ]}
                />
              </Form.Item>
            </>
          ) : (
            <Alert
              type="info"
              showIcon
              message="当前请求使用 GitHub Copilot 订阅"
              description="Base URL 由系统固定为 https://api.githubcopilot.com，不使用 API Key 卡片中的密钥；API 接口由系统按所选模型自动选择（Claude 模型走 Chat Completions，其它走 Responses）。"
              style={{ marginBottom: 16 }}
            />
          )}
          <Form.Item
            name="model"
            label="模型名称"
            tooltip={
              selectedProvider === 'githubCopilot'
                ? '传给 GitHub Copilot 的模型名称'
                : '传给 AI 请求的 model 字段'
            }
            extra={
              selectedProvider === 'githubCopilot' ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  这个模型会用于 Copilot 请求；Base URL 不需要填写。
                </Typography.Text>
              ) : null
            }
          >
            {selectedProvider === 'githubCopilot' ? (
              <Select
                showSearch
                loading={loadingCopilotModels}
                placeholder={copilotModels.length > 0 ? '选择当前订阅可用模型' : '请先登录 Copilot'}
                options={copilotModels.map((model) => ({ value: model.id, label: model.name === model.id ? model.id : `${model.name} (${model.id})` }))}
                notFoundContent={copilotModelsError ?? '暂无可用模型'}
                disabled={copilotConfigured !== true || copilotModels.length === 0}
              />
            ) : (
              <Input placeholder="例如 gpt-4o-mini 或 qwen3.8-27b" />
            )}
          </Form.Item>
          {selectedProvider === 'githubCopilot' && copilotModelsError ? (
            <Alert
              type="warning"
              showIcon
              message={`无法获取 Copilot 模型列表：${copilotModelsError}`}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Form.Item
            name="reasoningEffort"
            label="思考强度"
            tooltip="API Key 和 GitHub Copilot 共用此设置"
            extra="none 最快；强度越高通常越慢、消耗越多，且需要模型支持。"
          >
            <Select
              options={[
                { value: 'none', label: '关闭思考（none）' },
                { value: 'low', label: '低（low）' },
                { value: 'medium', label: '中（medium）' },
                { value: 'high', label: '高（high）' },
                { value: 'xhigh', label: '极高（xhigh）' },
              ]}
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
              {selectedProvider === 'githubCopilot' ? '测试 Copilot 连接' : '测试 API 连接'}
            </Button>
          </Form.Item>
          {test.kind === 'ok' ? (
            <Alert
              type="success"
              showIcon
              message={`${selectedProvider === 'githubCopilot' ? 'Copilot' : 'API'} 连接测试通过（响应 ${test.latencyMs}ms）`}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          {test.kind === 'fail' ? (
            <Alert
              type="error"
              showIcon
              message={`${selectedProvider === 'githubCopilot' ? 'Copilot' : 'API'} 连接测试失败：${test.message}`}
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

      {selectedProvider === 'githubCopilot' ? (
      <Card title="GitHub Copilot 订阅登录" style={{ marginTop: 16 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          使用 GitHub OAuth 设备登录。GitHub token 和 Copilot token 只保存在 Windows 系统凭据存储，不会进入数据库或渲染进程。
        </Typography.Text>
        <div style={{ margin: '12px 0' }}>
          <Tag color={copilotConfigured ? 'green' : 'default'}>
            {copilotConfigured === null ? '查询中…' : copilotConfigured ? '已登录' : '未登录'}
          </Tag>
        </div>
        {copilotLogin ? (
          <Alert
            type="info"
            showIcon
            message={`请在浏览器中输入验证码：${copilotLogin.userCode}`}
            description={
              <Space direction="vertical">
                <Typography.Link href={copilotLogin.verificationUri} target="_blank">
                  打开 GitHub 验证页面
                </Typography.Link>
                <Button loading={completingCopilotLogin} onClick={completeCopilotLogin}>
                  我已完成授权
                </Button>
              </Space>
            }
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Space wrap>
          <Button loading={startingCopilotLogin} onClick={beginCopilotLogin}>
            登录 GitHub Copilot
          </Button>
          {copilotConfigured ? (
            <Popconfirm
              title="确定要退出 GitHub Copilot 吗？"
              okText="退出"
              cancelText="取消"
              onConfirm={logoutCopilot}
            >
              <Button danger loading={loggingOutCopilot}>退出登录</Button>
            </Popconfirm>
          ) : null}
        </Space>
      </Card>
      ) : null}

      {selectedProvider === 'apiKey' ? (
      <Card title="API Key（系统凭据存储）" style={{ marginTop: 16 }}>
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
      ) : null}
    </div>
  );
}
