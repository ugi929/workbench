import React, { useEffect, useState } from 'react';
import {
  CloseOutlined,
  FolderOutlined,
  LinkOutlined,
  SettingOutlined,
  WindowsOutlined,
} from '@ant-design/icons';
import type { LaunchItem, LaunchType } from '../../shared/types';
import { initWidgetStyle } from '../widgetStyle';

const TYPE_META: Record<LaunchType, { label: string; icon: React.ReactNode; color: string }> = {
  folder: { label: '文件夹', icon: <FolderOutlined />, color: '#faad14' },
  url: { label: '网页', icon: <LinkOutlined />, color: '#4c6ef5' },
  app: { label: '软件', icon: <WindowsOutlined />, color: '#52c41a' },
};

// 桌面小组件：以「快捷启动」形式展示启动项，点击图标即打开对应目标。
// 由全局热键 Alt+L 呼出（见 electron/launchWidget.ts）。
export default function LaunchWidgetPage() {
  const [items, setItems] = useState<LaunchItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = React.useCallback(async () => {
    try {
      setItems(await window.api.launchList());
    } catch {
      // 小组件静默重试
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    void load();
    const t = setInterval(() => void load(), 30000);
    // 背景色 / 不透明度来自设置页，并订阅变更实时刷新
    let off: (() => void) | null = null;
    let disposed = false;
    void initWidgetStyle().then((fn) => {
      if (disposed) fn();
      else off = fn;
    });
    return () => {
      disposed = true;
      clearInterval(t);
      off?.();
    };
  }, [load]);

  const open = async (it: LaunchItem) => {
    try {
      await window.api.launchOpen(it.id);
    } catch {
      // 小组件不弹错误提示
    }
  };

  return (
    <div className="widget-root">
      <div className="widget-card">
        <div className="widget-head">
          <span className="widget-date">快捷启动</span>
          <span className="widget-head-btns">
            <button
              className="widget-btn"
              title="管理启动项"
              onClick={() => void window.api.showMain('launch')}
            >
              <SettingOutlined />
            </button>
            <button className="widget-btn" title="关闭" onClick={() => window.close()}>
              <CloseOutlined />
            </button>
          </span>
        </div>

        <div className="lw-body">
          {loaded && items.length === 0 && (
            <div className="widget-empty">还没有启动项，点右上角「管理」添加</div>
          )}
          <div className="lw-grid">
            {items.map((it) => {
              const meta = TYPE_META[it.type] ?? TYPE_META.url;
              return (
                <button
                  key={it.id}
                  className="lw-item"
                  title={`${meta.label} · ${it.target}`}
                  onClick={() => void open(it)}
                >
                  <span className="lw-icon" style={{ background: meta.color }}>
                    {meta.icon}
                  </span>
                  <span className="lw-name">{it.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="widget-foot">
          <span>共 {items.length} 个启动项</span>
          <span>点击即打开</span>
        </div>
      </div>
    </div>
  );
}
