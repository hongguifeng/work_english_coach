# WorkEnglish Coach 技术设计文档

## 1. 技术选型

### 1.1 技术栈

- Electron
- React
- TypeScript
- Vite
- Ant Design
- Zustand
- React Router
- SQLite
- Drizzle ORM
- Zod
- Axios 或原生 fetch
- electron-store，仅用于少量配置
- keytar，用于保存 Windows API Key
- Vitest
- Playwright，可选
- ESLint
- Prettier

### 1.2 推荐版本策略

使用当前稳定版本，但项目必须锁定依赖版本。

初始化时使用：

- Node.js LTS
- npm
- TypeScript strict mode

暂时不要同时引入过多 UI 组件库。第一版统一使用 Ant Design。

---

## 2. Electron 进程架构

### 2.1 Main Process

负责：

- 创建 BrowserWindow。
- 管理应用生命周期。
- 管理数据库。
- 调用 AI 服务。
- 读取和保存 API 配置。
- 管理文件导入导出。
- 管理系统级快捷键。
- 管理系统通知，可选。

### 2.2 Renderer Process

负责：

- React 页面。
- 用户交互。
- 表单。
- 加载状态。
- 错误提示。
- 数据展示。

Renderer 不允许直接：

- 访问 Node.js API。
- 读取文件系统。
- 访问数据库。
- 读取 API Key。
- 发起未经过 IPC 的外部网络请求。

### 2.3 Preload

负责：

- 暴露严格定义的 IPC API。
- 不暴露完整的 ipcRenderer。
- 不暴露完整的 Node.js 能力。
- 对输入参数进行基础校验。

示例：

```ts
contextBridge.exposeInMainWorld('desktopAPI', {
  analyzeDraft: (input) => ipcRenderer.invoke('ai:analyze-draft', input),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  listReviewTasks: () => ipcRenderer.invoke('review:list'),
  submitReviewTask: (input) => ipcRenderer.invoke('review:submit', input),
});
```

禁止：

```ts
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer
});
```

---

## 3. 推荐目录结构

```text
src/
├── main/
│   ├── index.ts
│   ├── windows/
│   │   └── createMainWindow.ts
│   ├── ipc/
│   │   ├── registerAiHandlers.ts
│   │   ├── registerReviewHandlers.ts
│   │   ├── registerSettingsHandlers.ts
│   │   └── registerDataHandlers.ts
│   ├── ai/
│   │   ├── AiClient.ts
│   │   ├── OpenAICompatibleClient.ts
│   │   ├── prompts/
│   │   └── schemas/
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema.ts
│   │   ├── migrations/
│   │   └── repositories/
│   ├── security/
│   │   ├── secretStore.ts
│   │   └── redact.ts
│   └── services/
│       ├── ReviewService.ts
│       ├── LearningService.ts
│       └── SettingsService.ts
│
├── preload/
│   ├── index.ts
│   └── api.ts
│
├── renderer/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/
│   ├── pages/
│   │   ├── WorkspacePage/
│   │   ├── ReviewPage/
│   │   ├── LibraryPage/
│   │   └── SettingsPage/
│   ├── components/
│   ├── stores/
│   ├── hooks/
│   ├── services/
│   └── styles/
│
├── shared/
│   ├── types/
│   ├── schemas/
│   ├── constants/
│   └── utils/
│
tests/
├── unit/
├── integration/
└── fixtures/

docs/
```

---

## 4. IPC 设计原则

1. IPC channel 使用统一命名：
   - `ai:analyze-draft`
   - `ai:generate-review`
   - `review:list`
   - `review:submit`
   - `library:list`
   - `library:create`
   - `settings:get`
   - `settings:save`

2. 每个 IPC handler：
   - 校验输入。
   - 捕获异常。
   - 返回统一结果。
   - 不返回敏感配置。

3. 统一返回格式：

```ts
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: AppError };
```

4. 错误结构：

```ts
type AppError = {
  code: string;
  message: string;
  userMessage: string;
  retryable?: boolean;
};
```

---

## 5. AI 服务设计

应用应支持 OpenAI 兼容接口：

配置：

```ts
type AiConfig = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
};
```

API Key 通过 secretStore 获取，不在 Renderer 中暴露。

AI 客户端必须实现接口：

```ts
interface AiClient {
  analyzeDraft(input: AnalyzeDraftInput): Promise<AnalyzeDraftResult>;
  generateReview(input: GenerateReviewInput): Promise<GeneratedReview>;
  evaluateReview(input: EvaluateReviewInput): Promise<ReviewEvaluation>;
}
```

后续如果更换服务商，只实现新的 Client，不修改业务层。

---

## 6. AI 调用流程

```text
Renderer 提交表单
    ↓
Preload IPC
    ↓
Main Process Handler
    ↓
Zod 校验
    ↓
脱敏处理（如果开启）
    ↓
组装 Prompt
    ↓
调用 AiClient
    ↓
解析 JSON
    ↓
Zod 校验 AI 输出
    ↓
保存知识点、错误和样本
    ↓
返回 Renderer
```

模型输出不可信，必须经过：

1. JSON 提取。
2. Zod schema 校验。
3. 字段默认值补全。
4. 错误处理。
5. 必要时重试一次。

---

## 7. 安全要求

Electron BrowserWindow 配置：

```ts
{
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true
}
```

其他要求：

- 禁止使用 `eval`。
- 禁止在 Renderer 使用 Node.js。
- 外部链接使用系统浏览器打开，并进行协议限制。
- 不允许任意导航到外部页面。
- IPC 参数必须校验。
- API Key 不进入前端状态管理。
- 日志中对 API Key、工作文本进行脱敏。
- 生产环境关闭 DevTools，或提供设置项控制。

---

## 8. 数据策略

由于本应用主要自己使用：

- 默认使用本地 SQLite。
- 默认不启用云同步。
- 默认不保存完整原文，除非用户主动开启。
- AI 返回的知识点和练习内容可以保存。
- 所有数据放在 Electron `app.getPath('userData')` 下。
- 提供 JSON 导出和数据删除。

---

## 9. 日志策略

日志允许记录：

- 时间。
- 功能名称。
- 请求耗时。
- 错误码。
- 模型名称。
- 字数统计。

日志禁止记录：

- API Key。
- 完整邮件。
- 完整聊天内容。
- 客户姓名。
- 公司机密。
- 完整 AI Prompt。

调试环境可以通过显式配置开启更多日志，但生产默认关闭。
