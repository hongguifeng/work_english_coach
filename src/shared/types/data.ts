/**
 * 数据管理（导出 / 删除）共享类型（T017）。
 *
 * 规则（docs/02 §8、docs/06）：
 * - 这些类型只承载 IPC 边界上的"结果"，不含 Drizzle / 数据库细节，
 *   因此可被主进程、Preload、渲染进程共同引用且不引入运行时依赖。
 * - 导出/删除的详细数据集结构定义在主进程 service（依赖 schema），不放在这里。
 */

/** `data:export` 的结果：文件路径（用户取消时为 null + skipped）。 */
export interface ExportResult {
  /** 写入的 JSON 文件绝对路径；用户取消保存对话框时为 null。 */
  path: string | null;
  /** true 表示用户取消了保存（未写文件）。 */
  skipped: boolean;
}

/** `data:delete-all` 的结果：各学习表删除的行数（settings 表保留）。 */
export interface DeleteSummary {
  communicationSamples: number;
  detectedIssues: number;
  skills: number;
  expressions: number;
  reviewTasks: number;
  reviewAttempts: number;
  /** 六个学习表删除行数之和。 */
  total: number;
  /** ISO 8601 时间戳。 */
  deletedAt: string;
}

/** 主进程在数据变更（目前为"删除全部"）后广播给所有窗口的载荷。 */
export interface DataChangedEvent {
  /** ISO 8601 时间戳（供渲染进程刷新时对齐）。 */
  at: string;
}
