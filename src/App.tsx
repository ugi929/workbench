import React, { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Button, ConfigProvider, Layout, Menu, Switch, Tag, theme as antdTheme } from 'antd';
import {
  AimOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  CompressOutlined,
  CopyOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FormOutlined,
  PartitionOutlined,
  RobotOutlined,
  RocketOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import TasksPage from './pages/TasksPage';
import QuadrantPage from './pages/QuadrantPage';
import CalendarPage from './pages/CalendarPage';
import GanttPage from './pages/GanttPage';
import PomodoroPage from './pages/PomodoroPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import LaunchPage from './pages/LaunchPage';
import LaunchWidgetPage from './pages/LaunchWidgetPage';
import WidgetPage from './pages/WidgetPage';
import NoteView from './pages/NoteView';
import AIPage from './pages/AIPage';
import ReportPage from './pages/ReportPage';
import ClipsPage from './pages/ClipsPage';
import SearchPanel from './pages/SearchPanel';
import NotesPage from './pages/NotesPage';
import DockRail, { RailColumn } from './pages/DockRail';
import DockAnim from './pages/DockAnim';
import DockHandle from './pages/DockHandle';
import type { Task, ThemeMode } from '../shared/types';
import { isBrightBg, parseWidgetStyle } from './widgetStyle';

export type PageKey =
  | 'dashboard'
  | 'tasks'
  | 'quadrant'
  | 'calendar'
  | 'gantt'
  | 'pomodoro'
  | 'launch'
  | 'notes'
  | 'clips'
  | 'ai'
  | 'report'
  | 'settings'
  | 'widget'
  | 'launch-widget'
  | 'note'
  | 'search'
  | 'rail'
  | 'dockanim'
  | 'handle';

const PAGE_HASH: Record<PageKey, string> = {
  dashboard: '#/dashboard',
  tasks: '#/tasks',
  quadrant: '#/quadrant',
  calendar: '#/calendar',
  gantt: '#/gantt',
  pomodoro: '#/pomodoro',
  launch: '#/launch',
  notes: '#/notes',
  clips: '#/clips',
  ai: '#/ai',
  report: '#/report',
  settings: '#/settings',
  widget: '#/widget',
  'launch-widget': '#/launch-widget',
  note: '#/note',
  search: '#/search',
  rail: '#/rail',
  dockanim: '#/dockanim',
  handle: '#/handle',
};

function initialPage(): PageKey {
  const h = window.location.hash;
  if (h.startsWith('#/launch-widget')) return 'launch-widget';
  if (h.startsWith('#/widget')) return 'widget';
  if (h.startsWith('#/note/')) return 'note';
  if (h.startsWith('#/search')) return 'search';
  if (h.startsWith('#/rail')) return 'rail';
  if (h.startsWith('#/dockanim')) return 'dockanim';
  if (h.startsWith('#/handle')) return 'handle';
  for (const key of Object.keys(PAGE_HASH) as PageKey[]) {
    if (h.startsWith(PAGE_HASH[key])) return key;
  }
  return 'dashboard';
}

const MAIN_ITEMS = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '总览' },
  { key: 'tasks', icon: <UnorderedListOutlined />, label: '任务列表' },
  { key: 'quadrant', icon: <AimOutlined />, label: '四象限' },
  { key: 'calendar', icon: <CalendarOutlined />, label: '日历' },
  { key: 'gantt', icon: <PartitionOutlined />, label: '甘特图' },
  { key: 'pomodoro', icon: <ClockCircleOutlined />, label: '番茄钟' },
  { key: 'launch', icon: <RocketOutlined />, label: '快捷启动' },
  { key: 'notes', icon: <FormOutlined />, label: '便签' },
  { key: 'clips', icon: <CopyOutlined />, label: '剪贴板' },
  { key: 'report', icon: <FileTextOutlined />, label: '报告' },
  { key: 'ai', icon: <RobotOutlined />, label: 'AI 助手' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];

