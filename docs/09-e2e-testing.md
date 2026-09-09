# 09 E2E 测试（库页面 CRUD）

## 范围

`tmp-e2e-expressions.mjs`：库页面「新增 / 编辑 / 删除」完整流程 + 数据库断言。

## 引导流程（已验证可重复）

1. 清理：`taskkill /F /IM electron.exe`（WSL 中必须单斜杠，`//F` 是无效参数）；
   按 5173 端口持有者 PID 杀残留 vite（`netstat -ano`，不要按命令行文本匹配——会误杀执行查询的 shell）。
2. 起 vite renderer：`npx vite --config vite.renderer.e2e.mjs`（**必须绑 `127.0.0.1:5173`**，
   `strictPort`）。⚠️ 此机 `localhost` 只解析到 `[::1]`，Electron 会 document 永不 ready。
3. 起 electron（**env 传参，不用 CLI flag**）：
   - `ELECTRON_RENDERER_URL=http://127.0.0.1:5173`
   - `ELECTRON_CDP_PORT=9222` → `src/main/index.ts` 中 `app.commandLine.appendSwitch('remote-debugging-port', ...)`
     （Electron 33 在此 Windows 机器上拒绝 CLI `--remote-debugging-port`）
   - **必须删除子进程 env 中的 `ELECTRON_RUN_AS_NODE` 和 `WSLENV`**（WSL/WSLENV 会从 Windows 侧
     重新注入，使 Electron 退化为纯 Node）
4. 等 CDP **存活**（不只是端口 LISTENING）：每 5s 重新枚举 `/json`，对每个 page target 建 WS
   并 `Runtime.evaluate('location.href')` 验证响应；防止连到僵尸 target 或旧实例。
5. 执行 CRUD：新增 A → 新增 B → 编辑 B → 删除 B → 表格只剩 A → DB 断言（A 在、B 不在）。

## 关键坑（全部实测踩中）

1. **vite 必须 `127.0.0.1`**，不是 `localhost`（本机 localhost 仅 IPv6）。
2. **`Runtime.evaluate` 响应是两层**：`{id, result: { result: { value } }}`，取 `m.result?.result?.value`。
   取错一层 = 所有读取恒 `undefined`，但 `Input.insertText` / `dispatchMouseEvent` 写入不需要响应，
   所以"表单填上了但行检查失败"是这个解析 bug 的典型症状（曾造成"新增后行未出现"的误报）。
3. **`waitUntil` 函数式谓词**：`() => expr` 作为值恒 truthy，必须检测 `() =>` 前缀后显式调用。
4. **单实例锁**：旧 electron 占着 CDP 9222 时新实例会立即退出；必须先杀旧实例；
   启动后还要用存活探测确认拿到的 target 是活的。
5. **E2E 测试数据必须满足 zod 约束**（如 `pattern` 最长 20 字符），否则保存被拒、无行。

## 运行

```
node tmp-e2e-expressions.mjs
```

通过标准：7 步全 PASS + DB 断言 + exit 0。
