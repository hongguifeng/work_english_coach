// T034 — 录音相关共享类型
//
// 隐私原则（docs/08 T034）：不默认永久保存音频。
// 磁盘录音默认不保存；用户主动勾选后才写入临时目录（userData/.../recordings），
// 且启动时自动清理超过 7 天的文件，用户也可随时手动删除。

/** 麦克风权限状态（渲染进程视角）。 */
export type RecordingPermissionState =
  | 'unknown' // 尚未探测
  | 'granted' // 可用
  | 'denied' // 用户/系统拒绝
  | 'unavailable'; // 无 mediaDevices（环境不支持）

/** 已落盘录音的元信息（不含音频内容）。 */
export interface RecordingSavedView {
  /** UUID（安全格式，可用于删除）。 */
  id: string;
  /** 文件完整路径（仅展示；主进程已保证位于录音临时目录内）。 */
  path: string;
  /** 文件大小（字节）。 */
  sizeBytes: number;
  /** MIME（如 audio/webm）。 */
  mimeType: string;
  /** ISO 时间（落盘时刻）。 */
  createdAt: string;
}

/** 权限探测结果（渲染进程 → 仅用于 UI 展示）。 */
export interface PermissionProbeResult {
  state: RecordingPermissionState;
  /** denied 时的可读原因（如 NotAllowedError）。 */
  reason?: string;
}
