import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Notification, screen, shell } from 'electron';
import * as fs from 'fs';
import * as httpMod from 'http';
import * as path from 'path';
import dayjs from 'dayjs';
import { initDb, kvGet, kvSet, persistNow } from './db';
import * as tasks from './tasks';
import * as pomodoro from './pomodoro';
import * as backup from './backup';
import * as notes from './notes';
import * as widget from './widget';
import * as launchWidget from './launchWidget';
import * as pomodoroWidget from './pomodoroWidget';
import * as trayMod from './tray';
import * as hotkeys from './hotkeys';
import * as launch from './launch';
import * as aiMod from './ai';
import * as reportMod from './report';
import * as clipboardMod from './clipboard';
import * as searchMod from './search';
import { initPomodoroService } from './pomodoroService';
import { attachEdgeDock, getHandleWindow, getRailWindow, initEdgeDock } from './edgeDock';
import { broadcast } from './broadcast';
import { appLog, initLogger } from './logger';
import type {
  AiEvent,
  HotkeyMap,
  ImportMode,
  ImportRow,
  LaunchInput,
  NoteInput,
  PomodoroSession,
  Report,
  ReportKind,
  SettingsMap,
  TaskInput,
  TaskStatus,
} from '../shared/types';

const SMOKE = process.env.WORKBENCH_SMOKE === '1';
const SHOT = Number(process.env.WORKBENCH_SHOT || '1');

// 把数据目录指到别处（WORKBENCH_DATA_DIR）。两个用处：
//   ① 冒烟测试跑在**隔离的库**上，永远不会污染用户的真实数据
//      （曾因为 kvSet 的 300ms 防抖 + 测试进程立刻退出，把测试色留在了真实库里）；
//   ② 单实例锁是按 userData 目录算的，因此隔离目录下冒烟可以与**正在运行的应用并存**，
//      不用先把用户手上的窗口杀掉。
// 必须在任何 app.getPath('userData') 之前调用（initDb / logger / clipboard 都会读它）。
if (process.env.WORKBENCH_DATA_DIR) {
  app.setPath('userData', process.env.WORKBENCH_DATA_DIR);
}
let quitting = false;
let mainWindow: BrowserWindow | null = null;
let dockCtl: {
  openPanel: (page: string) => void;
  expandManually: (page?: string) => void;
  forceDock: () => void;
  collapse: () => void;
  isDocked: () => boolean;
  fitRailWidth: (width: number) => void;
  peekIn: () => void;
  peekOut: () => void;
  railDragTo: (pt: { x: number; y: number }) => void;
  railDragEnd: () => void;
  dispose: () => void;
} | null = null;

const appDir = app.getAppPath();

function showMain(page?: string): void {
  // 主窗口可能被外部事件（息屏 / 多屏切换 / 异常）销毁，先确保它存在；
  // 否则停靠态展开会在已死窗口上抛 “Object has been destroyed”，导致主界面永远打不开
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (dockCtl?.isDocked()) {
      try {
        dockCtl.dispose();
      } catch {
        /* noop */
      }
    }
    recreateMainWindow();
  }
  if (dockCtl?.isDocked()) {
    // 停靠中：完整窗口以神灯动画展开并退出停靠模式
    dockCtl.expandManually(page);
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const win = mainWindow;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  // Windows 已知坑：窗口被 hide() 后再 show() 会"假活"——鼠标能点按钮，但焦点进不到文本框，
  // 导致弹窗（如新建任务）里的输入框打不了字。下面强制把焦点交给渲染进程，并用一次
  // "置顶再取消" 打破 input-dead 状态。
  win.webContents.focus();
  win.setAlwaysOnTop(true);
  setTimeout(() => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(false);
  }, 80);
  const allowed = ['dashboard', 'tasks', 'quadrant', 'calendar', 'gantt', 'pomodoro', 'launch', 'report', 'ai', 'settings'];
  if (page && allowed.includes(page) && !mainWindow.isDestroyed()) {
    void mainWindow.webContents.executeJavaScript(`location.hash = '#/${page}';`).catch(() => undefined);
  }
}

function createNoteAction(): void {
  const n = notes.createNote({});
  notes.openNote(n.id);
}

function smokeHashFor(shot: number): string {
  return shot === 1
    ? '/tasks'
    : shot === 2
      ? '/quadrant'
      : shot === 3
        ? '/calendar'
        : shot === 4
          ? `/gantt?scale=${process.env.WORKBENCH_SCALE ?? 'week'}`
          : shot === 5
            ? '/pomodoro'
            : shot === 6
              ? '/dashboard'
              : shot === 7
                ? '/settings'
                : shot === 10
                  ? '/launch'
                  : shot === 11
                    ? '/ai'
                    : shot === 12 || shot === 28
                      ? '/report'
                      : shot === 13
                        ? '/clips'
                        : shot === 15
                          ? '/notes'
                          : '';
}

// 创建并配置主窗口（事件、加载页面）。主窗口被销毁后可再次调用以重建。
function buildMainWindow(hash?: string): BrowserWindow {
  const themeDark = kvGet('theme') === 'dark';
  const w = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: '工作台',
    show: false,
    backgroundColor: themeDark ? '#141414' : '#f5f6fa',
    icon: path.join(appDir, 'resources', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: themeDark
      ? { color: '#1f1f1f', symbolColor: '#e8eaed', height: 40 }
      : { color: '#f5f6fa', symbolColor: '#1f1f1f', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  w.once('ready-to-show', () => {
    if (!SMOKE) w.show();
  });
  w.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      w.hide();
    }
  });
  w.on('closed', () => {
    mainWindow = null;
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    void w.loadURL(process.env.VITE_DEV_SERVER_URL + (hash ? `#${hash}` : ''));
  } else {
    void w.loadFile(path.join(appDir, 'dist/index.html'), { hash: hash || undefined });
  }
  return w;
}

function createWindow(): void {
  mainWindow = buildMainWindow(SMOKE ? smokeHashFor(SHOT) : undefined);
  initEdgeDock(appDir);
  dockCtl = attachEdgeDock(mainWindow, () => kvGet('edgeDock') !== '0', {
    onFullExpanded: (page?: string) => showMain(page),
  });
  attachSmokeHandlers(mainWindow);
}

