import React, { useEffect, useRef, useState } from 'react';
import {
  AimOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DashboardOutlined,
  ExpandAltOutlined,
  FileTextOutlined,
  FormOutlined,
  PartitionOutlined,
  RobotOutlined,
  RocketOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import type { PageKey } from '../App';

export const RAIL_ITEMS: { key: PageKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: '总览', icon: <DashboardOutlined /> },
  { key: 'tasks', label: '任务', icon: <UnorderedListOutlined /> },
  { key: 'quadrant', label: '四象限', icon: <AimOutlined /> },
  { key: 'calendar', label: '日历', icon: <CalendarOutlined /> },
  { key: 'gantt', label: '甘特图', icon: <PartitionOutlined /> },
  { key: 'pomodoro', label: '番茄钟', icon: <ClockCircleOutlined /> },
  { key: 'launch', label: '启动', icon: <RocketOutlined /> },
  { key: 'notes', label: '便签', icon: <FormOutlined /> },
  { key: 'clips', label: '剪贴板', icon: <CopyOutlined /> },
  { key: 'report', label: '报告', icon: <FileTextOutlined /> },
  { key: 'ai', label: 'AI', icon: <RobotOutlined /> },
  { key: 'settings', label: '设置', icon: <SettingOutlined /> },
];

const readSide = (): string =>
  new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('side') ?? 'left';

interface RailProps {
  side: string;
  active?: PageKey | null;
  onOpen: (key: PageKey) => void;
  onExpand: () => void;
}

/** 图标列：顶部为抓手（拖动可沿边缘移动），底部为「展开完整窗口」 */
export function RailColumn({ side, active, onOpen, onExpand }: RailProps) {
  const dragging = useRef(false);

  const onGripMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.screenX;
    const startY = e.screenY;
    dragging.current = false;
    const move = (ev: MouseEvent) => {
      if (!dragging.current && (Math.abs(ev.screenX - startX) > 3 || Math.abs(ev.screenY - startY) > 3)) {
        dragging.current = true;
      }
      if (dragging.current) void window.api.railDragTo({ x: ev.screenX, y: ev.screenY });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (dragging.current) void window.api.railDragEnd();
      dragging.current = false;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className={`dock-rail-col col-${side}`}>
      <div className="dock-rail-head" title="按住拖动，可沿屏幕边缘调整位置" onMouseDown={onGripMouseDown}>
        <i />
        <i />
        <i />
      </div>
      <div className="dock-rail-list">
        {RAIL_ITEMS.map((it) => (
          <button
            key={it.key}
            type="button"
            className={`dock-rail-item${active === it.key ? ' active' : ''}`}
            title={it.label}
            onClick={() => onOpen(it.key)}
          >
            <span className="dock-rail-icon">{it.icon}</span>
            <span className="dock-rail-label">{it.label}</span>
          </button>
        ))}
      </div>
      <div className="dock-rail-foot">
        <button type="button" title="展开完整窗口" onClick={onExpand}>
          <ExpandAltOutlined />
          <span>展开</span>
        </button>
      </div>
    </div>
  );
}

// 停靠半露/悬停状态：整个窗口就是一条图标栏
export default function DockRail(props: RailProps) {
  const [side, setSide] = useState<string>(readSide);

  useEffect(() => {
    // 导航栏窗口为不透明深色底（透明窗口在 Windows 有隐形/穿透坑）
    document.body.style.background = '#15171d';
    document.documentElement.style.background = '#15171d';
    const onHash = () => setSide(readSide());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // 顶部停靠：量出「恰好装下全部菜单项」的自然宽度回报给主进程，
  // 主进程据此把图标栏收缩成一条（而不是铺满整个屏幕宽度），并保持以把手为中心。
  useEffect(() => {
    if (side !== 'top') return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const col = document.querySelector('.dock-rail-col');
      const head = col?.querySelector('.dock-rail-head');
      const list = col?.querySelector('.dock-rail-list');
      const foot = col?.querySelector('.dock-rail-foot');
      if (!col || !head || !list || !foot) return;
      const cs = getComputedStyle(list);
      const gap = parseFloat(cs.columnGap || cs.gap) || 0;
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const items = Array.from(list.children) as HTMLElement[];
      const inner =
        items.reduce((s, el) => s + el.getBoundingClientRect().width, 0) +
        gap * Math.max(0, items.length - 1) +
        pad;
      const total = Math.ceil(
        head.getBoundingClientRect().width + inner + foot.getBoundingClientRect().width,
      );
      if (total > 0) void window.api.dockRailFit(total);
    };
    const raf = requestAnimationFrame(measure);
    const t1 = window.setTimeout(measure, 150);
    // 字体/图标就绪后宽度会略有变化，再量一次收尾
    const t2 = window.setTimeout(measure, 600);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [side]);

  return (
    <div
      className={`dock-rail${side === 'top' ? ' dock-top' : ''}`}
      onMouseEnter={() => void window.api.dockPeekIn()}
      onMouseLeave={() => void window.api.dockPeekOut()}
    >
      <RailColumn {...props} side={side} />
    </div>
  );
}
