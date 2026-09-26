import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

let win: BrowserWindow | null = null;
let appPath = '.';

export function initSearch(appDir: string): void {
  appPath = appDir;
}

export function getSearchWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

export function toggleSearch(): void {
  if (win && !win.isDestroyed()) {
    if (win.isVisible()) win.hide();
    else {
      win.show();
      win.focus();
    }
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: 640,
    height: 440,
    x: wa.x + Math.round((wa.width - 640) / 2),
    y: wa.y + Math.round(wa.height * 0.18),
    frame: false,
    transparent: true,
    // 同 launchWidget：默认 backgroundColor 是白色不透明，必须显式置为全透明
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: '快速搜索',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.once('ready-to-show', () => {
    win?.show();
    win?.focus();
  });
  win.on('close', (e) => {
    e.preventDefault();
    win?.hide();
  });
  win.on('closed', () => {
    win = null;
  });
  void win.loadFile(path.join(appPath, 'dist/index.html'), { hash: '/search' });
}