// 主窗口被销毁后（息屏 / 多屏切换 / 异常）重建：先回收旧的停靠辅助窗口，再建新窗口并重新挂载 dock
function recreateMainWindow(): void {
  try {
    dockCtl?.dispose();
  } catch {
    /* noop */
  }
  mainWindow = buildMainWindow();
  initEdgeDock(appDir);
  dockCtl = attachEdgeDock(mainWindow, () => kvGet('edgeDock') !== '0', {
    onFullExpanded: (page?: string) => showMain(page),
  });
}

  // 开发/冒烟用：捕获渲染层日志、播种示例数据、到点截图。仅 SMOKE 模式生效。
  function attachSmokeHandlers(win: BrowserWindow): void {
    if (!SMOKE) return;
    win.webContents.on('console-message', (_e, level, message) => {
      console.log(`RENDERER[${level}]`, message);
    });
    win.webContents.on('preload-error', (_e, preloadPath, err) => {
      console.error('PRELOAD_ERROR', preloadPath, err);
    });

    const smokeDir = path.join(process.cwd(), '.smoke');
    fs.mkdirSync(smokeDir, { recursive: true });
    const slog = (m: string) => {
      fs.appendFileSync(path.join(smokeDir, 'flow.log'), `${new Date().toISOString()} ${m}\n`);
    };
    process.on('uncaughtException', (err) => {
      slog(`UNCAUGHT ${err.stack ?? String(err)}`);
      app.exit(1);
    });

    let loadCount = 0;
    win.webContents.on('did-finish-load', () => {
      if (win.isDestroyed()) return;
      loadCount++;
      slog(`did-finish-load #${loadCount} hash=${win.webContents.getURL().split('#')[1] ?? ''}`);
      if (loadCount === 1) {
        const darkScript =
          process.env.WORKBENCH_DARK === '1'
            ? "await window.api.setSetting('theme', 'dark');"
            : process.env.WORKBENCH_DARK === '0'
              ? "await window.api.setSetting('theme', 'light');"
              : '';
        void win.webContents
          .executeJavaScript(
            `(async () => {
              ${darkScript}
              const l = await window.api.listTasks();
              if (l.length === 0) {
                await window.api.createTask({ title: '整理季度汇报材料', importance: 'high', urgency: 'high', start_date: '2026-09-16', due_date: '2026-09-20', project: '季度汇报', tags: ['文档'], progress: 30 });
                await window.api.createTask({ title: '调研甘特图组件选型', importance: 'high', urgency: 'low', start_date: '2026-10-01', due_date: '2026-10-08', status: 'in_progress', project: '工具选型' });
                await window.api.createTask({ title: '回复合作方邮件', importance: 'low', urgency: 'high', start_date: '2026-09-22', due_date: '2026-09-25' });
                await window.api.createTask({ title: '整理本地视频素材库', importance: 'low', urgency: 'low', start_date: '2026-10-10', due_date: '2026-10-15' });
              }
              const demoTitles = ['整理季度汇报材料', '调研甘特图组件选型', '回复合作方邮件', '整理本地视频素材库'];
              const pad = (n) => String(n).padStart(2, '0');
              for (const t of l) {
                if (demoTitles.includes(t.title) && !t.start_date && t.due_date) {
                  const d = new Date(t.due_date + 'T00:00:00');
                  d.setDate(d.getDate() - 3);
                  await window.api.updateTask(t.id, { start_date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) });
                }
              }
              location.reload();
            })()`,
          )
          .catch((e) => console.error('SMOKE_SEED_FAIL', e));
      } else if (loadCount === 2 && (SHOT <= 7 || SHOT === 10 || SHOT === 11 || SHOT === 12 || SHOT === 13 || SHOT === 15)) {
        const shotFiles: Record<number, string> = {
          1: '1-tasks.png',
          2: '2-quadrant.png',
          3: '3-calendar.png',
          4: '4-gantt.png',
          5: '5-pomodoro.png',
          6: '6-dashboard.png',
          7: '7-settings.png',
          10: '10-launch.png',
          11: '11-ai.png',
          12: '12-report.png',
          13: '13-clips.png',
          14: '14-search.png',
          15: '15-notes.png',
        };
        const shotFile = shotFiles[SHOT] ?? shotFiles[1];
        void (async () => {
          try {
            await new Promise((r) => setTimeout(r, 1500));
            slog(`capture ${shotFile} start`);
            const img = await Promise.race([
              win.webContents.capturePage(undefined, { stayHidden: true }),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('capturePage timeout')), 5000)),
            ]);
            fs.writeFileSync(path.join(smokeDir, shotFile), img.toPNG());
            slog(`capture ${shotFile} done`);
            console.log('SMOKE_SHOT', shotFile);
            slog('SMOKE_OK');
            console.log('SMOKE_OK');
          } catch (e) {
            slog(`SMOKE_FAIL ${String(e)}`);
            console.error('SMOKE_FAIL', e);
          } finally {
            setTimeout(() => app.exit(0), 300);
          }
        })();
      }
    });

    setTimeout(() => {
      slog('SMOKE_TIMEOUT');
      console.error('SMOKE_TIMEOUT');
      app.exit(1);
    }, SHOT === 29 ? 240000 : SHOT === 16 || SHOT === 28 || SHOT === 31 || SHOT === 32 || SHOT === 33 || SHOT === 34 ? 120000 : 30000);
  }

  async function smokeCaptureAuxWindow(
    win: BrowserWindow,
    file: string,
    smokeDir: string,
  ): Promise<void> {
    let img: Electron.NativeImage | null = null;
    // 隐藏窗口要用 stayHidden；可见窗口直接抓更可靠，两种都试一遍
    const attempts: (() => Promise<Electron.NativeImage>)[] = [
      () => win.webContents.capturePage(),
      () => win.webContents.capturePage(undefined, { stayHidden: true }),
    ];
    for (const grab of attempts) {
      for (let i = 0; i < 2 && !img; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 800));
        try {
          const shot = await Promise.race([
            grab(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
          ]);
          if (shot && !shot.isEmpty()) img = shot;
        } catch {
          // 换下一种方式重试
        }
      }
      if (img) break;
    }
    if (!img) throw new Error('capturePage 失败');
    fs.writeFileSync(path.join(smokeDir, file), img.toPNG());
    console.log('SMOKE_SHOT', file);
  }

  /** `smokeDeskCapture` 的返回值：裁剪结果 + 局部坐标 → 图像坐标的换算参数 */
  interface DeskCrop {
    img: Electron.NativeImage;
    /** 屏幕缩略图相对 workArea 的缩放系数（注意并非常数：1920 宽常返回 1835） */
    sx: number;
    sy: number;
    /** 目标窗口左上角相对 workArea 的偏移 */
    ox: number;
    oy: number;
    /** 裁剪块在「缩放后坐标系」里的原点 */
    cx0: number;
    cy0: number;
    /** 惰性缓存：BGRA 缓冲与尺寸 */
    bm: Buffer | null;
    iw: number;
    ih: number;
  }

  /** 取「已合成到桌面」的像素：目标窗口局部坐标 (lx, ly) → RGB */
  function deskPixel(cap: DeskCrop, lx: number, ly: number): [number, number, number] {
    if (!cap.bm) {
      const s = cap.img.getSize();
      cap.iw = s.width;
      cap.ih = s.height;
      cap.bm = cap.img.toBitmap(); // BGRA
    }
    const x = Math.min(cap.iw - 1, Math.max(0, Math.round((cap.ox + lx) * cap.sx) - cap.cx0));
    const y = Math.min(cap.ih - 1, Math.max(0, Math.round((cap.oy + ly) * cap.sy) - cap.cy0));
    const i = (y * cap.iw + x) * 4;
    return [cap.bm[i + 2], cap.bm[i + 1], cap.bm[i]];
  }

  /**
   * 统计窗口局部矩形内的平均色、最深/最亮亮度与深/浅像素个数。
   * 文字反差用「最暗亮度」判定更稳：11px 中文字抗锯齿后，真正低于 0.35 亮度的
   * 笔画像素很少（实测只有 76 个），但**最暗亮度**一定是笔画中心的深色，骗不了人。
   */
  function deskRegion(
    cap: DeskCrop,
    lx: number,
    ly: number,
    lw: number,
    lh: number,
  ): { n: number; avg: [number, number, number]; dark: number; light: number; minLum: number } {
    let n = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let dark = 0;
    let light = 0;
    let minLum = 1;
    for (let yy = ly; yy < ly + lh; yy++) {
      for (let xx = lx; xx < lx + lw; xx++) {
        const [r, g, b] = deskPixel(cap, xx, yy);
        n++;
        sr += r;
        sg += g;
        sb += b;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (lum < minLum) minLum = lum;
        if (lum < 0.35) dark++;
        else if (lum > 0.85) light++;
      }
    }
    if (!n) return { n: 0, avg: [0, 0, 0], dark: 0, light: 0, minLum: 1 };
    return { n, avg: [sr / n, sg / n, sb / n], dark, light, minLum };
  }

  /**
   * 真实屏幕截图并裁出目标窗口周围一块。
   * `webContents.capturePage()` 返回的图**没有 alpha 通道**，透明窗口的白底和真透明
   * 在它眼里一模一样；要判断透明是否真的生效，只能截真实屏幕（桌面合成后的结果）。
   * 返回裁剪信息，便于调用方继续做像素级断言。
   */
  async function smokeDeskCapture(
    target: BrowserWindow,
    file: string,
    smokeDir: string,
    wa: Electron.Rectangle,
    m = 40,
  ): Promise<DeskCrop> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: wa.width, height: wa.height },
    });
    const primary =
      sources.find((s) => s.display_id === String(screen.getPrimaryDisplay().id)) ?? sources[0];
    if (!primary) throw new Error('取不到屏幕源');
    const full = primary.thumbnail;
    const size = full.getSize();
    // ⚠️ 缩略图覆盖的是**整个屏幕**（含任务栏），不是 workArea：请求 {1920,1032} 实际返回
    //    1835×1032，等比 0.9557 —— 也就是按 1920×1080 缩放的。所以缩放系数必须以
    //    `display.bounds` 为分母。早前误用 workArea 当分母，纵向 sy 被算成 1.0（真值 0.9556），
    //    造成「窗口局部 y → 图像 y」越往下偏得越多（顶部偏 17px、底部偏 37px），
    //    于是采样点会跑到窗口外面去（曾因此把「窗口外的桌面」当成「8px 内边距」）。
    const disp = screen.getPrimaryDisplay().bounds;
    const sx = size.width / disp.width;
    const sy = size.height / disp.height;
    const b = target.getBounds();
    const x0 = Math.max(0, Math.round((b.x - disp.x - m) * sx));
    const y0 = Math.max(0, Math.round((b.y - disp.y - m) * sy));
    const cw = Math.max(1, Math.min(size.width - x0, Math.round((b.width + m * 2) * sx)));
    const ch = Math.max(1, Math.min(size.height - y0, Math.round((b.height + m * 2) * sy)));
    const crop = full.crop({ x: x0, y: y0, width: cw, height: ch });
    fs.writeFileSync(path.join(smokeDir, file), crop.toPNG());
    console.log('DESK_CAPTURE_OK', file, 'win=', JSON.stringify(b), 'crop=', JSON.stringify({ x: x0, y: y0, width: cw, height: ch, sx, sy }));
    return {
      img: crop,
      sx,
      sy,
      ox: b.x - disp.x,
      oy: b.y - disp.y,
      cx0: x0,
      cy0: y0,
      bm: null,
      iw: 0,
      ih: 0,
    };
  }

