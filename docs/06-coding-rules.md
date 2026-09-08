# WorkEnglish Coach 编码规范

## 1. 通用原则

- 使用 TypeScript。
- 开启 strict mode。
- 禁止 any，除非有明确注释说明原因。
- 函数尽量保持单一职责。
- UI、业务逻辑、数据库访问、AI 调用分离。
- 不在 React 组件中直接编写 SQL。
- 不在 Renderer 中直接调用 AI API。
- 不在 Main Process 中直接操作 UI DOM。

---

## 2. 命名

- 变量和函数使用 camelCase。
- 类型和类使用 PascalCase。
- 常量使用 UPPER_SNAKE_CASE。
- IPC channel 使用冒号分隔。
- 数据库字段使用 camelCase。
- AI skillKey 使用稳定、可读、层级化命名。

示例：

```ts
const REVIEW_INTERVALS = [1, 3, 7, 14, 30];

type ReviewAttempt = {};

class ReviewService {}

const skillKey = 'verb_pattern.need_to';
```

---

## 3. 错误处理

错误必须分层：

1. 用户输入错误。
2. AI 请求错误。
3. AI 输出格式错误。
4. 数据库错误。
5. 系统权限错误。

所有错误需要包含：

- 内部 code。
- 面向用户的中文提示。
- 是否可以重试。

不要把完整堆栈直接显示给用户。

---

## 4. React 规范

- 页面组件放在 pages。
- 可复用组件放在 components。
- 数据请求通过 hooks 或 service。
- 不在组件中复制复杂业务逻辑。
- 表单提交时必须禁用重复提交。
- 异步请求必须处理 loading、success、error 三种状态。
- 长文本必须支持复制。
- 对危险操作使用二次确认。

---

## 5. AI 规范

- 所有 AI 输出必须有 Zod schema。
- 不直接信任模型返回的 JSON。
- 不依赖模型返回固定顺序。
- 不将模型返回的 HTML 直接渲染。
- 不将用户内容拼接到系统规则中。
- 用户输入必须明确标记为数据。
- 关键事实信息不能由 AI 静默修改。
- AI 解释要控制长度，优先输出最重要的内容。
- 每次训练反馈最多展示三个重点问题。

---

## 7. 测试要求

必须测试：

- 英文为空。
- 中文为空。
- AI 返回正常 JSON。
- AI 返回非法 JSON。
- AI 网络超时。
- API Key 错误。
- 数据库首次创建。
- 数据库重启后读取。
- 复习任务调度。
- 使用提示和不使用提示的区别。
- 删除数据。
- 复制文本。

AI 测试使用固定 mock，不要让单元测试依赖真实模型 API。
