import { useEffect, useReducer, useState } from 'react';
import type { PomodoroConfig, PomodoroSessionWithTask, PomodoroStats } from '../shared/types';

export type PomoMode = 'focus' | 'short' | 'long';

export interface PomoSnapshot {
  running: boolean;
  mode: PomoMode;
  endAt: number | null; // 绝对结束时间戳（ms）；running 时有效
  segmentLen: number; // 当前阶段总秒数；未 running 时为剩余秒数
  focusDone: number;
  taskId?: number;
  config: PomodoroConfig;
}

type StatsPayload = { stats: PomodoroStats; recent: PomodoroSessionWithTask[] };

let snap: PomoSnapshot | null = null;
let initialized = false;
const stateListeners = new Set<(s: PomoSnapshot | null) => void>();
const statsListeners = new Set<(p: StatsPayload) => void>();

function setSnap(s: PomoSnapshot): void {
  snap = s;
  stateListeners.forEach((l) => l(s));
}

function setStats(p: StatsPayload): void {
  statsListeners.forEach((l) => l(p));
}

// 每个渲染进程只初始化一次：拉取初始状态 + 订阅主进程广播
export function initPomo(): void {
  if (initialized) return;
  initialized = true;
  window.api.pomoGetState().then(setSnap).catch(() => undefined);
  window.api.onPomoState((s) => setSnap(s));
  window.api.onPomoStats((p) => setStats({ stats: p.stats as PomodoroStats, recent: p.recent as PomodoroSessionWithTask[] }));
}

// 剩余秒数：running 时基于绝对结束时间戳实时计算，窗口被收起隐藏也不会失真
export function remainingOf(s: PomoSnapshot | null): number {
  if (!s) return 0;
  if (s.running && s.endAt != null) return Math.max(0, Math.round((s.endAt - Date.now()) / 1000));
  return s.segmentLen;
}

export function usePomo() {
  const [s, setS] = useState<PomoSnapshot | null>(snap);
  const [, force] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    initPomo();
    const l = (ns: PomoSnapshot | null) => setS(ns);
    stateListeners.add(l);
    if (!s) window.api.pomoGetState().then(setSnap).catch(() => undefined);
    // 让剩余时间在可见窗口里持续刷新（隐藏时由主进程权威计时保证，恢复可见即校正）
    const t = setInterval(force, 250);
    return () => {
      stateListeners.delete(l);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    snap: s,
    remaining: remainingOf(s),
    start: () => window.api.pomoStart(),
    pause: () => window.api.pomoPause(),
    toggle: () => window.api.pomoToggle(),
    switchMode: (m: PomoMode) => window.api.pomoSwitchMode(m),
    reset: () => window.api.pomoReset(),
    skip: () => window.api.pomoSkip(),
    setTask: (id?: number) => window.api.pomoSetTask(id),
    setConfig: (c: Partial<PomodoroConfig>) => window.api.pomoSetConfig(c),
  };
}

export function usePomoStats() {
  const [data, setData] = useState<StatsPayload | null>(null);
  useEffect(() => {
    const l = (p: StatsPayload) => setData(p);
    statsListeners.add(l);
    window.api
      .pomoStats()
      .then((stats) =>
        window.api.pomoRecent().then((recent) => setData({ stats, recent })).catch(() => undefined),
      )
      .catch(() => undefined);
    return () => {
      statsListeners.delete(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return data;
}
