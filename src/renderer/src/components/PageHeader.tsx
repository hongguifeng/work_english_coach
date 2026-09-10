import type { ReactNode } from 'react';
import { Typography } from 'antd';

export interface PageHeaderProps {
  description?: string;
  extra?: ReactNode;
}

/**
 * 页面头部：描述 + 右侧操作区。
 * 页面标题由顶部 Header 栏统一显示（避免重复占空间）；
 * 本页只保留一行描述（可选）和操作按钮，尽量压缩垂直空间（T007 后续调整）。
 */
export function PageHeader({ description, extra }: PageHeaderProps) {
  if (!description && !extra) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 16,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        {description ? (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {description}
          </Typography.Text>
        ) : null}
      </div>
      {extra ? <div style={{ flexShrink: 0 }}>{extra}</div> : null}
    </div>
  );
}
