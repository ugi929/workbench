import { app, BrowserWindow, Notification, Rectangle, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { kvGet, kvSet } from './db';
import { appLog } from './logger';

const EDGE = 10;
const LEAVE_INTERVAL = 250;
const LEAVE_COUNT = 3; // 鼠标离开约 0.75 秒后收回
const RAIL_W = 64; // 图标菜单宽度
const RAIL_TOP_H = 56;
const PANEL_W = 800; // 内容面板宽度（含图标列）
const HANDLE = 22; // 收起态把手：露出屏幕边缘的宽度
const HANDLE_LEN = 78; // 收起态把手：拉手本身的长度
const HANDLE_PAD = 8; // 透明窗口在非贴边方向预留的余量（给圆角与投影留空间）
const HANDLE_SPAN = HANDLE_LEN + HANDLE_PAD * 2; // 窗口沿边缘方向的整长
const HIT_POLL = 60; // 收起态：光标命中检测间隔（ms）
const HIT_GRACE = 3; // 光标离开拉手实体后，连续 N 次（≈180ms）才切回穿透
const SLIDE_STEPS = 8;
const SLIDE_INTERVAL = 20;
const TOP_RAIL_MIN_W = 360; // 顶部图标栏自适应的最小宽度
// 冒烟测试用：钉住展开态，方便截图（真实使用时不生效）
const HOLD_FOR_TEST = process.env.WORKBENCH_DOCK_HOLD === '1';
// 冒烟测试用：强制把手停靠位置（0~1，沿边缘的比例），便于验证边界几何
const FORCE_FRAC = (() => {
  const v = parseFloat(process.env.WORKBENCH_DOCK_FRAC ?? '');
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
})();

type Side = 'left' | 'right' | 'top';
type Exposed = 'none' | 'rail' | 'panel';

let appPath = '.';
let handleWin: BrowserWindow | null = null; // 收起态：40×40 蓝色小图标
let railWin: BrowserWindow | null = null; // 菜单态：64 宽图标列；面板态：图标列+内容
let animWin: BrowserWindow | null = null;
let lastShot: string | null = null;
let railFrac: { left: number; right: number; top: number } = { left: 0.5, right: 0.5, top: 0.5 };
let dockNotified = false;
// 顶部图标栏的自然内容宽度（由渲染层量出后回报并落盘），避免铺满整个屏幕宽度
let topRailFitW: number | null = null;

export function initEdgeDock(dir: string): void {
  appPath = dir;
  try {
    const saved = kvGet('railPos');
    if (saved) railFrac = { ...railFrac, ...(JSON.parse(saved) as typeof railFrac) };
  } catch {
    // 位置数据损坏时用默认值
  }
  try {
    const w = parseInt(kvGet('railFitTop') ?? '', 10);
    if (Number.isFinite(w) && w > 0) topRailFitW = w;
  } catch {
    // 宽度缓存损坏时按内容重新量
  }
  if (FORCE_FRAC !== null) railFrac = { left: FORCE_FRAC, right: FORCE_FRAC, top: FORCE_FRAC };
}

function saveRailFrac(s: Side, frac: number): void {
  railFrac[s] = Math.min(1, Math.max(0, frac));
  kvSet('railPos', JSON.stringify(railFrac));
}

export function getRailWindow(): BrowserWindow | null {
  return railWin && !railWin.isDestroyed() ? railWin : null;
}

export function getHandleWindow(): BrowserWindow | null {
  return handleWin && !handleWin.isDestroyed() ? handleWin : null;
}

function inRect(p: { x: number; y: number }, r: Rectangle, margin = 0): boolean {
  return (
    p.x >= r.x - margin && p.x <= r.x + r.width + margin && p.y >= r.y - margin && p.y <= r.y + r.height + margin
  );
}

/**
 * 收起态拉手窗口里「实体拉手」的矩形（屏幕坐标）。窗口是 30×94 的透明窗口，
 * 实体只占 22×78，其余都是透明留白（给圆角与投影）。
 * 透明像素同样参与 Windows 命中测试 —— 整窗范围内桌面图标都会被挡住，
 * 所以收起态要靠这个矩形做光标命中检测：只有落在它里面才让窗口吃鼠标。
 * 与 styles.css 的 .tab-left / .tab-right / .tab-top 严格对应（实体贴屏幕边、非贴边侧留 PAD）。
 */
export function handleHitRect(s: Side, b: Rectangle): Rectangle {
  if (s === 'top') return { x: b.x + HANDLE_PAD, y: b.y, width: HANDLE_LEN, height: HANDLE };
  if (s === 'left') return { x: b.x, y: b.y + HANDLE_PAD, width: HANDLE, height: HANDLE_LEN };
  return { x: b.x + HANDLE_PAD, y: b.y + HANDLE_PAD, width: HANDLE, height: HANDLE_LEN };
}

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function attachEdgeDock(
  win: BrowserWindow,
  enabled: () => boolean,
  opts: { onFullExpanded: (page?: string) => void },
): {
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
} {
  let side: Side | null = null;
  let docked = false;
  let exposed: Exposed = 'none';
  let animating = false;
  let leaveHits = 0;
  let dockTimer: ReturnType<typeof setTimeout> | null = null;
  let leaveTimer: ReturnType<typeof setInterval> | null = null;
  let slideTimer: ReturnType<typeof setInterval> | null = null;
  let hitTimer: ReturnType<typeof setInterval> | null = null;
  // 拉手窗口当前是否吃鼠标（true = 正常命中）。见 startHitWatch 的说明。
  let handleClickable = true;
  let hitMiss = 0;
  let panelPage: string | null = null;

  const ok = () => !win.isDestroyed() && enabled() && !win.isMaximized() && !win.isFullScreen();

  // 停靠所在显示器的可用区域：多显示器下不要写死主屏。
  // 兜底同样要防主窗口已销毁，否则 peek/leave 回调里会抛 "Object has been destroyed"
  const workAreaOf = (...refs: (BrowserWindow | null)[]): Rectangle => {
    for (const r of refs) {
      if (r && !r.isDestroyed()) return screen.getDisplayMatching(r.getBounds()).workArea;
    }
    if (win && !win.isDestroyed()) return screen.getDisplayMatching(win.getBounds()).workArea;
    return screen.getPrimaryDisplay().workArea;
  };

  const stopTimers = () => {
    if (leaveTimer) {
      clearInterval(leaveTimer);
      leaveTimer = null;
    }
  };

  const dockedBounds = (s: Side, wa: Rectangle, b: Rectangle): Rectangle => {
    const y = Math.min(Math.max(b.y, wa.y), Math.max(wa.y, wa.y + wa.height - b.height));
    const x = Math.min(Math.max(b.x, wa.x), Math.max(wa.x, wa.x + wa.width - b.width));
    if (s === 'left') return { ...b, x: wa.x - b.width, y };
    if (s === 'right') return { ...b, x: wa.x + wa.width, y };
    return { ...b, y: wa.y - b.height, x };
  };

  const fullBounds = (s: Side, wa: Rectangle, b: Rectangle): Rectangle => {
    if (s === 'left') return { ...b, x: wa.x };
    if (s === 'right') return { ...b, x: wa.x + wa.width - b.width };
    return { ...b, y: wa.y };
  };

  // 沿边缘方向可用行程（窗口左上角在其中滑动，保证整窗始终落在工作区内）
  function travel(s: Side, wa: Rectangle): number {
    const total = s === 'top' ? wa.width : wa.height;
    return Math.max(1, total - HANDLE_SPAN);
  }

  // 窗口沿边缘方向的左上角坐标 → 位置比例（与 handleBounds 同一套换算，避免记忆位置漂移）
  function fracAt(s: Side, wa: Rectangle, shellStart: number): number {
    const base = s === 'top' ? wa.x : wa.y;
    return Math.min(1, Math.max(0, (shellStart - base) / travel(s, wa)));
  }

  // 收起态把手：贴紧屏幕边缘的一枚透明小拉手（圆角/投影在窗口内渲染）
  function handleBounds(s: Side, wa: Rectangle): Rectangle {
    const frac = Math.min(1, Math.max(0, railFrac[s]));
    if (s === 'top') {
      return {
        x: Math.round(wa.x + frac * travel('top', wa)),
        y: wa.y,
        width: HANDLE_SPAN,
        height: HANDLE + HANDLE_PAD,
      };
    }
    return {
      x: s === 'left' ? wa.x : wa.x + wa.width - HANDLE - HANDLE_PAD,
      y: Math.round(wa.y + frac * travel(s, wa)),
      width: HANDLE + HANDLE_PAD,
      height: HANDLE_SPAN,
    };
  }

  function setHandleClickable(v: boolean, notify = true): void {
    if (v === handleClickable) return;
    handleClickable = v;
    const w = handleWin;
    if (!w || w.isDestroyed()) return;
    try {
      w.setIgnoreMouseEvents(!v, { forward: false });
    } catch (err) {
      appLog('dock: setIgnoreMouseEvents fail', err);
    }
    // 穿透时渲染层收不到 mouseleave：由主进程告诉它把「悬停滑出」的计时器撤掉；
    // 恢复命中时补一个 in，避免光标移入后停住不动、渲染层迟迟等不到 mouseenter。
    // notify=false 用于「拉手即将隐藏 / 已隐藏」的复位：那时不该再触发悬停展开。
    if (notify) w.webContents.send('dock:pointer', v ? 'in' : 'out');
    appLog('dock: hit', v ? 'interactive' : 'pass-through');
  }

  function stopHitWatch(): void {
    if (hitTimer) {
      clearInterval(hitTimer);
      hitTimer = null;
    }
    hitMiss = 0;
    // 复位成可交互（下次显示时不必等轮询），但不通知渲染层：窗口正要隐藏
    setHandleClickable(true, false);
  }

  function startHitWatch(): void {
    if (hitTimer) return;
    hitMiss = 0;
    hitTimer = setInterval(() => {
      const w = handleWin;
      if (!w || w.isDestroyed() || !side) return;
      // 图标栏/面板滑出后拉手已隐藏：复位为常规命中（那是正经交互面，不能穿透），也不通知
      if (!w.isVisible() || exposed !== 'none') {
        hitMiss = 0;
        setHandleClickable(true, false);
        return;
      }
      if (inRect(screen.getCursorScreenPoint(), handleHitRect(side, w.getBounds()))) {
        hitMiss = 0;
        setHandleClickable(true);
        return;
      }
      // 留一点宽限：拖动把手时窗口跟着光标走，瞬时判定落空不该把按下状态打断
      hitMiss += 1;
      if (hitMiss >= HIT_GRACE) setHandleClickable(false);
    }, HIT_POLL);
  }

  // 图标菜单展开位置：以把手中心为菜单中心（越界时夹回屏幕内）
  function railShownBounds(s: Side, wa: Rectangle): Rectangle {    const hb = handleBounds(s, wa);
    if (s === 'top') {
      // 顶部：紧贴屏幕上缘，宽度按内容自适应（量不到时先用缓存值/整屏兜底），
      // 并以把手中心为栏中心，越界时夹回屏幕内。
      const w = Math.round(Math.min(wa.width, Math.max(TOP_RAIL_MIN_W, topRailFitW ?? wa.width)));
      const cx = hb.x + hb.width / 2;
      const x = Math.round(Math.min(Math.max(cx - w / 2, wa.x), Math.max(wa.x, wa.x + wa.width - w)));
      return { x, y: wa.y, width: w, height: RAIL_TOP_H };
    }
    const h = Math.min(wa.height, 640);
    const hc = hb.y + hb.height / 2;
    const y = Math.round(Math.min(Math.max(hc - h / 2, wa.y), wa.y + wa.height - h));
    if (s === 'left') return { x: wa.x, y, width: RAIL_W, height: h };
    return { x: wa.x + wa.width - RAIL_W, y, width: RAIL_W, height: h };
  }

  function panelBounds(s: Side, wa: Rectangle): Rectangle {
    const panelW = RAIL_W + PANEL_W;
    if (s === 'left') return { x: wa.x, y: wa.y, width: panelW, height: wa.height };
    if (s === 'right') return { x: wa.x + wa.width - panelW, y: wa.y, width: panelW, height: wa.height };
    return { x: wa.x, y: wa.y, width: panelW, height: wa.height };
  }

  function showHandle(s: Side, wa: Rectangle): void {
    try {
      const bounds = handleBounds(s, wa);
      startHitWatch();
      if (handleWin && !handleWin.isDestroyed()) {
        handleWin.setBounds(bounds);
        handleWin.webContents
          .executeJavaScript(`location.hash = '#/handle?side=${s}';`)
          .catch(() => undefined);
        handleWin.showInactive();
        return;
      }
      handleWin = new BrowserWindow({
        ...bounds,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        focusable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        title: '工作台',
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
      });
      handleWin.setAlwaysOnTop(true, 'screen-saver');
      void handleWin
        .loadFile(path.join(appPath, 'dist/index.html'), { hash: `/handle?side=${s}` })
        .then(() => {
          handleWin?.show();
        })
        .catch((err) => appLog('handle load fail', err));
    } catch (err) {
      appLog('dock: showHandle fail', err);
    }
  }

  function hideHandle(): void {
    stopHitWatch();
    if (handleWin && !handleWin.isDestroyed()) handleWin.hide();
  }

  function showRail(s: Side, wa: Rectangle): void {
    try {
      const bounds = railShownBounds(s, wa);
      if (railWin && !railWin.isDestroyed()) {
        railWin.setBounds(bounds);
        railWin.webContents
          .executeJavaScript(`location.hash = '#/rail?side=${s}';`)
          .catch(() => undefined);
        railWin.showInactive();
        return;
      }
      railWin = new BrowserWindow({
        ...bounds,
        frame: false,
        transparent: false,
        backgroundColor: '#181a20',
        resizable: false,
        // 必须可聚焦：点菜单项后这条栏会被拉宽成**面板**，面板里放的是真实页面
        //（任务列表的新建任务表单 / AI 输入框 / 设置项），要能打字。
        // Windows 上不可聚焦的窗口（WS_EX_NOACTIVATE）永远收不到键盘事件，
        // 表现就是「鼠标点得进输入框，字打不进去」。
        // 不会因此抢焦点：悬停弹出走的是 showInactive()（不激活窗口），
        // 只有用户真的点了图标列（=要开面板）时 Windows 才会把焦点交给它。
        focusable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        title: '工作台菜单',
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
      });
      railWin.setAlwaysOnTop(true, 'screen-saver');
      void railWin
        .loadFile(path.join(appPath, 'dist/index.html'), { hash: `/rail?side=${s}` })
        .then(() => {
          if (!railWin || railWin.isDestroyed()) return;
          // 用 showInactive：窗口现在可聚焦了，普通 show() 会把焦点从用户正在用的程序抢过来
          railWin.showInactive();
          appLog('rail shown:', 'visible=' + railWin.isVisible(), 'bounds=' + JSON.stringify(railWin.getBounds()));
        })
        .catch((err) => appLog('rail load fail', err));
    } catch (err) {
      appLog('dock: showRail fail', err);
    }
  }

  function hideRail(): void {
    if (railWin && !railWin.isDestroyed()) railWin.hide();
  }

  function tweenRailTo(target: Rectangle, done: () => void): void {
    if (!railWin || railWin.isDestroyed()) {
      done();
      return;
    }
    if (slideTimer) clearInterval(slideTimer);
    const from = railWin.getBounds();
    let i = 0;
    const timer = setInterval(() => {
      if (!railWin || railWin.isDestroyed()) {
        clearInterval(timer);
        slideTimer = null;
        return;
      }
      i += 1;
      const t = easeInOut(Math.min(1, i / SLIDE_STEPS));
      railWin.setBounds({
        x: Math.round(from.x + (target.x - from.x) * t),
        y: Math.round(from.y + (target.y - from.y) * t),
        width: Math.round(from.width + (target.width - from.width) * t),
        height: Math.round(from.height + (target.height - from.height) * t),
      });
      if (i >= SLIDE_STEPS) {
        clearInterval(timer);
        slideTimer = null;
        done();
      }
    }, SLIDE_INTERVAL);
    slideTimer = timer;
  }

  function startLeaveCheck(): void {
    if (leaveTimer) return;
    leaveHits = 0;
    leaveTimer = setInterval(() => {
      if (HOLD_FOR_TEST) return;
      if (!ok() || !docked || exposed === 'none') {
        if (leaveTimer) {
          clearInterval(leaveTimer);
          leaveTimer = null;
        }
        return;
      }
      // 面板里正在打字时不要自动收回：面板持有键盘焦点就说明用户正在里面填表单，
      // 此时鼠标就算飘到面板外也不该把面板（和没保存的内容）吞掉。
      // 焦点真的走了（用户点了别的程序）之后，鼠标离开自动收回照旧生效。
      if (exposed === 'panel' && railWin && !railWin.isDestroyed() && railWin.isFocused()) {
        leaveHits = 0;
        return;
      }
      const hoverTarget = railWin && !railWin.isDestroyed() ? railWin.getBounds() : win.getBounds();
      if (inRect(screen.getCursorScreenPoint(), hoverTarget, 4)) {
        leaveHits = 0;
        return;
      }
      leaveHits += 1;
      if (leaveHits >= LEAVE_COUNT) {
        if (leaveTimer) {
          clearInterval(leaveTimer);
          leaveTimer = null;
        }
        if (exposed === 'panel') collapsePanel();
        else if (exposed === 'rail') hideRail();
        exposed = 'none';
        if (side) showHandle(side, workAreaOf(railWin, win));
      }
    }, LEAVE_INTERVAL);
  }

  // 神灯动画覆盖层
  async function playGenie(
    imgDataUrl: string,
    from: Rectangle,
    point: { x: number; y: number },
    s: Side,
    dir: 'collapse' | 'expand',
  ): Promise<void> {
    const minX = Math.min(from.x, point.x) - 90;
    const minY = Math.min(from.y, point.y) - 90;
    const maxX = Math.max(from.x + from.width, point.x) + 90;
    const maxY = Math.max(from.y + from.height, point.y) + 90;
    const bounds: Rectangle = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

    if (!animWin || animWin.isDestroyed()) {
      animWin = new BrowserWindow({
        ...bounds,
        frame: false,
        transparent: true,
        resizable: true,
        focusable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        title: '工作台停靠动画',
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
      });
      animWin.setAlwaysOnTop(true, 'screen-saver');
      await animWin.loadFile(path.join(appPath, 'dist/index.html'), { hash: '/dockanim' });
    } else {
      animWin.setBounds(bounds);
    }
    animWin.showInactive();
    const rel = {
      from: { ...from, x: from.x - minX, y: from.y - minY },
      point: { x: point.x - minX, y: point.y - minY },
    };
    await animWin.webContents.executeJavaScript(
      `window.__playGenie(${JSON.stringify({ img: imgDataUrl, ...rel, side: s, dir })})`,
    );
    animWin.hide();
  }

  async function collapseAnimated(): Promise<void> {
    if (!side) return;
    stopTimers();
    appLog('dock: collapse start', side);
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const strip = dockedBounds(side, wa, b);
    const point = center(handleBounds(side, wa));

    let imgDataUrl = lastShot;
    try {
      const shot = await win.webContents.capturePage();
      if (!shot.isEmpty()) {
        // 缩到 1280 宽再编码：神灯动画只是把这张图缩小飞向把手，分辨率减半肉眼无感，
        // 但 base64 体积降到约 1/4（少几 MB 常驻字符串，也少一次大字符串 IPC 的解析开销）。
        const size = shot.getSize();
        const img = size.width > 1280 ? shot.resize({ width: 1280, quality: 'good' }) : shot;
        imgDataUrl = img.toDataURL();
      }
    } catch {
      // 截图失败时退化为无动画直接停靠
    }
    if (imgDataUrl) lastShot = imgDataUrl;

    animating = true;
    if (win.isVisible()) win.hide();
    try {
      if (imgDataUrl) await playGenie(imgDataUrl, b, point, side, 'collapse');
    } catch (err) {
      appLog('dock: anim fail', err);
      console.error('DOCK_ANIM_FAIL', err);
    }
    win.setBounds(strip);
    showHandle(side, wa);
    animating = false;
    exposed = 'none';
    if (!dockNotified) {
      dockNotified = true;
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: '工作台已折叠到屏幕边缘',
            body: '点击边缘的工作台小图标：悬停显示菜单，点把手展开完整窗口',
          }).show();
        }
      } catch {
        // 通知失败不影响停靠
      }
    }
    appLog('dock: collapsed, handle shown');
  }

  async function expandAnimated(page?: string): Promise<void> {
    if (!side) return;
    if (!win || win.isDestroyed()) {
      appLog('dock: expand skipped, main window destroyed');
      detach();
      return;
    }
    appLog('dock: expand start', page ?? '');
    hideRail();
    hideHandle();
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const full = fullBounds(side, wa, b);
    const point = center(handleBounds(side, wa));

    animating = true;
    try {
      if (lastShot) await playGenie(lastShot, full, point, side, 'expand');
    } catch (err) {
      appLog('dock: anim fail', err);
      console.error('DOCK_ANIM_FAIL', err);
    }
    lastShot = null;
    win.setBounds(full);
    if (!win.isVisible()) win.show();
    win.setOpacity(1);
    animating = false;
    docked = false;
    exposed = 'none';
    panelPage = null;
    appLog('dock: expanded');
    opts.onFullExpanded(page);
  }

  function openPanel(page: string): void {
    if (!docked || animating || !side || !railWin || railWin.isDestroyed()) return;
    const s = side;
    panelPage = page;
    exposed = 'panel';
    railWin.webContents
      .executeJavaScript(`location.hash = '#/rail?side=${s}&page=${page}';`)
      .catch(() => undefined);
    // 先把焦点交进来（用户刚点了图标列，此刻本进程是前台，聚焦一定能成功），
    // 动画跑完再交一次：期间渲染层刚换完页面，确保焦点落在真正有输入框的那一帧上。
    focusPanel();
    tweenRailTo(panelBounds(s, workAreaOf(railWin, win)), () => {
      startLeaveCheck();
      focusPanel();
    });
  }

  /**
   * 面板态：把键盘焦点明确交给面板窗口。
   * 面板里的页面是要打字的（任务表单 / AI 输入框 / 设置项），而 Windows 下窗口拿不到
   * 焦点时键盘事件根本不会派发进来 —— 表现就是「鼠标点得进输入框，字打不进去」。
   * 光靠「用户点了图标列所以窗口已激活」不够稳：窗口可能是 showInactive() 出来的、
   * 动画还在跑，这里显式聚焦一次，等价于用户点了一下面板。
   */
  function focusPanel(): void {
    if (!railWin || railWin.isDestroyed()) return;
    try {
      if (!railWin.isFocusable()) railWin.setFocusable(true);
      railWin.focus();
      railWin.webContents.focus();
      appLog('dock: panel focus', 'focusable=' + railWin.isFocusable(), 'focused=' + railWin.isFocused());
    } catch (err) {
      appLog('dock: panel focus fail', err);
    }
  }

  function collapsePanel(): void {
    if (!side || !railWin || railWin.isDestroyed()) return;
    hideRail();
  }

  function detach(): void {
    if (animating) return;
    side = null;
    docked = false;
    exposed = 'none';
    panelPage = null;
    stopTimers();
    hideRail();
    hideHandle();
  }

  // 「折叠」按钮：把展开中的主窗口收回到贴边图标栏（拖到边缘松手的同款神灯动画）。
  // 与 evaluate 不同——evaluate 只对「已经贴边」的窗口生效，这里要能从屏幕任意位置收起。
  function collapseManually(): void {
    if (!ok() || animating || docked) return;
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    // 选最近的可停靠边（左/右/上）。展开后的窗口本就贴着停靠边，所以通常正好回到用户原来那一侧。
    const dLeft = b.x - wa.x;
    const dRight = wa.x + wa.width - (b.x + b.width);
    const dTop = b.y - wa.y;
    const s: Side = dLeft <= dRight && dLeft <= dTop ? 'left' : dRight <= dTop ? 'right' : 'top';
    side = s;
    docked = true;
    exposed = 'none';
    panelPage = null;
    if (FORCE_FRAC === null) {
      if (s === 'top') saveRailFrac('top', fracAt('top', wa, b.x + b.width / 2 - HANDLE_SPAN / 2));
      else saveRailFrac(s, fracAt(s, wa, b.y + b.height / 2 - HANDLE_SPAN / 2));
    }
    appLog('dock: collapse manually →', s);
    collapseAnimated().catch((err) => appLog('dock: collapse fail', err));
  }

  const evaluate = (): void => {
    if (!ok() || animating) return;
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;

    if (docked && !win.isVisible()) return; // 停靠状态主窗口隐藏

    if (docked) {
      const full = fullBounds(side!, wa, b);
      if (Math.abs(b.x - full.x) > 60 || Math.abs(b.y - full.y) > 60) detach();
      return;
    }

    let s: Side | null = null;
    if (b.x <= wa.x + EDGE) s = 'left';
    else if (b.x + b.width >= wa.x + wa.width - EDGE) s = 'right';
    else if (b.y <= wa.y + EDGE) s = 'top';
    if (!s) return;

    side = s;
    docked = true;
    exposed = 'none';
    panelPage = null;
    if (FORCE_FRAC === null) {
      if (s === 'top') saveRailFrac('top', fracAt('top', wa, b.x + b.width / 2 - HANDLE_SPAN / 2));
      else saveRailFrac(s, fracAt(s, wa, b.y + b.height / 2 - HANDLE_SPAN / 2));
    }
    collapseAnimated().catch((err) => appLog('dock: collapse fail', err));
  };

  win.on('moved', () => {
    if (!ok() || animating) return;
    if (dockTimer) clearTimeout(dockTimer);
    dockTimer = setTimeout(evaluate, 260);
  });

  win.on('hide', () => detach());
  win.on('closed', () => {
    stopTimers();
    stopHitWatch();
    hideRail();
    if (handleWin && !handleWin.isDestroyed()) handleWin.hide();
  });

  return {
    openPanel: (page: string) => openPanel(page),
    expandManually: (page?: string) => {
      // 主窗口已被销毁（息屏/多屏切换/异常）时不能再去操作它，否则抛 “Object has been destroyed”
      if (!win || win.isDestroyed()) {
        appLog('dock: expand skipped, main window destroyed');
        detach();
        return;
      }
      if (docked && !animating) expandAnimated(page).catch((err) => appLog('dock: expand fail', err));
    },
    forceDock: evaluate,
    collapse: () => collapseManually(),
    isDocked: () => docked,
    // 渲染层量出图标栏的自然宽度后回报：缓存下面板用，当前正在展示的顶部栏立即贴合成该宽度
    fitRailWidth: (width: number) => {
      if (!Number.isFinite(width) || width <= 0) return;
      const px = Math.round(width);
      if (topRailFitW === px) return;
      topRailFitW = px;
      try {
        kvSet('railFitTop', String(px));
      } catch {
        // 落盘失败不影响本次贴合
      }
      if (side === 'top' && exposed === 'rail' && railWin && !railWin.isDestroyed() && !animating) {
        railWin.setBounds(railShownBounds('top', workAreaOf(railWin, win)));
      }
    },
    peekIn: () => {
      if (!docked || exposed === 'panel' || exposed === 'rail' || animating || !side) return;
      hideHandle();
      showRail(side, workAreaOf(handleWin, win));
      exposed = 'rail';
      startLeaveCheck();
    },
    peekOut: () => {
      if (!docked || exposed !== 'rail' || !side) return;
      const wa = workAreaOf(railWin, win);
      hideRail();
      exposed = 'none';
      showHandle(side, wa);
    },
    railDragTo: (pt: { x: number; y: number }) => {
      const target = handleWin && !handleWin.isDestroyed() ? handleWin : railWin;
      if (!target || target.isDestroyed() || !side) return;
      const b = target.getBounds();
      const wa = screen.getDisplayMatching(b).workArea;
      if (side === 'top') {
        const x = Math.min(Math.max(pt.x - b.width / 2, wa.x), wa.x + wa.width - b.width);
        target.setBounds({ ...b, x: Math.round(x) });
      } else {
        const y = Math.min(Math.max(pt.y - b.height / 2, wa.y), wa.y + wa.height - b.height);
        target.setBounds({ ...b, y: Math.round(y) });
      }
    },
    railDragEnd: () => {
      const target = handleWin && !handleWin.isDestroyed() ? handleWin : railWin;
      if (!target || target.isDestroyed() || !side) return;
      const b = target.getBounds();
      const wa = screen.getDisplayMatching(b).workArea;
      // 用拖动窗口的中心换算把手比例，保证松手后把手落在鼠标停下的位置
      if (side === 'top') saveRailFrac('top', fracAt('top', wa, b.x + b.width / 2 - HANDLE_SPAN / 2));
      else saveRailFrac(side, fracAt(side, wa, b.y + b.height / 2 - HANDLE_SPAN / 2));
      appLog('dock: handle moved to', railFrac[side].toFixed(2));
    },
    // 主窗口被销毁后重建前调用：清理本模块持有的把手/图标栏/动画窗口，避免残留
    dispose: () => {
      stopTimers();
      stopHitWatch();
      try {
        if (handleWin && !handleWin.isDestroyed()) handleWin.destroy();
      } catch {
        /* noop */
      }
      try {
        if (railWin && !railWin.isDestroyed()) railWin.destroy();
      } catch {
        /* noop */
      }
      try {
        if (animWin && !animWin.isDestroyed()) animWin.destroy();
      } catch {
        /* noop */
      }
      handleWin = null;
      railWin = null;
      animWin = null;
      side = null;
      docked = false;
      exposed = 'none';
      panelPage = null;
      lastShot = null;
    },
  };
}

function center(r: Rectangle) {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
