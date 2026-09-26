import type { SettingsMap, WidgetStyle } from '../shared/types';

// 桌面小组件（启动项小组件 Alt+L / 任务小组件 Alt+W）的背景外观。
//
// 做法：把「背景色 + 不透明度」算成一组 CSS 变量写到 <html> 上，
// `styles.css` 里 `.widget-*` / `.lw-*` 只引用变量（带原值兜底），
// 于是同一份样式同时服务两个小组件，改一处即两边生效。
//
// 关键点是**文字/描边颜色按背景亮度自动反差**：用户如果把背景调成浅色，
// 默认的浅色文字就会被背景淹没（这正是之前踩过的「字被背景淹没」问题），
// 所以这里按背景亮度自动在深/浅两套前景色之间切换。

export const DEFAULT_WIDGET_STYLE: WidgetStyle = { bgColor: '#1c1e26', bgOpacity: 88 };

/** 预设色（前 6 个是常用深色外壳，后 3 个是浅色/纯色，便于快速对比） */
export const WIDGET_BG_PRESETS: { label: string; value: string }[] = [
  { label: '石墨', value: '#1c1e26' },
  { label: '墨蓝', value: '#16202e' },
  { label: '纯黑', value: '#000000' },
  { label: '深灰', value: '#2b2f36' },
  { label: '靛紫', value: '#221a33' },
  { label: '墨绿', value: '#132a22' },
  { label: '米白', value: '#f5f5f7' },
  { label: '浅蓝', value: '#e8eefb' },
  { label: '暖砂', value: '#f3ece3' },
];

const FG_LIGHT = '#e8eaed';
const FG_DARK = '#2a2e36';

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hexToRgb(DEFAULT_WIDGET_STYLE.bgColor);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 相对亮度（人眼加权），0 = 纯黑，1 = 纯白 */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** 该背景色应配深色字还是浅色字 */
export function isBrightBg(hex: string): boolean {
  return luminance(hex) > 0.6;
}

export function parseWidgetStyle(s: SettingsMap): WidgetStyle {
  const rawColor = (s.widgetBgColor ?? '').trim();
  // ⚠️ 空串不能用 Number() 直接判：`Number('') === 0` 是有限数，会被当成「不透明度 0」，
  //    于是「从未设置过」的用户打开设置页看到的是 0%（整块卡片全透明），而不是默认 88%。
  const rawOpacity = (s.widgetBgOpacity ?? '').trim();
  const opacityNum = rawOpacity === '' ? Number.NaN : Number(rawOpacity);
  return {
    bgColor: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor.toLowerCase() : DEFAULT_WIDGET_STYLE.bgColor,
    bgOpacity: Number.isFinite(opacityNum)
      ? clamp(opacityNum, 0, 100)
      : DEFAULT_WIDGET_STYLE.bgOpacity,
  };
}

/** 把外观写成 CSS 变量（挂到 <html>，对该窗口内所有小组件生效） */
export function applyWidgetStyle(style: WidgetStyle): void {
  const root = document.documentElement;
  const [r, g, b] = hexToRgb(style.bgColor);
  const alpha = clamp(style.bgOpacity, 0, 100) / 100;
  const bright = isBrightBg(style.bgColor);
  // 背景很透的时候，卡片轮廓和文字都容易糊进壁纸里 → 描边加重 + 文字加一层深色阴影兜底
  const faint = alpha < 0.45;

  root.style.setProperty('--widget-bg', `rgba(${r}, ${g}, ${b}, ${alpha})`);
  root.style.setProperty('--widget-fg', bright ? FG_DARK : FG_LIGHT);
  root.style.setProperty('--widget-fg-dim', bright ? 'rgba(0, 0, 0, 0.48)' : 'rgba(255, 255, 255, 0.58)');
  root.style.setProperty('--widget-line', bright ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.08)');
  root.style.setProperty('--widget-hover', bright ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.10)');
  root.style.setProperty(
    '--widget-hover-strong',
    bright ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.16)',
  );
  root.style.setProperty('--widget-danger', bright ? '#d4380d' : '#ff7875');
  root.style.setProperty(
    '--widget-border',
    faint
      ? bright
        ? 'rgba(0, 0, 0, 0.30)'
        : 'rgba(255, 255, 255, 0.28)'
      : bright
        ? 'rgba(0, 0, 0, 0.12)'
        : 'rgba(255, 255, 255, 0.08)',
  );
  // 浅色字在透明背景上需要深色描边兜底；深色字本身就够清楚，不加阴影免得发糊
  root.style.setProperty(
    '--widget-text-shadow',
    faint && !bright ? '0 1px 3px rgba(0, 0, 0, 0.55)' : 'none',
  );
  root.dataset.widgetTone = bright ? 'light' : 'dark';
}

const WIDGET_KEYS = ['widgetBgColor', 'widgetBgOpacity'];

/**
 * 小组件页面挂载时调用：先按当前设置刷一遍，再订阅设置变更做实时更新。
 * 返回取消订阅函数。
 */
export async function initWidgetStyle(): Promise<() => void> {
  const refresh = async (): Promise<void> => {
    try {
      applyWidgetStyle(parseWidgetStyle(await window.api.getSettings()));
    } catch {
      applyWidgetStyle(DEFAULT_WIDGET_STYLE);
    }
  };
  await refresh();
  try {
    return window.api.onSettingsChanged((key) => {
      if (WIDGET_KEYS.includes(key)) void refresh();
    });
  } catch {
    return () => {};
  }
}
