import React, { useEffect, useRef, useState } from 'react';

const readSide = (): string =>
  new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('side') ?? 'left';

// 悬停多久才滑出菜单：留一点缓冲，鼠标只是掠过屏幕边缘时不会误触发
const DWELL_MS = 280;

/** 收起态：贴紧屏幕边缘的一枚小拉手。悬停（停留片刻）或点击 → 滑出图标菜单；按住拖动 → 沿边缘调整位置 */
export default function DockHandle() {
  const [side, setSide] = useState<string>(readSide);
  const moved = useRef(false);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 窗口透明，只有拉手本身可见
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    const onHash = () => setSide(readSide());
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      if (dwell.current) clearTimeout(dwell.current);
    };
  }, []);

  const disarm = () => {
    if (dwell.current) {
      clearTimeout(dwell.current);
      dwell.current = null;
    }
  };

  const openMenu = () => {
    disarm();
    if (moved.current) {
      moved.current = false;
      return;
    }
    void window.api.dockPeekIn();
  };

  const arm = () => {
    disarm();
    dwell.current = setTimeout(openMenu, DWELL_MS);
  };

  const onEnter = () => arm();

  // 收起态拉手窗口除了「拉手实体」以外的区域一律鼠标穿透（否则会挡住桌面图标，
  // 用户点不中下面的软件）。穿透 / 恢复由主进程按光标位置轮询切换，并通过
  // dock:pointer 告知本窗口：
  //   in  → 等价 mouseenter，重新起「悬停滑出」计时（光标移入后停住不动也能展开）
  //   out → 穿透后收不到 mouseleave，必须手动撤掉计时器，否则会误展开
  useEffect(() => {
    const off = window.api.onDockPointer((phase) => {
      if (phase === 'in') arm();
      else disarm();
    });
    return off;
    // arm/disarm 只操作 ref，跨渲染稳定；这里只订阅一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTabMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    disarm(); // 按住即视为要拖动，取消"悬停滑出"
    moved.current = false;
    const startX = e.screenX;
    const startY = e.screenY;
    const move = (ev: MouseEvent) => {
      if (Math.abs(ev.screenX - startX) > 4 || Math.abs(ev.screenY - startY) > 4) moved.current = true;
      if (moved.current) void window.api.railDragTo({ x: ev.screenX, y: ev.screenY });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (moved.current) void window.api.railDragEnd();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div
      className={`dock-tab tab-${side}`}
      title="工作台 · 悬停滑出菜单，拖动可调整位置"
      onMouseEnter={onEnter}
      onMouseLeave={disarm}
      onClick={openMenu}
      onMouseDown={onTabMouseDown}
    >
      <span className="dock-tab-grip" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="dock-tab-chev" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path
            d="M9 5.5 15.5 12 9 18.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}