function registerIpc(): void {
  ipcMain.handle('tasks:list', () => tasks.listTasks());
  ipcMain.handle('tasks:create', (_e, input: TaskInput) => {
    const r = tasks.createTask(input);
    broadcast('data:changed', 'tasks');
    return r;
  });
  ipcMain.handle('tasks:update', (_e, id: number, patch: Partial<TaskInput>) => {
    const r = tasks.updateTask(id, patch);
    broadcast('data:changed', 'tasks');
    return r;
  });
  ipcMain.handle('tasks:delete', (_e, id: number) => {
    tasks.deleteTask(id);
    broadcast('data:changed', 'tasks');
  });
  ipcMain.handle('tasks:setStatus', (_e, id: number, status: TaskStatus) => {
    const r = tasks.updateTask(id, { status });
    broadcast('data:changed', 'tasks');
    return r;
  });

  ipcMain.handle('import:parse', (_e, filePath: string) => tasks.parseImportFile(filePath));
  ipcMain.handle('import:commit', (_e, rows: ImportRow[], mode: ImportMode) => {
    const r = tasks.commitImport(rows, mode);
    broadcast('data:changed', 'tasks');
    return r;
  });

  ipcMain.handle('dialog:pickImportFile', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择导入文件',
      properties: ['openFile'],
      filters: [{ name: '表格文件', extensions: ['xlsx', 'csv'] }],
    });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });

  ipcMain.handle('export:tasks', async () => {
    const r = await dialog.showSaveDialog({
      title: '导出任务列表',
      defaultPath: `任务列表-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const count = tasks.exportTasks(r.filePath);
    return { filePath: r.filePath, count };
  });

  ipcMain.handle('export:template', async () => {
    const r = await dialog.showSaveDialog({
      title: '保存导入模板',
      defaultPath: '任务导入模板.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (r.canceled || !r.filePath) return null;
    tasks.saveTemplate(r.filePath);
    return { filePath: r.filePath };
  });

  ipcMain.handle('app:info', () => ({
    dataDir: app.getPath('userData'),
    version: app.getVersion(),
  }));

  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p));
  ipcMain.handle('window:show', (_e, page?: string) => showMain(page));
  ipcMain.handle('window:titlebar', (_e, dark: boolean) => {
    try {
      mainWindow?.setTitleBarOverlay(
        dark ? { color: '#1f1f1f', symbolColor: '#e8eaed' } : { color: '#f5f6fa', symbolColor: '#1f1f1f' },
      );
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('clips:list', (_e, keyword?: string) => clipboardMod.listClips(keyword ?? ''));
  ipcMain.handle('clips:copy', (_e, id: number) => clipboardMod.copyClip(id));
  ipcMain.handle('clips:pin', (_e, id: number, pinned: number) => clipboardMod.pinClip(id, pinned));
  ipcMain.handle('clips:delete', (_e, id: number) => clipboardMod.deleteClip(id));
  ipcMain.handle('clips:clear', () => clipboardMod.clearClips());
  ipcMain.handle('clips:imageData', (_e, id: number) => clipboardMod.imageClipDataUrl(id));
  ipcMain.handle('clips:watchStatus', () => clipboardMod.watchEnabled());
  ipcMain.handle('clips:setWatch', (_e, v: boolean) => clipboardMod.setWatchEnabled(v));

  ipcMain.handle('search:toggle', () => searchMod.toggleSearch());
  ipcMain.handle('dock:expand', (_e, page?: string) => dockCtl?.expandManually(page));
  ipcMain.handle('dock:panel', (_e, page: string) => dockCtl?.openPanel(page));
  ipcMain.handle('dock:collapse', () => dockCtl?.collapse());
  ipcMain.handle('dock:railFit', (_e, width: number) => dockCtl?.fitRailWidth(width));
  ipcMain.handle('dock:peekIn', () => dockCtl?.peekIn());
  ipcMain.handle('dock:peekOut', () => dockCtl?.peekOut());
  ipcMain.handle('rail:dragTo', (_e, pt: { x: number; y: number }) => dockCtl?.railDragTo(pt));
  ipcMain.handle('rail:dragEnd', () => dockCtl?.railDragEnd());

  ipcMain.handle('settings:getAll', (): SettingsMap => ({
    theme: kvGet('theme'),
    pomodoro: kvGet('pomodoro'),
    backupDir: kvGet('backupDir'),
    backupAuto: kvGet('backupAuto'),
    edgeDock: kvGet('edgeDock'),
    notesAutoOpen: kvGet('notesAutoOpen'),
    // 桌面小组件外观（见 src/widgetStyle.ts 与设置页「桌面小组件」卡片）
    widgetBgColor: kvGet('widgetBgColor'),
    widgetBgOpacity: kvGet('widgetBgOpacity'),
  }));
  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    kvSet(key, value);
    // 广播给所有窗口：小组件窗口据此实时换背景色/透明度，不用重开窗口
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('settings:changed', key, value);
    }
  });

  ipcMain.handle('pomo:record', (_e, s: PomodoroSession) => pomodoro.recordSession(s));
  ipcMain.handle('pomo:recent', () => pomodoro.recentSessions(20));
  ipcMain.handle('pomo:stats', () => pomodoro.stats());
  initPomodoroService();

  ipcMain.handle('stats:dashboard', () => tasks.dashboardStats());

  ipcMain.handle('notify', (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });

  ipcMain.handle('backup:now', () => backup.backupNow());
  ipcMain.handle('backup:list', () => backup.listBackups());
  ipcMain.handle('backup:openDir', () => {
    fs.mkdirSync(backup.backupDir(), { recursive: true });
    return shell.openPath(backup.backupDir());
  });
  ipcMain.handle('backup:restore', (_e, name: string) => {
    backup.restoreBackup(name);
    app.relaunch();
    app.exit(0);
    return true;
  });

  ipcMain.handle('notes:list', () => notes.listNotes());
  ipcMain.handle('notes:get', (_e, id: number) => notes.getNote(id));
  ipcMain.handle('notes:create', (_e, input: NoteInput | undefined) => {
    const n = notes.createNote(input ?? {});
    notes.openNote(n.id);
    return n;
  });
  ipcMain.handle('notes:update', (_e, id: number, patch: NoteInput) => notes.updateNote(id, patch));
  ipcMain.handle('notes:delete', (_e, id: number) => notes.deleteNote(id));
  ipcMain.handle('notes:open', (_e, id: number) => notes.openNote(id));
  ipcMain.handle('notes:toggleAll', () => notes.toggleAllNotes());

  ipcMain.handle('launch:list', () => launch.listLaunch());
  ipcMain.handle('launch:create', (_e, input: LaunchInput) => launch.createLaunch(input));
  ipcMain.handle('launch:update', (_e, id: number, patch: Partial<LaunchInput>) => launch.updateLaunch(id, patch));
  ipcMain.handle('launch:delete', (_e, id: number) => launch.deleteLaunch(id));
  ipcMain.handle('launch:open', (_e, id: number) => launch.openLaunch(id));

  ipcMain.handle('hotkeys:get', () => hotkeys.getHotkeys());
  ipcMain.handle('hotkeys:set', (_e, map: HotkeyMap) => hotkeys.setHotkeys(map));

  ipcMain.handle('widget:toggle', () => widget.toggleWidget());
  ipcMain.handle('pomoWidget:toggle', () => pomodoroWidget.togglePomodoroWidget());

  ipcMain.handle('ai:getConfig', () => aiMod.getAiConfigPublic());
  ipcMain.handle('ai:setConfig', (_e, cfg: { baseURL: string; model: string; apiKey?: string }) => {
    aiMod.setAiConfig(cfg);
    return aiMod.getAiConfigPublic();
  });
  ipcMain.handle('ai:test', (_e, cfg: { baseURL: string; model: string; apiKey?: string }) => aiMod.testConnection(cfg));
  ipcMain.handle('ai:send', (_e, text: string) => {
    const send = (evt: AiEvent) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('ai:event', evt);
      }
    };
    return aiMod.runAgent(text, send);
  });
  ipcMain.handle('ai:stop', () => aiMod.stopAgent());
  ipcMain.handle('ai:messages', () => aiMod.listMessages());
  ipcMain.handle('ai:clear', () => aiMod.clearMessages());

  ipcMain.handle('report:generate', (_e, kind: ReportKind, which: 'current' | 'previous') =>
    reportMod.generateReport(kind, which),
  );
  ipcMain.handle('report:list', () => reportMod.listReports());
  // 区间预览与真正的生成共用 report.ts 里的 resolveRange，避免 UI 显示的和实际生成的不一致
  ipcMain.handle('report:previewRange', (_e, kind: ReportKind, which: 'current' | 'previous') =>
    reportMod.previewRange(kind, which),
  );
  ipcMain.handle('report:delete', (_e, id: number) => reportMod.deleteReport(id));
  ipcMain.handle('report:export', async (_e, id: number) => {
    const r = reportMod.getReport(id);
    const d = await dialog.showSaveDialog({
      title: '导出报告',
      defaultPath: `${r.title}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (d.canceled || !d.filePath) return null;
    fs.writeFileSync(d.filePath, r.content, 'utf-8');
    return { filePath: d.filePath };
  });
}

function bootstrap(): void {
  initLogger();
  process.on('uncaughtException', (err) => {
    appLog('UNCAUGHT_EXCEPTION', err);
    console.error('UNCAUGHT_EXCEPTION', err);
  });
  process.on('unhandledRejection', (reason) => {
    appLog('UNHANDLED_REJECTION', reason);
    console.error('UNHANDLED_REJECTION', reason);
  });
  initDb()
    .then(() => {
      backup.autoBackupIfDue();
      registerIpc();
      createWindow();
      trayMod.initTray(appDir);
      launchWidget.initLaunchWidget(appDir);
      pomodoroWidget.initPomodoroWidget(appDir);
      trayMod.createTray({
        showMain,
        toggleSearch: () => searchMod.toggleSearch(),
        toggleWidget: () => widget.toggleWidget(),
        togglePomodoroWidget: () => pomodoroWidget.togglePomodoroWidget(),
        createNote: createNoteAction,
        toggleAllNotes: () => notes.toggleAllNotes(),
        quit: () => {
          quitting = true;
          notes.setQuitting(true);
          app.quit();
        },
      });
      if (!kvGet('trayBalloonShown')) {
        trayMod.displayWelcomeBalloon();
        kvSet('trayBalloonShown', '1');
      }
      const hk = hotkeys.registerHotkeys({
        showMain,
        toggleWidget: () => widget.toggleWidget(),
        createNote: createNoteAction,
        toggleSearch: () => searchMod.toggleSearch(),
        openLaunch: () => launchWidget.toggleLaunchWidget(),
        togglePomodoroWidget: () => pomodoroWidget.togglePomodoroWidget(),
      });
      if (hk.failed.length) console.log('HOTKEY_FAILED', hk.failed.join(','));
      // 便签默认不在启动时自动弹出（省内存，也免得每次开机被一堆便签挡住）；
      // 需要的人可在「设置 → 外观与窗口」里打开，或随时用托盘菜单 / Alt+N 打开。
      if (kvGet('notesAutoOpen') === '1') notes.openAllNotes();
      clipboardMod.startClipboardWatch();

      // 内存诊断（WORKBENCH_MEMLOG=1）：把各进程的 type/工作集写进 app.log，便于对比优化效果
      if (process.env.WORKBENCH_MEMLOG === '1') {
        const dumpMetrics = (tag: string): void => {
          try {
            const rows = app.getAppMetrics().map((m) => ({
              type: m.type,
              pid: m.pid,
              wsMB: Math.round((m.memory?.workingSetSize ?? 0) / 1024),
            }));
            const wins = BrowserWindow.getAllWindows()
              .filter((w) => !w.isDestroyed())
              .map((w) => w.getTitle());
            appLog('MEM ' + tag, 'windows=' + wins.length + ' ' + JSON.stringify(wins), JSON.stringify(rows));
          } catch {
            // 取不到指标就算了
          }
        };
        setTimeout(() => dumpMetrics('t+6s'), 6000);
        setTimeout(() => dumpMetrics('t+14s'), 14000);
      }

      if (
        SMOKE &&
        (SHOT === 8 || SHOT === 9 || SHOT === 14 || SHOT === 16 || SHOT === 21 || SHOT === 22 || SHOT === 23 || SHOT === 24 || SHOT === 25 || SHOT === 26 || SHOT === 27 || SHOT === 28 || SHOT === 29 || SHOT === 30 || SHOT === 31 || SHOT === 32 || SHOT === 33 || SHOT === 34)
      ) {
        const smokeDir = path.join(appDir, '.smoke');
        fs.mkdirSync(smokeDir, { recursive: true });
        void (async () => {
          try {
            await new Promise((r) => setTimeout(r, 2000));
            if (SHOT === 8) {
              widget.toggleWidget();
              await new Promise((r) => setTimeout(r, 2500));
              const w = widget.getWidget();
              if (!w) throw new Error('小组件窗口未创建');
              await smokeCaptureAuxWindow(w, '8-widget.png', smokeDir);
            } else if (SHOT === 9) {
              const n = notes.createNote({ content: '点这里编辑便签内容\n自动保存 · 拖动顶部移动', color: 'yellow' });
              notes.openNote(n.id);
              await new Promise((r) => setTimeout(r, 2500));
              const w = notes.getNoteWindow(n.id);
              if (!w) throw new Error('便签窗口未创建');
              await smokeCaptureAuxWindow(w, '9-note.png', smokeDir);
            } else if (SHOT === 21) {
              launchWidget.toggleLaunchWidget();
              await new Promise((r) => setTimeout(r, 2500));
              const w = launchWidget.getLaunchWidget();
              if (!w) throw new Error('启动项小组件窗口未创建');
              await smokeCaptureAuxWindow(w, '21-launch-widget.png', smokeDir);
            } else if (SHOT === 27) {
              // 「桌面小组件」外观设置（背景色 + 不透明度）是否真的生效，以及文字是否自动反差。
              // 做法：临时把设置写成一个高辨识度的值 → 打开小组件 → 真实屏幕截图 → 按像素断言；
              // 测完立刻还原用户原设置（冒烟跑在真实用户库上，不能留痕）。
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              const wa = screen.getPrimaryDisplay().workArea;
              const prevColor = kvGet('widgetBgColor');
              const prevOpacity = kvGet('widgetBgOpacity');
              const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
              // 取「卡片背后真实背景色」的确定做法：把同一个像素在**不透明度 0%** 时截一次
              // —— 那一刻卡片全透明，该点看到的就是它自己的背景。同一个点、同一次布局，
              // 不需要「桌面背景处处一致」这种在真实桌面上不成立的假设
              //（早前用「8px 内边距当背景基准」就翻过车：角落透出的是壁纸，卡片背后却是另一个窗口）。
              const SAMPLE = { x: 168, y: 300 } as const;
              const captureAt = async (
                opacity: number,
                color: string,
                file: string,
              ): Promise<DeskCrop> => {
                kvSet('widgetBgColor', color);
                kvSet('widgetBgOpacity', String(opacity));
                const w = launchWidget.getLaunchWidget();
                if (!w) throw new Error('小组件窗口已销毁');
                w.webContents.send('settings:changed', 'widgetBgColor', color);
                w.webContents.send('settings:changed', 'widgetBgOpacity', String(opacity));
                await sleep(1200);
                return smokeDeskCapture(w, file, smokeDir, wa);
              };
              try {
                // 1) 打开小组件、挪到固定位置（桌面中部，别贴边），并藏掉主窗口
                launchWidget.toggleLaunchWidget();
                await sleep(3500);
                const w0 = launchWidget.getLaunchWidget();
                if (!w0) throw new Error('启动项小组件未创建');
                w0.setPosition(wa.x + 120, wa.y + 380);
                mainWindow?.hide();
                await sleep(1500);

                // 1) 深色底 + 全不透明：卡片像素应≈目标色，说明背景色与不透明度都落到了窗口上
                const cap1 = await captureAt(100, '#c81e1e', '27-widget-dark.png');
                const c1 = deskPixel(cap1, SAMPLE.x, SAMPLE.y);
                console.log('SHOT27_DARK_BG_PIXEL', JSON.stringify(c1), 'expect≈[200,30,30]');
                if (!(near(c1[0], 200, 20) && near(c1[1], 30, 20) && near(c1[2], 30, 20))) {
                  throw new Error('背景色未生效，取到 ' + JSON.stringify(c1));
                }

                // 2) 浅色底：整个卡片应变亮，且仍能找到深色文字 → 证明前景色自动反转了
                const cap2 = await captureAt(100, '#f5f5f7', '27-widget-light.png');
                // 区域取卡片内部一小圈（卡片本身是窗口局部 8..328 × 8..452），
                // 留足内缩量，免得把「透明内边距里透出来的桌面」算进来干扰判断
                const reg = deskRegion(cap2, 20, 20, 296, 412);
                const lum = (0.299 * reg.avg[0] + 0.587 * reg.avg[1] + 0.114 * reg.avg[2]) / 255;
                console.log(
                  'SHOT27_LIGHT_REGION avgLum=',
                  lum.toFixed(3),
                  'minLum=',
                  reg.minLum.toFixed(3),
                  'dark=',
                  reg.dark,
                );
                if (lum < 0.7) throw new Error('浅色背景未生效，平均亮度=' + lum.toFixed(3));
                if (reg.minLum > 0.45) {
                  throw new Error('浅色底上找不到深色文字，前景色未自动反转，minLum=' + reg.minLum.toFixed(3));
                }

                // 3) 不透明度：期望值 = a*卡片色 + (1-a)*该点真实背景色。
                //    若 alpha 没生效（卡片仍按不透明画），这里会得到 200 而不是 ~88，一眼可辨。
                const C = [200, 30, 30];
                const bg = deskPixel(
                  await captureAt(0, '#c81e1e', '27-widget-alpha0.png'),
                  SAMPLE.x,
                  SAMPLE.y,
                );
                const p20 = deskPixel(
                  await captureAt(20, '#c81e1e', '27-widget-alpha.png'),
                  SAMPLE.x,
                  SAMPLE.y,
                );
                const want = [0, 1, 2].map((i) => 0.2 * C[i] + 0.8 * bg[i]);
                const diff = [0, 1, 2].map((i) => Math.abs(p20[i] - want[i]));
                console.log(
                  'SHOT27_ALPHA bg@0%=',
                  JSON.stringify(bg),
                  'card@20%=',
                  JSON.stringify(p20),
                  'expect=',
                  JSON.stringify(want.map((v) => Math.round(v))),
                  'diff=',
                  JSON.stringify(diff.map((v) => Math.round(v))),
                );
                // 前提：背景色与卡片色要拉得开，这一步才有判别力（否则纯色前后都≈卡片色）
                if (Math.max(...[0, 1, 2].map((i) => Math.abs(bg[i] - C[i]))) < 45) {
                  throw new Error('该采样点的桌面背景与卡片色太接近，此项无判别力，bg=' + JSON.stringify(bg));
                }
                if (Math.max(...diff) > 20) {
                  throw new Error('不透明度未按 alpha 合成，偏差=' + JSON.stringify(diff.map(Math.round)));
                }
              } finally {
                // 还原用户原设置，并让仍开着的小组件窗口跟着回退。
                // ⚠️ 必须 persistNow()：kvSet 是 300ms 防抖落盘（db.ts 的 persist()），
                //    这里紧接着进程就退出了，不强制落盘的话「还原」会丢，
                //    把测试用的颜色值永久留在用户库里（已踩过一次）。
                kvSet('widgetBgColor', prevColor ?? '');
                kvSet('widgetBgOpacity', prevOpacity ?? '');
                persistNow();
                for (const win of BrowserWindow.getAllWindows()) {
                  if (!win.isDestroyed()) {
                    win.webContents.send('settings:changed', 'widgetBgColor', prevColor ?? '');
                  }
                }
                console.log('SHOT27_RESTORED', JSON.stringify({ prevColor, prevOpacity }));
              }
            } else if (SHOT === 28) {
              // 报告页交互回归：切「周报 / 月报 / 年报」是否真的改变了 kind，
              // 以及「生成报告」是否跟着用新的 kind。
              // 关键点：用**真实鼠标输入事件**（webContents.sendInputEvent）驱动，而不是
              // element.click()。两者能区分开两种完全不同的故障：
              //   ① 点击根本没到达控件（被遮挡 / 拖拽区吞掉 / 快捷键冲突）
              //   ② 点击到了但 React 状态没更新（handler 没接上）
              // .click() 只能测 ②，测不出 ①。
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              const js = <T>(code: string): Promise<T> => mainWindow!.webContents.executeJavaScript(code) as Promise<T>;
              const beforeIds = reportMod.listReports(1000).map((r) => r.id);
              const createdIds: number[] = [];

              /** 在页面里找一个元素的中心点（窗口内 CSS 像素） */
              const centerOf = async (finder: string): Promise<{ x: number; y: number } | null> =>
                js<{ x: number; y: number } | null>(
                  `(() => {
                     const el = ${finder};
                     if (!el) return null;
                     const r = el.getBoundingClientRect();
                     return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
                   })()`,
                );

              /** 真实鼠标点击（含移动，某些控件靠 mouseenter 才激活） */
              const realClick = async (pt: { x: number; y: number }): Promise<void> => {
                const wc = mainWindow!.webContents;
                wc.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y });
                await sleep(80);
                wc.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
                await sleep(60);
                wc.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
              };

              /** 读回分段控件当前选中项 */
              const selectedSeg = (): Promise<{ labels: string[]; index: number; text: string }> =>
                js(
                  `(() => {
                     const items = Array.from(document.querySelectorAll('.ant-segmented-item'));
                     const index = items.findIndex((e) => e.classList.contains('ant-segmented-item-selected'));
                     return { labels: items.map((e) => e.textContent.trim()), index, text: index >= 0 ? items[index].textContent.trim() : '' };
                   })()`,
                );

              /** 读回「将要生成的区间」提示文本 —— 切 tab 必须有可见反应就靠它 */
              const hintText = (): Promise<string> =>
                js<string>(
                  `(() => { const el = document.querySelector('.report-hint'); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
                );

              try {
                mainWindow?.show();
                mainWindow?.focus();
                await sleep(1200);
                const seg0 = await selectedSeg();
                console.log('SHOT28_SEG_INIT', JSON.stringify(seg0));
                if (seg0.labels.length !== 3) throw new Error('分段控件没渲染出 3 项，实际 ' + JSON.stringify(seg0.labels));

                const buttonPt = await centerOf(
                  `document.querySelector('button.report-generate')`,
                );
                if (!buttonPt) throw new Error('找不到「生成报告」按钮');
                console.log('SHOT28_BTN', JSON.stringify(buttonPt));
                const hint0 = await hintText();
                console.log('SHOT28_HINT_INIT', hint0);
                if (!hint0.includes('区间')) throw new Error('工具栏没显示「将要生成的区间」提示：' + hint0);

                // 逐个点「月报」「年报」，每次都验证：
                //   ① 选中项真的跟着变；② 区间提示文案跟着变（这就是「点了没反应」的正面护栏）
                const expect: { label: string; kind: ReportKind; index: number }[] = [
                  { label: '月报', kind: 'monthly', index: 1 },
                  { label: '年报', kind: 'yearly', index: 2 },
                ];
                for (const step of expect) {
                  const pt = await centerOf(
                    `Array.from(document.querySelectorAll('.ant-segmented-item')).find((e) => e.textContent.trim() === '${step.label}')`,
                  );
                  if (!pt) throw new Error('找不到分段项：' + step.label);
                  await realClick(pt);
                  await sleep(600);
                  const seg = await selectedSeg();
                  console.log('SHOT28_SEG_AFTER_CLICK', step.label, JSON.stringify(seg));
                  if (seg.text !== step.label) {
                    throw new Error(`点击「${step.label}」后选中项仍是「${seg.text}」→ 点击没生效`);
                  }
                  // 期望值直接取自后端同一份 resolveRange，保证 UI 显示的和实际生成的一致
                  const want = reportMod.previewRange(step.kind, 'current');
                  const hint = await hintText();
                  console.log('SHOT28_HINT', step.label, JSON.stringify(want), '→', hint);
                  for (const piece of [want.title, want.start, want.end]) {
                    if (!hint.includes(piece)) {
                      throw new Error(`切到「${step.label}」后区间提示没有更新，缺少「${piece}」，实际：${hint}`);
                    }
                  }
                  await smokeCaptureAuxWindow(mainWindow!, `28-seg-${step.kind}.png`, smokeDir);

                  // 再点「生成报告」，验证落库的报告 kind 就是当前选中的那个
                  await realClick(buttonPt);
                  let fresh: Report | null = null;
                  for (let i = 0; i < 60 && !fresh; i++) {
                    await sleep(500);
                    fresh = reportMod.listReports(1000).find((r) => !beforeIds.includes(r.id)) ?? null;
                  }
                  if (!fresh) throw new Error(`点击「生成报告」（选中 ${step.label}）后没有产生任何新报告`);
                  createdIds.push(fresh.id);
                  console.log(
                    'SHOT28_GENERATED',
                    JSON.stringify({ want: step.kind, got: fresh.kind, title: fresh.title, period: fresh.period }),
                  );
                  if (fresh.kind !== step.kind) {
                    throw new Error(`选中「${step.label}」却生成了 ${fresh.kind} 报告：「${fresh.title}」`);
                  }
                  // 生成完把新报告从列表里剔除基准，避免下一轮误判成"新报告"
                  beforeIds.push(fresh.id);
                }
                console.log('SHOT28_OK 切换与生成都按 kind 走通');
              } finally {
                // 冒烟跑在真实用户库上，测试产生的报告必须删干净，并强制落盘
                // （run() 同样是 300ms 防抖，不 persistNow 会留在库里）
                for (const id of createdIds) reportMod.deleteReport(id);
                persistNow();
                console.log(
                  'SHOT28_CLEANED',
                  JSON.stringify({ removed: createdIds, left: reportMod.listReports(1000).map((r) => r.id) }),
                );
              }
            } else if (SHOT === 29) {
              // 计时探针：报告生成的每一段到底花多久、卡在哪。
              // 背景：用户报「点生成报告没反应 / 只有周报」。渲染层与 IPC 链路已由 SHOT=28
              // 证明没问题，所以嫌疑在 AI 调用这一段——ai.ts 的 fetch **没有超时**，
              // 服务商挂住连接时这条 await 会永远不返回，于是：
              //   renderer 的 generating 一直是 true → antd 的 loading 按钮会吞掉后续点击
              //   → 看上去就是「点了没反应」，列表也永远只有旧报告。
              // 这个探针逐档跑一遍并打印耗时，能把「慢」和「真的挂死」区分开。
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              console.log('SHOT29_AI_CONFIGURED', aiMod.isConfigured());
              const madeIds: number[] = [];
              const LIMIT = 45000;
              try {
                for (const kind of ['weekly', 'monthly', 'yearly'] as ReportKind[]) {
                  const t0 = Date.now();
                  const slowTimer = setInterval(() => {
                    console.log('SHOT29_STILL_RUNNING', kind, 'elapsed=', Date.now() - t0);
                  }, 10000);
                  try {
                    const r = await Promise.race([
                      reportMod.generateReport(kind, 'current'),
                      sleep(LIMIT).then(() => {
                        throw new Error(`超过 ${LIMIT}ms 仍未返回`);
                      }),
                    ]);
                    madeIds.push(r.id);
                    console.log(
                      'SHOT29_RESULT',
                      kind,
                      'ms=',
                      Date.now() - t0,
                      JSON.stringify({ title: r.title, period: r.period, len: r.content.length }),
                    );
                  } catch (e) {
                    console.log('SHOT29_ERROR', kind, 'ms=', Date.now() - t0, String(e).slice(0, 300));
                  } finally {
                    clearInterval(slowTimer);
                  }
                }
              } finally {
                for (const id of madeIds) reportMod.deleteReport(id);
                persistNow();
                console.log('SHOT29_CLEANED', JSON.stringify(madeIds));
              }
            } else if (SHOT === 30) {
              // 报告生成链路的自包含回归（不需要真 AI、不碰用户数据）：
              // 起一个本地假 AI 服务器，验证
              //   ① 报告走的是**单轮、不带工具、不带聊天历史**的调用（不再用 runAgent 的助手循环）
              //   ② 生成结果会写进报告，但**不会污染 ai_messages 聊天记录**
              //   ③ 服务商「接了连接但不返回」时，会在超时后**退化出纯统计报告**而不是永久卡死
              //     —— 这正是用户遇到的「点生成报告没反应、列表里只有周报」的根因场景。
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              const madeIds: number[] = [];
              const prevAiConfig = kvGet('aiConfig');
              const hits: { tools: boolean; msgCount: number; roles: string[]; model: string }[] = [];
              let hangMode = false;
              const server = httpMod.createServer((req, res) => {
                let body = '';
                req.on('data', (c) => (body += c));
                req.on('end', () => {
                  if (hangMode) return; // 收下请求但永不响应 → 模拟服务商挂住
                  let rec = { tools: false, msgCount: -1, roles: [] as string[], model: '' };
                  try {
                    const j = JSON.parse(body) as {
                      messages?: { role: string }[];
                      tools?: unknown[];
                      model?: string;
                    };
                    rec = {
                      tools: Array.isArray(j.tools) && j.tools.length > 0,
                      msgCount: j.messages?.length ?? -1,
                      roles: (j.messages ?? []).map((m) => m.role),
                      model: j.model ?? '',
                    };
                  } catch {
                    // 请求体不是 JSON，记为异常样本
                  }
                  hits.push(rec);
                  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                  res.write(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: '# 测试报告\\n\\nMARKER_AI_OK 这是 AI 写的正文。' } }] })}\n\n`,
                  );
                  res.write('data: [DONE]\n\n');
                  res.end();
                });
              });
              await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
              const port = (server.address() as { port: number }).port;
              try {
                aiMod.setAiConfig({ baseURL: `http://127.0.0.1:${port}/v1`, model: 'fake-model', apiKey: 'test' });
                console.log('SHOT30_AI_READY', JSON.stringify(aiMod.getAiConfigPublic()));
                const msgBefore = aiMod.listMessages(1000).length;

                // A) 正常返回：应单轮拿到内容，且不写 ai_messages
                hits.length = 0;
                const t0 = Date.now();
                const r1 = await reportMod.generateReport('monthly', 'current');
                madeIds.push(r1.id);
                const msgAfter = aiMod.listMessages(1000).length;
                console.log(
                  'SHOT30_A',
                  JSON.stringify({
                    ms: Date.now() - t0,
                    kind: r1.kind,
                    hasMarker: r1.content.includes('MARKER_AI_OK'),
                    hits,
                    msgBefore,
                    msgAfter,
                  }),
                );
                if (!r1.content.includes('MARKER_AI_OK')) throw new Error('AI 正文没有写进报告');
                if (hits.length !== 1) throw new Error(`报告应只发 1 次请求（单轮），实际 ${hits.length} 次`);
                if (hits[0].tools) throw new Error('报告请求不该带 tools（说明还在走助手工具循环）');
                if (hits[0].msgCount !== 2 || hits[0].roles.join(',') !== 'system,user') {
                  throw new Error(`报告请求不该带聊天历史，实际 messages=${JSON.stringify(hits[0].roles)}`);
                }
                if (msgAfter !== msgBefore) throw new Error('报告把提示词/正文写进了 ai_messages（污染聊天记录）');

                // B) 服务商挂住：超时后必须退化出报告，而不是永远不返回
                hangMode = true;
                const t1 = Date.now();
                const r2 = await reportMod.generateReport('yearly', 'current');
                const cost = Date.now() - t1;
                madeIds.push(r2.id);
                console.log(
                  'SHOT30_B',
                  JSON.stringify({ ms: cost, kind: r2.kind, tail: r2.content.slice(-120) }),
                );
                if (r2.kind !== 'yearly') throw new Error('挂住场景下报告 kind 不对：' + r2.kind);
                if (!/AI 叙述生成失败/.test(r2.content)) throw new Error('挂住场景下没有退化成纯统计报告');
                if (!/超时/.test(r2.content)) throw new Error('挂住场景下没写清原因是超时：' + r2.content.slice(-200));
                if (cost > 40000) throw new Error(`超时兜底太慢：${cost}ms`);
                console.log('SHOT30_OK 单轮调用 / 不污染聊天记录 / 挂住会超时退化');
              } finally {
                hangMode = true;
                try {
                  (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
                  server.close();
                } catch {
                  // 关服务器失败不影响结论
                }
                kvSet('aiConfig', prevAiConfig ?? '');
                for (const id of madeIds) reportMod.deleteReport(id);
                persistNow();
                console.log('SHOT30_CLEANED', JSON.stringify(madeIds));
                await sleep(50);
              }
            } else if (SHOT === 31) {
              // 回归：贴边收起后，在「贴边面板」里新建任务打不进字。
              // 背景：面板（点菜单项后展开的真实页面：任务表单 / AI 输入框 / 设置项）是渲染在
              // railWin 里的，而这个窗口创建时写死了 focusable:false（当年为了让悬停弹出的图标列
              // 不抢焦点）。Windows 上不可聚焦的窗口（WS_EX_NOACTIVATE）永远拿不到键盘焦点，
              // 于是面板里所有输入框都是死的——鼠标点得进去，字打不进去。
              // 用例走真实路径：贴边收起 → 悬停弹出图标列 → 点「任务」开面板 → 点「新建任务」→ 打字读回；
              // 末尾再展开完整窗口（hide→show 那条老路）验一遍主窗口里的同一个表单。
              // 跑法：WORKBENCH_SMOKE=1 WORKBENCH_SHOT=31 WORKBENCH_DOCK_HOLD=1
              //（DOCK_HOLD 关掉「鼠标离开自动收回」，否则面板会在用例中途自己被收走）
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              const wa = screen.getPrimaryDisplay().workArea;
              const panel = (): BrowserWindow => {
                const w = getRailWindow();
                if (!w || w.isDestroyed()) throw new Error('图标列 / 面板窗口不存在');
                return w;
              };
              const jsIn = <T>(w: BrowserWindow, code: string): Promise<T> =>
                w.webContents.executeJavaScript(code) as Promise<T>;
              const hwndOf = (w: BrowserWindow): string => {
                try {
                  const buf = w.getNativeWindowHandle();
                  return buf.length >= 8 ? String(buf.readBigUInt64LE(0)) : String(buf.readUInt32LE(0));
                } catch {
                  return '?';
                }
              };
              /** 在窗口内找一个元素并真实点击（合成鼠标事件，走渲染层输入管线） */
              const clickIn = async (w: BrowserWindow, finder: string): Promise<void> => {
                const pt = await jsIn<{ x: number; y: number } | null>(
                  w,
                  `(() => { const el = ${finder};
                     if (!el) return null;
                     const r = el.getBoundingClientRect();
                     return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
                );
                if (!pt) throw new Error(`找不到可点元素：${finder}`);
                const wc = w.webContents;
                wc.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y });
                await sleep(80);
                wc.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
                await sleep(60);
                wc.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
              };
              const typeIn = async (w: BrowserWindow, text: string): Promise<void> => {
                for (const ch of text) {
                  w.webContents.sendInputEvent({ type: 'char', keyCode: ch });
                  await sleep(70);
                }
              };
              /** 读回「窗口焦点 + 页面里新建任务弹窗第一格的值」 */
              const stateOf = (w: BrowserWindow): Promise<string> =>
                jsIn(
                  w,
                  `(() => { const i = document.querySelector('.ant-modal input');
                     return JSON.stringify({
                       hasFocus: document.hasFocus(),
                       active: document.activeElement ? document.activeElement.tagName : '',
                       modalOpen: !!document.querySelector('.ant-modal'),
                       value: i ? i.value : null,
                     }); })()`,
                );

              // ① 贴到左边缘 → 自动收起
              mainWindow?.show();
              mainWindow?.setPosition(wa.x + 2, Math.round(wa.y + wa.height / 2 - 300));
              await sleep(700);
              dockCtl?.forceDock();
              await sleep(3000);
              if (!dockCtl?.isDocked()) throw new Error('贴边收起失败，没进停靠态');

              // ② 悬停弹出图标列 → 点「任务」把面板拉开
              dockCtl?.peekIn();
              await sleep(1800);
              const pw = panel();
              console.log('SHOT31_RAIL', JSON.stringify(pw.getBounds()), 'visible=' + pw.isVisible());
              await clickIn(
                pw,
                `[...document.querySelectorAll('.dock-rail-item')].find((b) => b.getAttribute('title') === '任务')`,
              );
              await sleep(2200);
              console.log('SHOT31_PANEL_OPEN', JSON.stringify(pw.getBounds()));

              // ③ 核心断言：面板窗口必须可聚焦。不可聚焦的窗口（WS_EX_NOACTIVATE）
              //    在 Windows 上一点键盘都收不到，面板里的输入框注定是死的。
              const focusable = pw.isFocusable();
              console.log(
                'SHOT31_PANEL_FOCUS',
                'focusable=' + focusable,
                'focused=' + pw.isFocused(),
                'hwnd=' + hwndOf(pw),
                'renderer=' + (await stateOf(pw)),
              );
              if (!focusable) {
                throw new Error('面板窗口 focusable=false → 面板里的输入框收不到键盘（就是用户报的"打不进字"）');
              }

              // ④ 面板里点「新建任务」→ 点任务名称 → 打字 → 读回
              await clickIn(
                pw,
                `[...document.querySelectorAll('.dock-panel-content button')].find((b) => b.textContent.trim() === '新建任务')`,
              );
              await sleep(1000);
              await clickIn(pw, `document.querySelector('.ant-modal input')`);
              await sleep(300);
              await typeIn(pw, 'abc');
              await sleep(400);
              const stPanel = JSON.parse(await stateOf(pw)) as { value: string | null; hasFocus: boolean };
              await smokeCaptureAuxWindow(pw, '31-panel-input.png', smokeDir);
              console.log('SHOT31_PANEL_TYPED', JSON.stringify(stPanel));
              if (stPanel.value !== 'abc') {
                throw new Error(`面板里的输入框没收到键入：value=${JSON.stringify(stPanel.value)}`);
              }

              // ⑤ 展开完整窗口，同一个表单在主窗口里再验一遍（这条走的是 hide→show 的老路）
              dockCtl?.expandManually('tasks');
              await sleep(2800);
              const mw = mainWindow;
              if (!mw || mw.isDestroyed()) throw new Error('展开后主窗口不存在');
              console.log(
                'SHOT31_MAIN',
                JSON.stringify(mw.getBounds()),
                'visible=' + mw.isVisible(),
                'focused=' + mw.isFocused(),
              );
              if (!mw.isVisible()) throw new Error('展开后主窗口不可见');
              await clickIn(
                mw,
                `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '新建任务')`,
              );
              await sleep(1000);
              await clickIn(mw, `document.querySelector('.ant-modal input')`);
              await sleep(300);
              await typeIn(mw, 'xyz');
              await sleep(400);
              const stMain = JSON.parse(await stateOf(mw)) as { value: string | null };
              await smokeCaptureAuxWindow(mw, '31-main-input.png', smokeDir);
              console.log('SHOT31_MAIN_TYPED', JSON.stringify(stMain));
              if (stMain.value !== 'xyz') {
                throw new Error(`展开后主窗口输入框没收到键入：value=${JSON.stringify(stMain.value)}`);
              }
              console.log('SHOT31_OK 贴边面板与展开后的主窗口都能正常输入');
            } else if (SHOT === 32) {
              // 验证 4 项改动中可在运行时确认的两点：
              //  · item 1：今日待办纳入「跨天任务」——建 start=昨天、due=明天的任务，
              //    断言 dashboardStats().todayDue 包含它（旧逻辑仅 due_date=今天，必漏）。
              //  · item 2：番茄钟桌面小组件能打开并渲染——ipc 调 pomoWidget:toggle，
              //    断言『番茄钟小组件』窗口出现且可见，且 DOM 里有计时文字（.pomo-w-time）。
              // 附：createTask 会广播 data:changed，主窗口 reload 不应崩（item 3 接线冒烟）。
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不存在');
              await sleep(1500);
              const jsIn = <T>(code: string): Promise<T> =>
                mainWindow!.webContents.executeJavaScript(code) as Promise<T>;

              const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
              const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
              await jsIn(
                `window.api.createTask({ title: 'SHOT32跨天任务', start_date: '${yesterday}', due_date: '${tomorrow}' }).then(()=>'ok')`,
              );
              await sleep(900);

              const todayDue: { title: string }[] = await jsIn(
                'window.api.dashboardStats().then(s=>s.todayDue.map(t=>({title:t.title})))',
              );
              const hasSpanned = todayDue.some((t) => t.title === 'SHOT32跨天任务');
              console.log('SHOT32_TODAYDUE', JSON.stringify(todayDue.map((t) => t.title)), 'hasSpanned=' + hasSpanned);
              if (!hasSpanned) throw new Error('今日待办未纳入跨天任务（item 1 修复未生效或 asar 未重建）');

              pomodoroWidget.togglePomodoroWidget();
              await sleep(2500);
              const pwin = pomodoroWidget.getPomodoroWidget();
              if (!pwin || pwin.isDestroyed()) throw new Error('番茄钟小组件窗口未创建');
              if (!pwin.isVisible()) throw new Error('番茄钟小组件窗口不可见');
              const ptime = await pwin.webContents.executeJavaScript(
                `document.querySelector('.pomo-w-time') ? document.querySelector('.pomo-w-time').textContent : null`,
              );
              console.log('SHOT32_POMO_WIDGET', 'visible=' + pwin.isVisible(), 'time=' + ptime);
              if (!ptime) throw new Error('番茄钟小组件未渲染计时（DOM 缺 .pomo-w-time）');
              await smokeCaptureAuxWindow(pwin, '32-pomo-widget.png', smokeDir);

              // 顺手开一下任务小组件，确认不崩
              widget.toggleWidget();
              await sleep(1500);

              console.log('SHOT32_OK 今日待办已纳入跨天任务 + 番茄钟小组件可打开并渲染');
            } else if (SHOT === 33) {
              // 视觉核对 item 4：总览页「今日专注」卡片排版。
              // 两个坑：
              //  ① SMOKE 下主窗口默认 show:false（buildMainWindow 里 `if (!SMOKE) w.show()`），
              //     直接 capturePage 只能拍到空白，必须显式 show()。
              //  ② 专注记录用主进程直接写库（pomodoro.recordSession），不要走渲染层 IPC：
              //     渲染层在 did-finish-load 里有自己的 location.reload()，走 IPC 会与它抢时序，
              //     曾出现「库里已有 70 分钟、卡片仍显示 0 分钟」。
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不存在');
              const todayStr = dayjs().format('YYYY-MM-DD');
              const at = (h: number, m: number) =>
                `${todayStr} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
              for (const s of [
                { started_at: at(9, 0), ended_at: at(9, 25), minutes: 25 },
                { started_at: at(10, 0), ended_at: at(10, 25), minutes: 25 },
                { started_at: at(14, 0), ended_at: at(14, 20), minutes: 20 },
              ] as const) {
                pomodoro.recordSession({ task_id: null, kind: 'focus', ...s });
              }
              // 等渲染层跑完「首次加载 → 自身 reload → 挂载总览页」这一套；
              // 再用 tasks↔dashboard 的 hash 往返强制总览页重新挂载、重新拉 stats，
              // 确保拿到刚写入的专注数据（不是挂载在播种之前的旧 0）。
              await sleep(2200);
              mainWindow.show();
              await mainWindow.webContents.executeJavaScript(`location.hash = '#/tasks';`);
              await sleep(600);
              await mainWindow.webContents.executeJavaScript(`location.hash = '#/dashboard';`);
              await sleep(1800);
              const isDark = process.env.WORKBENCH_DARK === '1';
              await smokeCaptureAuxWindow(
                mainWindow,
                isDark ? '33-dashboard-dark.png' : '33-dashboard.png',
                smokeDir,
              );
              const focusText = await mainWindow.webContents.executeJavaScript(
                `(() => { const n = document.querySelector('.focus-stat-num'); const s = document.querySelector('.focus-stat-sub'); return n ? (n.textContent + ' | ' + (s ? s.textContent : '')) : null; })()`,
              );
              console.log('SHOT33_FOCUS_CARD', focusText);
              console.log(
                'SHOT33_OK 总览页已截图（今日专注应为 70 分钟 / 3 个番茄），dark=' + isDark,
              );
            } else if (SHOT === 34) {
              // 验证 item 3：跨窗口同步（主窗口 ↔ 任务小组件 ↔ 贴边面板）。
              // 三个窗口是三个独立 React 实例，靠 data:changed / settings:changed 广播保持一致：
              //  ① 主窗口建任务（due_date=今天，保证落进小组件今日清单）→ 小组件应自动出现
              //  ② 小组件里改任务标题 → 主窗口任务页应自动更新
              //  ③ 主窗口切深色 → rail 窗口（面板同款挂载方式）应把 dataset.theme 切成 dark
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不存在');
              mainWindow.show();
              await mainWindow.webContents.executeJavaScript(`location.hash = '#/tasks';`);
              await sleep(900);

              // ① 任务小组件（收缩态视图之一）
              widget.toggleWidget();
              await sleep(2500);
              const wwin = widget.getWidget();
              if (!wwin || wwin.isDestroyed()) throw new Error('任务小组件窗口未创建');

              const today = dayjs().format('YYYY-MM-DD');
              await mainWindow.webContents.executeJavaScript(
                `window.api.createTask({ title: 'SHOT34跨窗同步', status: 'todo', due_date: '${today}' }).then(()=>'ok')`,
              );
              await sleep(1800);
              const widgetHas = await wwin.webContents.executeJavaScript(
                `(document.body.innerText || '').includes('SHOT34跨窗同步')`,
              );
              console.log('SHOT34_TASK_SYNC main→widget', 'widgetHas=' + widgetHas);
              if (!widgetHas) throw new Error('主窗口新建任务未同步到任务小组件');

              // ② 在小组件窗口里改标题 → 主窗口任务页应自动刷新出新标题
              const tid = await mainWindow.webContents.executeJavaScript(
                `window.api.listTasks().then(ts => { const t = ts.find(x => x.title === 'SHOT34跨窗同步'); return t ? t.id : 0; })`,
              );
              if (!tid) throw new Error('任务未入库');
              await wwin.webContents.executeJavaScript(
                `window.api.updateTask(${tid}, { title: 'SHOT34跨窗同步-改' }).then(()=>'ok')`,
              );
              await sleep(1800);
              const mainHas = await mainWindow.webContents.executeJavaScript(
                `(document.body.innerText || '').includes('SHOT34跨窗同步-改')`,
              );
              console.log('SHOT34_TASK_SYNC widget→main', 'mainHas=' + mainHas);
              if (!mainHas) throw new Error('小组件改任务未同步回主窗口');

              // ③ 主题同步：rail 窗口与面板同款挂载方式（loadFile + hash=/rail?side=left）
              const railWin = new BrowserWindow({
                width: 220,
                height: 620,
                frame: false,
                show: false,
                skipTaskbar: true,
                backgroundColor: '#181a20',
                webPreferences: { preload: path.join(__dirname, 'preload.js') },
              });
              await railWin.loadFile(path.join(appDir, 'dist/index.html'), { hash: '/rail?side=left' });
              railWin.showInactive();
              await sleep(1200);
              await mainWindow.webContents.executeJavaScript(
                `window.api.setSetting('theme','dark').then(()=>'ok')`,
              );
              await sleep(1200);
              const railTheme = await railWin.webContents.executeJavaScript(
                `document.documentElement.dataset.theme || 'light'`,
              );
              console.log('SHOT34_THEME_SYNC main→rail', 'railTheme=' + railTheme);
              await mainWindow.webContents.executeJavaScript(
                `window.api.setSetting('theme','light').then(()=>'ok')`,
              );
              railWin.destroy();
              if (railTheme !== 'dark') throw new Error('主窗口切深色未同步到贴边面板窗口');

              await smokeCaptureAuxWindow(wwin, '34-widget-sync.png', smokeDir);
              console.log('SHOT34_OK 跨窗任务双向同步 + 主题跨窗同步均生效');
            } else if (SHOT === 24 || SHOT === 25 || SHOT === 26) {
              // 真机诊断：透明窗口是否真的透明。capturePage() 会丢 alpha，
              // 只有「真实屏幕截图」能区分「透明」和「白底」。
              // 24 = 启动项小组件，25 = 任务小组件，26 = 便签
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              const wa = screen.getPrimaryDisplay().workArea;
              await sleep(2000);
              let target: BrowserWindow | null = null;
              if (SHOT === 24) {
                launchWidget.toggleLaunchWidget();
                await sleep(3000);
                target = launchWidget.getLaunchWidget();
              } else if (SHOT === 25) {
                widget.toggleWidget();
                await sleep(3000);
                target = widget.getWidget();
              } else {
                const n = notes.createNote({ content: '点这里编辑便签内容\n自动保存 · 拖动顶部移动', color: 'yellow' });
                notes.openNote(n.id);
                await sleep(3000);
                target = notes.getNoteWindow(n.id);
              }
              if (!target) throw new Error('目标窗口未创建');
              // 挪到桌面壁纸区域上方 + 藏掉主窗口，避免「背后正好是白色窗口」干扰判断
              target.setPosition(wa.x + 120, wa.y + 380);
              mainWindow?.hide();
              await sleep(1500);
              const b = target.getBounds();
              console.log(
                'TRANS_TARGET_BOUNDS',
                SHOT,
                JSON.stringify(b),
                'url=',
                target.webContents.getURL().split('#')[0],
                'hash=',
                target.webContents.getURL().split('#')[1] ?? '',
              );
              await smokeDeskCapture(target, `trans-${SHOT}.png`, smokeDir, wa);
            } else if (SHOT === 22) {
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              const wa = screen.getPrimaryDisplay().workArea;
              console.log('WA=', JSON.stringify(wa));
              mainWindow?.show();
              // 放到工作区偏中间的位置（非贴边），验证「收缩」能从任意位置收起
              mainWindow?.setPosition(wa.x + 80, wa.y + 80);
              await sleep(600);
              console.log('PRECOLLAPSE isDocked=', dockCtl?.isDocked());
              dockCtl?.collapse();
              await sleep(1800);
              console.log('POSTCOLLAPSE isDocked=', dockCtl?.isDocked());
              if (!dockCtl?.isDocked()) throw new Error('收缩后未进入停靠态');
              const hw = getHandleWindow();
              console.log('HANDLE_AFTER_COLLAPSE=', !!hw, hw ? JSON.stringify(hw.getBounds()) : '');
              if (!hw) throw new Error('收缩后未出现贴边把手窗口');
              await smokeCaptureAuxWindow(hw, '22-collapse-handle.png', smokeDir);
              // 把手也是透明窗口，同样用真实屏幕截图确认没有白边。
              // 多等一会儿：神灯动画覆盖层要等动画跑完才会 hide()，别把它拍进来。
              await sleep(4000);
              await smokeDeskCapture(hw, '22-handle-desk.png', smokeDir, wa, 120);
            } else if (SHOT === 23) {
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              const wa = screen.getPrimaryDisplay().workArea;
              const prefix = process.env.WORKBENCH_SHOT_PREFIX ?? '';
              console.log('WA=', JSON.stringify(wa));
              mainWindow?.show();
              // 贴到工作区顶边（x 居中，y = wa.y），模拟把窗口拖到屏幕顶部。
              // 必须显式指定尺寸：窗口过宽时右侧先贴边，会被判定成 right 而不是 top。
              const w0 = 760;
              const h0 = 560;
              mainWindow?.setBounds({
                x: Math.round(wa.x + (wa.width - w0) / 2),
                y: wa.y,
                width: w0,
                height: h0,
              });
              await sleep(700);
              dockCtl?.forceDock();
              await sleep(2800);
              const hw = getHandleWindow();
              if (!hw) throw new Error('顶部停靠后把手窗口缺失');
              console.log('TOP_HANDLE_BOUNDS', JSON.stringify(hw.getBounds()));
              await smokeCaptureAuxWindow(hw, `${prefix}23-top-handle.png`, smokeDir);
              dockCtl?.peekIn();
              // 等渲染层量出内容宽度并回报，主进程据此把图标栏收成一条（不再铺满整屏）
              let w = getRailWindow();
              for (let i = 0; i < 24; i++) {
                await sleep(300);
                const cand = getRailWindow();
                if (cand && cand.getBounds().width < wa.width) {
                  w = cand;
                  break;
                }
              }
              if (!w) throw new Error('顶部图标栏窗口缺失');
              const rb = w.getBounds();
              console.log(
                'TOP_RAIL_BOUNDS',
                JSON.stringify(rb),
                'visible=' + w.isVisible(),
                'gapFromWorkAreaTop=',
                rb.y - wa.y,
                'screenW=',
                wa.width,
              );
              if (rb.y !== wa.y) throw new Error(`顶部图标栏未贴边：y=${rb.y}，应为 ${wa.y}`);
              if (rb.width >= wa.width) throw new Error(`顶部图标栏仍铺满整屏：width=${rb.width}`);
              try {
                await smokeCaptureAuxWindow(w, `${prefix}23-top-rail.png`, smokeDir);
              } catch (e) {
                console.log('TOP_RAIL_CAPTURE_SKIP', String(e));
              }
              // 再截一条真实屏幕顶部：最直观地证明图标栏贴住屏幕上缘、且不再铺满整屏
              try {
                const sources = await desktopCapturer.getSources({
                  types: ['screen'],
                  thumbnailSize: { width: wa.width, height: wa.height },
                });
                const primary =
                  sources.find((s) => s.display_id === String(screen.getPrimaryDisplay().id)) ?? sources[0];
                if (!primary) throw new Error('取不到屏幕源');
                const full = primary.thumbnail;
                const size = full.getSize();
                const top = full.crop({
                  x: 0,
                  y: 0,
                  width: size.width,
                  height: Math.min(200, size.height),
                });
                fs.writeFileSync(path.join(smokeDir, `${prefix}23-top-desk.png`), top.toPNG());
                console.log('TOP_DESK_CAPTURE_OK', JSON.stringify(size));
              } catch (e) {
                console.log('TOP_DESK_CAPTURE_FAIL', String(e));
              }
              // 顶部栏点开内容面板后仍应贴着屏幕上缘
              dockCtl?.openPanel('pomodoro');
              await sleep(2200);
              const pw = getRailWindow();
              const pb = pw?.getBounds();
              console.log('TOP_PANEL_BOUNDS', JSON.stringify(pb));
              if (!pb || pb.y !== wa.y) throw new Error(`顶部面板未贴边：${JSON.stringify(pb)}`);
            } else if (SHOT === 16) {
              const wa = screen.getPrimaryDisplay().workArea;
              const prefix = process.env.WORKBENCH_SHOT_PREFIX ?? '';
              const darkRun = process.env.WORKBENCH_DARK === '1';
              const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
              mainWindow?.show();
              mainWindow?.setPosition(wa.x + 2, Math.round(wa.y + wa.height / 2 - 300));
              if (darkRun) {
                // 先落盘主题偏好，稍后新建的图标栏/面板窗口会按深色渲染
                await mainWindow?.webContents
                  .executeJavaScript("window.api.setSetting('theme','dark')")
                  .catch(() => undefined);
                await sleep(300);
              }
              await sleep(400);
              dockCtl?.forceDock();
              await sleep(2800);
              const hw = getHandleWindow();
              if (!hw) throw new Error('handle missing');
              console.log('HANDLE_BOUNDS', JSON.stringify(hw.getBounds()));
              await smokeCaptureAuxWindow(hw, `${prefix}16-handle.png`, smokeDir);
              dockCtl?.peekIn();
              await sleep(1600);
              const w = getRailWindow();
              if (!w) throw new Error('rail missing');
              const railState = await w.webContents.executeJavaScript(
                'JSON.stringify({ hash: location.hash, root: document.getElementById("root")?.children.length })',
              );
              console.log(
                'RAIL_STATE',
                JSON.stringify(w.getBounds()),
                'visible=' + w.isVisible(),
                railState,
              );
              try {
                if (w.isVisible()) await smokeCaptureAuxWindow(w, `${prefix}16-rail.png`, smokeDir);
                else console.log('AUX_RAIL_HIDDEN_SKIP');
              } catch (e) {
                console.log('AUX_RAIL_CAPTURE_SKIP', String(e));
              }
              dockCtl?.openPanel('pomodoro');
              await sleep(1600);
              console.log('PANEL_BOUNDS', JSON.stringify(w.getBounds()));
              try {
                if (w.isVisible()) await smokeCaptureAuxWindow(w, `${prefix}17-panel.png`, smokeDir);
                else console.log('AUX_PANEL_HIDDEN_SKIP');
              } catch (e) {
                console.log('AUX_PANEL_CAPTURE_SKIP', String(e));
              }
            } else {
              searchMod.toggleSearch();
              await new Promise((r) => setTimeout(r, 2500));
              const w = searchMod.getSearchWindow();
              if (!w) throw new Error('搜索窗口未创建');
              await smokeCaptureAuxWindow(w, '14-search.png', smokeDir);
              await smokeDeskCapture(w, '14-search-desk.png', smokeDir, screen.getPrimaryDisplay().workArea);
            }
            console.log('SMOKE_OK');
            app.exit(0);
          } catch (e) {
            console.error('SMOKE_FAIL', e);
            app.exit(1);
          }
        })();
      }
      if (SMOKE && SHOT === 13) {
        clipboardMod.seedDemoClips();
      }
    })
    .catch((err) => {
      console.error('INIT_FAILED', err);
      app.exit(1);
    });
}

