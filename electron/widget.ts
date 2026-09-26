import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { kvGet, kvSet } from './db';

let win: BrowserWindow | null = null;
let appPath = '.';

export function initWidget(appDir: string): void {
  appPath = appDir;
}

export function getWidget(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function restoreBounds(w: BrowserWindow): void {
  const saved = kvGet('widgetPos');
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

export function toggleWidget(): void {
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
    minHeight: 360,
    frame: false,
    transparent: true,
    // 同 launchWidget：默认 backgroundColor 是白色不透明，必须显式置为全透明
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: '工作台小组件',
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
      kvSet('widgetPos', JSON.stringify({ x, y }));
    }, 500);
  });
  win.on('closed', () => {
    win = null;
  });
  void win.loadFile(path.join(appPath, 'dist/index.html'), { hash: '/widget' });
}
