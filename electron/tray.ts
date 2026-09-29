import { Menu, Tray, nativeImage } from 'electron';
import * as path from 'path';

// 1x1 蓝色 PNG 兜底：icon.png 加载失败时托盘也能创建
const FALLBACK_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkKPb/PwAEfgJ/P8VHpAAAAABJRU5ErkJggg==';

let tray: Tray | null = null;
let appPath = '.';

export interface TrayActions {
  showMain: () => void;
  toggleSearch: () => void;
  toggleWidget: () => void;
  togglePomodoroWidget: () => void;
  createNote: () => void;
  toggleAllNotes: () => void;
  quit: () => void;
}

export function initTray(appDir: string): void {
  appPath = appDir;
}

export function createTray(actions: TrayActions): void {
  const iconPath = path.join(appPath, 'resources', 'icon.png');
  let icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL);
  tray = new Tray(icon);
  tray.setToolTip('工作台（关闭主窗口后在这里找到我）');
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: actions.showMain },
    { label: '快速搜索', click: actions.toggleSearch },
    { label: '桌面小组件', click: actions.toggleWidget },
    { label: '番茄钟小组件', click: actions.togglePomodoroWidget },
    { label: '新建便签', click: actions.createNote },
    { label: '显示/隐藏全部便签', click: actions.toggleAllNotes },
    { type: 'separator' },
    { label: '退出', click: actions.quit },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', actions.showMain);
}

export function displayWelcomeBalloon(): void {
  tray?.displayBalloon({
    iconType: 'info',
    title: '工作台正在后台运行',
    content: '点击任务栏右下角的 ^ 图标可以找到我；可以把图标拖到任务栏上常驻显示。',
  });
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

// 托盘是否已就绪（createTray 成功后才为 true）。用于 window-all-closed 判断：
// 有托盘常驻时，所有窗口关闭也不退出，等待用户从托盘/热键重新打开主窗口。
export function isTrayReady(): boolean {
  return tray !== null;
}