// ---------- 内存优化：Chromium 开关（必须在 app ready 前设置） ----------
// ⚠️ 不要开 `--process-per-site`。它能把全部窗口合并进一个渲染进程、省约 160MB，
//    但和本应用的「多个透明无边框窗口」**不可共存**：实测（Electron 33 + Windows 11）
//    同一渲染进程里只有**第一个**窗口能拿到带 alpha 的合成表面，之后创建的透明窗口
//    全部被刷成不透明白底 —— 小组件 / 便签 / 贴边拉手因此都会多出一圈白边。
//    （换成独立 origin 也只能救第一个窗口，第二个透明窗口照样白。）
//    → 想回收这部分内存，正确方向是把辅助窗口拆成独立的小 bundle（多入口构建），
//      让每个辅助窗口本身就更轻，而不是让它们共享渲染进程。
//    回归护栏：`WORKBENCH_SMOKE=1 WORKBENCH_SHOT=24|25|26` 会真机截屏并检验白边。
//
// Chromium 默认会预留一个「备用渲染进程」以加速后续跳转；本应用常年托盘常驻、很少新开页面，
// 关掉可以少一份常驻内存。这一项与透明无关，实测无副作用。
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMain();
  });
  app.whenReady().then(bootstrap);
}

app.on('before-quit', () => {
  quitting = true;
  notes.setQuitting(true);
  hotkeys.unregisterAllHotkeys();
  persistNow();
});

app.on('window-all-closed', () => {
  persistNow();
  // 托盘常驻应用：所有窗口关闭后不要退出，等待用户从托盘/热键重新打开主窗口。
  // 否则主窗口在停靠隐藏态被外部销毁、辅助窗口又被 dispose 后，这里会误触发 app.quit()，
  // 导致新建的主窗口来不及显示、整个程序直接退出（表现为“启动后主界面打不开”）。
  if (!quitting && trayMod.isTrayReady()) return;
  app.quit();
});
