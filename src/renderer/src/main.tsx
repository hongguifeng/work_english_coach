import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import {
  App as AntApp,
  ConfigProvider,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import './styles/app.css';
import App from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found');
}

/**
 * HashRouter（Electron file:// 生产模式的标准做法）：
 * - 生产模式通过 file:// 加载页面，BrowserRouter 的 history API 在 file:// 下不可靠；
 * - HashRouter 的路由信息在 URL hash 中，file:// 与 Vite dev server 下都稳定。
 *
 * future flags（react-router v6.30）：提前采用 v7 行为，
 * 消除 v6 → v7 升级警告（v7_startTransition / v7_relativeSplatPath）。
 */
createRoot(container).render(
  <React.StrictMode>
    <HashRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff' } }}>
        <AntApp>
          <App />
        </AntApp>
      </ConfigProvider>
    </HashRouter>
  </React.StrictMode>,
);
