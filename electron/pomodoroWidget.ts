import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { kvGet, kvSet } from './db';

// 番茄钟桌面小组件：由全局热键（默认 Alt+P）呼出，以小组件形式展示并控制番茄钟计时。
// 与任务小组件（electron/widget.ts）、启动项小组件（electron/launchWidget.ts）相互独立，各自管理一个窗口。
let win: BrowserWindow | null = null;
let appPath = '.';

export function initPomodoroWidget(appDir: string): void {
  appPath = appDir;
}

export function getPomodoroWidget(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function restoreBounds(w: BrowserWindow): void {
  const saved = kvGet('pomoWidgetPos');
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
  w.setPosition(wa.x + wa.width - 336, wa.y + 60);
}

export function togglePomodoroWidget(): void {
  if (win && !win.isDestroyed()) {
    if (win.isVisible()) win.hide();
    else {
      win.show();
      win.focus();
    }
    return;
  }
  win = new BrowserWindow({
    width: 300,
    height: 380,
    minWidth: 260,
    minHeight: 320,
    frame: false,
    transparent: true,
    // 必须显式给透明底色：只写 transparent:true 时窗口底色仍会刷成白（圆角外是白框）
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: '番茄钟小组件',
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
      kvSet('pomoWidgetPos', JSON.stringify({ x, y }));
    }, 500);
  });
  win.on('closed', () => {
    win = null;
  });
  void win.loadFile(path.join(appPath, 'dist/index.html'), { hash: '/pomodoro-widget' });
}
