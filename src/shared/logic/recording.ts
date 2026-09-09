// T034 — 录音纯逻辑（共享层，渲染/主进程/测试共用）
//
// 安全规则（docs/01、docs/08 T034）：
// - 录音 id 只允许 UUID 形态（十六进制 + 连字符），主进程写盘/删除前必须校验，
//   防止路径穿越（如 ../../x）。
// - 时长格式化固定 MM:SS（超过 99:59 显示为 99:59+，避免布局跳动）。

/** 校验录音 id 是否安全（可安全拼进文件路径）。 */
export function isSafeRecordingId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** 毫秒 → 'MM:SS'（至少 00:00；封顶 99:59）。 */
export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.min(99, Math.floor(total / 60));
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
