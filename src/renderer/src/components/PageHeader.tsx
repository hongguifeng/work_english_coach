import type { ReactNode } from 'react';

export interface PageHeaderProps {
  extra?: ReactNode;
}

/**
 * 页面操作区：只保留右侧按钮（刷新/恢复默认等）。
 * 页面标题由顶部 Header 栏统一显示，描述显示在 Header 标题下一行（T007 后续调整，压缩垂直空间）。
 */
export function PageHeader({ extra }: PageHeaderProps) {
  if (!extra) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginBottom: 16 }}>
      <div>{extra}</div>
    </div>
  );
}
