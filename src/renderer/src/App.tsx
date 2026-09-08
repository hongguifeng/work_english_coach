import { useMemo } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  AlertOutlined,
  AppstoreOutlined,
  BookOutlined,
  CompassOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Layout, Menu, Typography } from 'antd';
import WorkspacePage from './pages/WorkspacePage';
import TrainingPage from './pages/TrainingPage';
import LibraryPage from './pages/LibraryPage';
import ErrorArchivePage from './pages/ErrorArchivePage';
import SettingsPage from './pages/SettingsPage';

const { Sider, Header, Content } = Layout;

/** 路由 → 菜单项/标题（T007：顶部标题区域随路由联动） */
const NAV_ITEMS = [
  { key: '/', icon: <CompassOutlined />, title: '工作区' },
  { key: '/today', icon: <AppstoreOutlined />, title: '今日训练' },
  { key: '/expressions', icon: <BookOutlined />, title: '表达库' },
  { key: '/errors', icon: <AlertOutlined />, title: '错误档案' },
  { key: '/settings', icon: <SettingOutlined />, title: '设置' },
] as const;

const menuItems = NAV_ITEMS.map((item) => ({
  key: item.key,
  icon: item.icon,
  label: <Link to={item.key}>{item.title}</Link>,
}));

/** 应用壳（T007）：左侧导航 + 顶部标题 + 内容区（<Routes> 渲染各页面） */
/** 找到当前路由对应的导航项（最长前缀匹配，'/' 精确匹配） */
function matchNavKey(pathname: string): string {
  const candidates = NAV_ITEMS.map((item) => item.key).filter(
    (key) => (key === '/' ? pathname === '/' : pathname.startsWith(key)),
  );
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? '/';
}

export default function App() {
  const location = useLocation();
  const selectedKey = useMemo(() => matchNavKey(location.pathname), [location.pathname]);
  const currentTitle = NAV_ITEMS.find((item) => item.key === selectedKey)?.title ?? '工作区';

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 左侧导航：固定在布局外层，页面切换时不参与重排，避免闪烁 */}
      <Sider width={220} theme="light" style={{ borderInlineEnd: '1px solid #f0f0f0' }}>
        <div style={{ padding: '20px 16px 12px' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            WorkEnglish Coach
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            工作英语教练
          </Typography.Text>
        </div>
        <Menu
          theme="light"
          mode="inline"
          items={menuItems}
          selectedKeys={[selectedKey]}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>

      <Layout>
        {/* 顶部标题区域：显示当前页面名称 */}
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            height: 56,
            lineHeight: '56px',
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Typography.Text type="secondary" style={{ marginRight: 12, fontSize: 13 }}>
            WorkEnglish Coach
          </Typography.Text>
          <Typography.Text strong style={{ fontSize: 15 }}>
            {currentTitle}
          </Typography.Text>
        </Header>

        <Content className="wec-content" style={{ padding: 24 }}>
          <div className="wec-content-inner">
            <Routes>
              <Route path="/" element={<WorkspacePage />} />
              <Route path="/today" element={<TrainingPage />} />
              <Route path="/expressions" element={<LibraryPage />} />
              <Route path="/errors" element={<ErrorArchivePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
