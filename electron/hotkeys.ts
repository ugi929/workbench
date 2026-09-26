import { globalShortcut } from 'electron';
import { kvGet, kvSet } from './db';
import type { HotkeyMap } from '../shared/types';

export const DEFAULT_HOTKEYS: HotkeyMap = {
  main: 'Alt+Space',
  widget: 'Alt+W',
  note: 'Alt+N',
  search: 'Alt+Q',
  launch: 'Alt+L',
};

type Actions = {
  showMain: () => void;
  toggleWidget: () => void;
  createNote: () => void;
  toggleSearch: () => void;
  openLaunch: () => void;
};

let actions: Actions | null = null;

export function getHotkeys(): HotkeyMap {
  const saved = kvGet('hotkeys');
  const merged = { ...DEFAULT_HOTKEYS };
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as Partial<HotkeyMap>;
      for (const k of Object.keys(merged) as (keyof HotkeyMap)[]) {
        if (parsed[k]) merged[k] = parsed[k];
      }
    } catch {
      // 配置损坏时用默认值
    }
  }
  return merged;
}

export function registerHotkeys(a: Actions): { failed: string[] } {
  actions = a;
  globalShortcut.unregisterAll();
  const map = getHotkeys();
  const failed: string[] = [];
  const reg = (accel: string, fn: () => void) => {
    try {
      if (!globalShortcut.register(accel, fn)) failed.push(accel);
    } catch {
      failed.push(accel);
    }
  };
  reg(map.main, () => actions?.showMain());
  reg(map.widget, () => actions?.toggleWidget());
  reg(map.note, () => actions?.createNote());
  reg(map.search, () => actions?.toggleSearch());
  reg(map.launch, () => actions?.openLaunch());
  return { failed };
}

export function setHotkeys(map: HotkeyMap): { failed: string[] } {
  if (!actions) return { failed: [] };
  kvSet('hotkeys', JSON.stringify(map));
  return registerHotkeys(actions);
}

export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll();
}
