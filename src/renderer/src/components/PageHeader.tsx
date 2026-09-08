import type { ReactNode } from 'react';
import { Typography } from 'antd';

export interface PageHeaderProps {
  title: string;
  description?: string;
  extra?: ReactNode;
}

/**
 * 页面头部：标题 + 描述 + 右侧操作区
 * 所有页面统一使用，保证布局一致、切换不闪烁（T007）
 */
export function PageHeader({ title, description, extra }: PageHeaderProps) {
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
      <div style={{ minWidth: 0 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
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