function WorkbenchApp() {
  const { message } = AntApp.useApp();
  const [page, setPage] = useState<PageKey>(initialPage);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataDir, setDataDir] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [railSide, setRailSide] = useState('left');
  const [railPanelPage, setRailPanelPage] = useState<PageKey | null>(null);
  const [edgeDockOn, setEdgeDockOn] = useState(true);
  // 小组件背景是深是浅：决定窗内 antd 组件（快速添加输入框）用深色还是浅色算法，
  // 与用户设的背景色保持一致，避免浅底小组件里塞一个深色输入框。
  const [widgetTone, setWidgetTone] = useState<'light' | 'dark'>('dark');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await window.api.listTasks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void window.api.getAppInfo().then((info) => setDataDir(info.dataDir));
    void window.api.getSettings().then((s) => {
      if (s.theme === 'dark') {
        setThemeMode('dark');
        void window.api.setTitleBar(true);
      }
      setEdgeDockOn(s.edgeDock !== '0');
    });
  }, [reload]);

  // 设置页改了「贴边自动折叠」后，重新读取，决定标题栏「收缩」按钮是否显示
  useEffect(() => {
    void window.api.getSettings().then((s) => setEdgeDockOn(s.edgeDock !== '0'));
  }, [settingsRevision]);

  // 小组件窗口：跟随「桌面小组件」外观设置切换 antd 深/浅算法，并订阅变更
  useEffect(() => {
    if (page !== 'widget' && page !== 'launch-widget') return;
    const sync = async () => {
      const s = await window.api.getSettings();
      setWidgetTone(isBrightBg(parseWidgetStyle(s).bgColor) ? 'light' : 'dark');
    };
    void sync();
    return window.api.onSettingsChanged((key) => {
      if (key === 'widgetBgColor' || key === 'widgetBgOpacity') void sync();
    });
  }, [page]);

  useEffect(() => {
    if (page === 'widget' || page === 'launch-widget' || page === 'note' || page === 'search' || page === 'rail' || page === 'dockanim' || page === 'handle') return;
    if (!window.location.hash.startsWith(PAGE_HASH[page])) window.location.hash = PAGE_HASH[page];
  }, [page]);

  useEffect(() => {
    const onHash = () => {
      const p = initialPage();
      if (p === 'rail') {
        // 导航栏窗口：同步停靠边与面板页
        const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
        setRailSide(q.get('side') ?? 'left');
        const pg = q.get('page') as PageKey | null;
        setRailPanelPage(pg && (MAIN_ITEMS as { key: string }[]).some((i) => i.key === pg) ? pg : null);
        return;
      }
      if (p !== 'widget' && p !== 'launch-widget' && p !== 'note' && p !== 'search' && p !== 'dockanim' && p !== 'handle') setPage(p);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    // 停靠窗口没有 .app-shell 容器，把主题挂到 html 上，让 CSS 变量（卡片/页面底色）也跟着切换
    if (page !== 'rail' && page !== 'handle') return;
    if (themeMode === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
  }, [page, themeMode]);

  const changeTheme = (dark: boolean) => {
    const next: ThemeMode = dark ? 'dark' : 'light';
    setThemeMode(next);
    void window.api.setSetting('theme', next).catch(() => message.warning('主题偏好保存失败'));
    void window.api.setTitleBar(dark);
  };

  const menuProps = {
    mode: 'inline' as const,
    selectedKeys: [page],
    onClick: ({ key }: { key: string }) => {
      if ((MAIN_ITEMS as { key: string }[]).some((i) => i.key === key)) setPage(key as PageKey);
    },
    items: [...MAIN_ITEMS],
  };

  const pageProps = { tasks, loading, reload };
  const dark = themeMode === 'dark';

  if (page === 'widget') {
    return (
      <ConfigProvider
        theme={{
          algorithm: widgetTone === 'light' ? antdTheme.defaultAlgorithm : antdTheme.darkAlgorithm,
          token: { colorPrimary: '#4c6ef5', borderRadius: 6 },
        }}
      >
        <WidgetPage />
      </ConfigProvider>
    );
  }
  if (page === 'launch-widget') {
    return (
      <ConfigProvider
        theme={{
          algorithm: widgetTone === 'light' ? antdTheme.defaultAlgorithm : antdTheme.darkAlgorithm,
          token: { colorPrimary: '#4c6ef5', borderRadius: 6 },
        }}
      >
        <LaunchWidgetPage />
      </ConfigProvider>
    );
  }
  if (page === 'rail') {
    const openPage = (k: PageKey) => void window.api.dockPanel(k);
    const renderRailPage = (k: PageKey): React.ReactNode => {
      switch (k) {
        case 'dashboard':
          return <DashboardPage {...pageProps} />;
        case 'tasks':
          return <TasksPage {...pageProps} />;
        case 'quadrant':
          return <QuadrantPage {...pageProps} />;
        case 'calendar':
          return <CalendarPage {...pageProps} />;
        case 'gantt':
          return <GanttPage {...pageProps} />;
        case 'pomodoro':
          return <PomodoroPage tasks={tasks} settingsRevision={settingsRevision} />;
        case 'launch':
          return <LaunchPage />;
        case 'notes':
          return <NotesPage />;
        case 'clips':
          return <ClipsPage />;
        case 'report':
          return <ReportPage />;
        case 'ai':
          return <AIPage onTasksChanged={() => void reload()} />;
        case 'settings':
          return (
            <SettingsPage
              themeMode={themeMode}
              onThemeChange={changeTheme}
              onSaved={() => setSettingsRevision((r) => r + 1)}
            />
          );
        default:
          return null;
      }
    };
    return (
      <ConfigProvider
        theme={{
          algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: { colorPrimary: '#4c6ef5', borderRadius: 6 },
        }}
      >
        {railPanelPage ? (
          <div className="dock-panel">
            <RailColumn
              side={railSide}
              active={railPanelPage}
              onOpen={openPage}
              onExpand={() => void window.api.dockExpand()}
            />
            <div className="dock-panel-content">{renderRailPage(railPanelPage)}</div>
          </div>
        ) : (
          <DockRail
            side={railSide}
            active={null}
            onOpen={openPage}
            onExpand={() => void window.api.dockExpand()}
          />
        )}
      </ConfigProvider>
    );
  }

  if (page === 'handle') {
    return (
      <ConfigProvider
        theme={{
          algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: { colorPrimary: '#4c6ef5', borderRadius: 6 },
        }}
      >
        <DockHandle />
      </ConfigProvider>
    );
  }

  if (page === 'note' || page === 'search' || page === 'dockanim') {
    return (
      <ConfigProvider
        theme={{
          algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: { colorPrimary: '#4c6ef5', borderRadius: 6 },
        }}
      >
        {page === 'note' ? <NoteView /> : page === 'search' ? <SearchPanel /> : <DockAnim />}
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#4c6ef5', borderRadius: 6 },
      }}
    >
      <Layout className="app-shell" data-theme={themeMode}>
        <div className="app-titlebar">
          <span className="app-titlebar-title">🗂️ 工作台</span>
          {edgeDockOn && (
            <button
              className="titlebar-collapse"
              title="收起到屏幕边缘（折叠成贴边图标栏）"
              onClick={() => void window.api.dockCollapse()}
            >
              <CompressOutlined />
              <span>收缩</span>
            </button>
          )}
        </div>
        <Layout className="app-body">
          <Layout.Sider width={208} theme="light" className="app-sider">
            <Menu className="sider-menu" {...menuProps} />
            <div className="sider-footer">
              <div className="sider-footer-row">
                <span>🌙 深色模式</span>
                <Switch size="small" checked={dark} onChange={changeTheme} />
              </div>
              <Button
                type="text"
                size="small"
                block
                icon={<FolderOpenOutlined />}
                onClick={() => dataDir && void window.api.openPath(dataDir)}
              >
                打开数据文件夹
              </Button>
            </div>
          </Layout.Sider>
          <Layout.Content style={{ minWidth: 0 }}>
          {page === 'dashboard' && <DashboardPage {...pageProps} />}
          {page === 'tasks' && <TasksPage {...pageProps} />}
          {page === 'quadrant' && <QuadrantPage {...pageProps} />}
          {page === 'calendar' && <CalendarPage {...pageProps} />}
          {page === 'gantt' && <GanttPage {...pageProps} />}
          {page === 'launch' && <LaunchPage />}
          {page === 'notes' && <NotesPage />}
          {page === 'clips' && <ClipsPage />}
          {page === 'report' && <ReportPage />}
          {page === 'ai' && <AIPage onTasksChanged={() => void reload()} />}
          {page === 'settings' && (
            <SettingsPage
              themeMode={themeMode}
              onThemeChange={changeTheme}
              onSaved={() => setSettingsRevision((r) => r + 1)}
            />
          )}
          {/* 番茄钟常驻挂载：切换页面时计时不中断，仅隐藏 */}
          <div style={{ display: page === 'pomodoro' ? 'block' : 'none', height: '100%' }}>
            <PomodoroPage tasks={tasks} settingsRevision={settingsRevision} />
          </div>
        </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default WorkbenchApp;
