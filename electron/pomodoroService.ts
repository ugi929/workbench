import { BrowserWindow, Notification, ipcMain } from 'electron';
import dayjs from 'dayjs';
import * as pomodoro from './pomodoro';
import { kvGet, kvSet } from './db';

export type PomoMode = 'focus' | 'short' | 'long';

export interface PomoSnapshot {
  running: boolean;
  mode: PomoMode;
  endAt: number | null; // 绝对结束时间戳（ms）；running 时有效
  segmentLen: number; // 当前阶段总秒数；未 running 时为剩余秒数
  focusDone: number;
  taskId?: number;
  config: { focus: number; short: number; long: number; rounds: number };
}

const DEFAULT_CONFIG = { focus: 25, short: 5, long: 15, rounds: 4 };

let state: PomoSnapshot = {
  running: false,
  mode: 'focus',
  endAt: null,
  segmentLen: DEFAULT_CONFIG.focus * 60,
  focusDone: 0,
  taskId: undefined,
  config: { ...DEFAULT_CONFIG },
};

let timer: ReturnType<typeof setInterval> | null = null;

function loadConfig(): void {
  try {
    const raw = kvGet('pomodoro');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PomoSnapshot['config']>;
      if (parsed && typeof parsed.focus === 'number' && parsed.focus > 0) {
        state.config = { ...DEFAULT_CONFIG, ...parsed };
      }
    }
  } catch {
    // 配置损坏时用默认值
  }
}

// 计时权威放在主进程：永不被渲染进程的后台节流影响，所有窗口共享同一份状态
function broadcast(): void {
  const snap: PomoSnapshot = { ...state };
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('pomo:state', snap);
  }
}

function broadcastStats(): void {
  const payload = { stats: pomodoro.stats(), recent: pomodoro.recentSessions(20) };
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('pomo:stats', payload);
  }
}

function segmentSeconds(mode: PomoMode): number {
  return state.config[mode] * 60;
}

// 当前阶段结束：记录专注、推进到下一阶段（保持 running，自动连续）
function advance(): void {
  if (state.mode === 'focus') {
    const end = state.endAt ?? Date.now();
    const start = end - state.segmentLen * 1000;
    pomodoro.recordSession({
      task_id: state.taskId ?? null,
      kind: 'focus',
      started_at: dayjs(start).format('YYYY-MM-DD HH:mm:ss'),
      ended_at: dayjs(end).format('YYYY-MM-DD HH:mm:ss'),
      minutes: state.config.focus,
    });
    state.focusDone += 1;
    state.mode = state.focusDone % state.config.rounds === 0 ? 'long' : 'short';
    if (Notification.isSupported()) {
      new Notification({
        title: '🍅 番茄完成',
        body: state.focusDone % state.config.rounds === 0 ? '完成一轮，来个长休息吧！' : '休息一下，马上回来',
      }).show();
    }
  } else {
    state.mode = 'focus';
    if (Notification.isSupported()) {
      new Notification({ title: '休息结束', body: '开始下一个番茄吧！' }).show();
    }
  }
  state.segmentLen = segmentSeconds(state.mode);
  state.endAt = Date.now() + state.segmentLen * 1000;
  state.running = true;
}

function tick(): void {
  if (!state.running || state.endAt == null) return;
  if (Date.now() >= state.endAt) {
    advance();
    broadcast();
    broadcastStats();
  }
}

export function initPomodoroService(): void {
  loadConfig();
  if (!timer) {
    timer = setInterval(tick, 250);
  }

  ipcMain.handle('pomo:getState', () => ({ ...state }));

  ipcMain.handle('pomo:start', () => {
    if (!state.running) {
      state.endAt = Date.now() + state.segmentLen * 1000;
      state.running = true;
    }
    broadcast();
  });

  ipcMain.handle('pomo:pause', () => {
    if (state.running && state.endAt != null) {
      state.segmentLen = Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
      state.endAt = null;
      state.running = false;
    }
    broadcast();
  });

  ipcMain.handle('pomo:toggle', () => {
    if (state.running && state.endAt != null) {
      state.segmentLen = Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
      state.endAt = null;
      state.running = false;
    } else {
      state.endAt = Date.now() + state.segmentLen * 1000;
      state.running = true;
    }
    broadcast();
  });

  ipcMain.handle('pomo:switchMode', (_e, mode: PomoMode) => {
    state.mode = mode;
    state.segmentLen = segmentSeconds(mode);
    state.endAt = state.running ? Date.now() + state.segmentLen * 1000 : null;
    broadcast();
  });

  ipcMain.handle('pomo:reset', () => {
    state.mode = 'focus';
    state.segmentLen = segmentSeconds('focus');
    state.endAt = null;
    state.running = false;
    state.focusDone = 0;
    broadcast();
  });

  ipcMain.handle('pomo:skip', () => {
    if (state.mode === 'focus') {
      state.focusDone += 1;
      state.mode = state.focusDone % state.config.rounds === 0 ? 'long' : 'short';
    } else {
      state.mode = 'focus';
    }
    state.segmentLen = segmentSeconds(state.mode);
    state.endAt = null;
    state.running = false;
    broadcast();
  });

  ipcMain.handle('pomo:setTask', (_e, taskId: number | null) => {
    state.taskId = taskId ?? undefined;
    broadcast();
  });

  ipcMain.handle('pomo:setConfig', (_e, cfg: Partial<PomoSnapshot['config']>) => {
    state.config = { ...DEFAULT_CONFIG, ...cfg };
    kvSet('pomodoro', JSON.stringify(state.config));
    if (!state.running) state.segmentLen = segmentSeconds(state.mode);
    broadcast();
    broadcastStats();
  });
}
