import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { kvGet, kvSet } from './db';

// 启动项桌面小组件：由全局热键 Alt+L 呼出，以小组件形式展示「快捷启动」项。
// 与任务小组件（electron/widget.ts）相互独立，各自管理一个窗口。
let win: BrowserWindow | null = null;
let appPath = '.';

export function initLaunchWidget(appDir: string): void {
  appPath = appDir;
}

export function getLaunchWidget(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function restoreBounds(w: BrowserWindow): void {
  const saved = kvGet('launchWidgetPos');
  if (saved) {
    try {
      const { x, y } = JSON.parse(saved) as { x: number; y: number };
      w.setPosition(x, y);
      return;
    } catch {
      // 位置数据损坏时用默认位置
    }
  }
  const wa = screen.getPrimaryDisplay().workArea;
  w.setPosition(wa.x + wa.width - 356, wa.y + 60);
}

export function toggleLaunchWidget(): void {
  if (win && !win.isDestroyed()) {
    if (win.isVisible()) win.hide();
    else {
      win.show();
      win.focus();
    }
    return;
  }
  win = new BrowserWindow({
    width: 336,
    height: 460,
    minWidth: 280,
    minHeight: 300,
    frame: false,
    transparent: true,
    // 必须显式给透明底色：BrowserWindow 的 backgroundColor 默认是白色不透明，
    // 只写 transparent:true 时窗口底色仍会刷成白（圆角外的 8px 内边距就是一圈白框）。
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: '启动项小组件',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'floating');
  restoreBounds(win);
  win.once('ready-to-show', () => {
    win?.show();
    win?.focus();
  });
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  win.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      kvSet('launchWidgetPos', JSON.stringify({ x, y }));
    }, 500);
  });
  win.on('closed', () => {
    win = null;
  });
  void win.loadFile(path.join(appPath, 'dist/index.html'), { hash: '/launch-widget' });
}
