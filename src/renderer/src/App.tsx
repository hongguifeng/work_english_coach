import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  AlertOutlined,
  AppstoreOutlined,
  AudioOutlined,
  BarChartOutlined,
  BookOutlined,
  CompassOutlined,
  HistoryOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Layout, Menu, Typography } from 'antd';
import WorkspacePage from './pages/WorkspacePage';
import TrainingPage from './pages/TrainingPage';
import LibraryPage from './pages/LibraryPage';
import ErrorArchivePage from './pages/ErrorArchivePage';
import StatisticsPage from './pages/StatisticsPage';
import RecordingPage from './pages/RecordingPage';
import SettingsPage from './pages/SettingsPage';
import HistoryPage from './pages/HistoryPage';

const { Sider, Header, Content } = Layout;

/** 路由 → 菜单项/标题/描述（T007：顶部标题区域随路由联动；描述显示在标题下一行以省空间） */
type NavItem = { key: string; icon: ReactNode; title: string; description?: string };
const NAV_ITEMS: NavItem[] = [
  { key: '/', icon: <CompassOutlined />, title: '工作区' },
  { key: '/history', icon: <HistoryOutlined />, title: '历史记录', description: '查看之前每次工作英语检查的 AI 分析结果。' },
  { key: '/today', icon: <AppstoreOutlined />, title: '今日训练' },
  { key: '/expressions', icon: <BookOutlined />, title: '表达库', description: '把 AI 纠错中沉淀的高频表达与手动整理的常用表达放在一起，随时查阅、复习、归档。' },
  { key: '/errors', icon: <AlertOutlined />, title: '错误档案', description: '按知识点聚合的历史错误；掌握状态只由你的独立练习结果决定。' },
  { key: '/stats', icon: <BarChartOutlined />, title: '学习统计' },
  { key: '/record', icon: <AudioOutlined />, title: '录音' },
  { key: '/settings', icon: <SettingOutlined />, title: '设置', description: 'AI 服务与数据管理。API Key 由系统凭据存储保管；AI 配置持久化到本地数据库；「测试连接」发起真实最小 AI 调用。' },
];

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
  const currentNav = NAV_ITEMS.find((item) => item.key === selectedKey) ?? NAV_ITEMS[0];

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 左侧导航：固定在布局外层，页面切换时不参与重排，避免闪烁 */}
      <Sider width={160} theme="light" style={{ borderInlineEnd: '1px solid #f0f0f0' }}>
        <div style={{ padding: '20px 16px 12px' }}>
          <Typography.Title level={4} style={{ margin: 0, fontSize: 15, lineHeight: '22px', whiteSpace: 'nowrap' }}>
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
        {/* 顶部标题区域：标题 + 描述两行（描述放在标题下一行，省掉正文区一行描述的空间） */}
        <Header
          style={{
            background: '#fff',
            padding: '8px 24px',
            minHeight: 56,
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          {/* 品牌名已由左侧导航显示，这里只留当前页面标题（避免重复） */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <Typography.Text strong style={{ fontSize: 15, lineHeight: '20px' }}>
              {currentNav.title}
            </Typography.Text>
            {currentNav.description ? (
              <Typography.Text type="secondary" ellipsis style={{ fontSize: 12, lineHeight: '16px', marginTop: 2 }}>
                {currentNav.description}
              </Typography.Text>
            ) : null}
          </div>
        </Header>

        <Content className="wec-content" style={{ padding: 24 }}>
          <div className="wec-content-inner">
            <Routes>
              <Route path="/" element={<WorkspacePage />} />
              <Route path="/today" element={<TrainingPage />} />
              <Route path="/expressions" element={<LibraryPage />} />
              <Route path="/errors" element={<ErrorArchivePage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/stats" element={<StatisticsPage />} />
              <Route path="/record" element={<RecordingPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
