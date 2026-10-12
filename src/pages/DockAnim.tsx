import React, { useEffect } from 'react';

interface GenieOpts {
  img: string;
  from: { x: number; y: number; width: number; height: number };
  point: { x: number; y: number };
  side: string;
  dir: 'collapse' | 'expand';
}

// 模块加载即注册，主进程在覆盖层窗口 load 完成后通过 executeJavaScript 调用
(window as unknown as { __playGenie: (o: GenieOpts) => Promise<void> }).__playGenie = (o) =>
  new Promise<void>((resolve) => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    const host = document.getElementById('root');
    if (!host) {
      resolve();
      return;
    }
    host.innerHTML = '';
    const img = document.createElement('img');
    img.src = o.img;
    img.style.position = 'fixed';
    img.style.left = `${o.from.x}px`;
    img.style.top = `${o.from.y}px`;
    img.style.width = `${o.from.width}px`;
    img.style.height = `${o.from.height}px`;
    img.style.transformOrigin = 'center center';
    img.style.borderRadius = '10px';
    img.style.boxShadow = '0 24px 70px rgba(0, 0, 0, 0.4)';
    img.style.willChange = 'transform, opacity';
    host.appendChild(img);

    const c0 = { x: o.from.x + o.from.width / 2, y: o.from.y + o.from.height / 2 };
    const c2 = o.point;
    const dist = Math.hypot(c2.x - c0.x, c2.y - c0.y);
    const curve = Math.min(180, dist * 0.3);
    const ctrl =
      Math.abs(c2.x - c0.x) >= Math.abs(c2.y - c0.y)
        ? { x: (c0.x + c2.x) / 2, y: (c0.y + c2.y) / 2 - curve }
        : { x: (c0.x + c2.x) / 2 - curve, y: (c0.y + c2.y) / 2 };
    const bez = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => {
      const u = 1 - t;
      return {
        x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
      };
    };
    const P = (t: number) => (o.dir === 'collapse' ? bez(c0, c2, t) : bez(c2, c0, t));

    const ts = [0, 0.22, 0.46, 0.72, 0.9, 1];
    const frames = ts.map((t) => {
      const p = P(t);
      const s = o.dir === 'collapse' ? 1 - 0.96 * t : 0.04 + 0.96 * t;
      const rot = 10 * Math.sin(Math.PI * t) * (o.dir === 'collapse' ? -1 : 1);
      const opacity =
        o.dir === 'collapse' ? (t > 0.9 ? 0.2 : 1) : t < 0.12 ? 0.3 : 1;
      return {
        transform: `translate(${(p.x - c0.x).toFixed(1)}px, ${(p.y - c0.y).toFixed(1)}px) scale(${s.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`,
        opacity,
      };
    });

    const duration = o.dir === 'collapse' ? 470 : 520;
    const anim = img.animate(frames, {
      duration,
      easing: o.dir === 'collapse' ? 'cubic-bezier(.55,0,1,.45)' : 'cubic-bezier(.2,.65,.3,1)',
      fill: 'forwards',
    });

    // ⚠️ 这个 Promise 必须在任何情况下都 resolve —— 主进程靠 await 它来决定何时关掉覆盖层窗口。
    //    只挂 onfinish 是不够的：Web Animations 在
    //      ① 元素被下一次调用清出 DOM（host.innerHTML = ''）而被浏览器 cancel、
    //      ② 窗口被遮挡 / 合成器忙，时间轴根本不推进，
    //    两种情况下都【不会】触发 finish，改而触发 cancel 或什么都不触发。
    //    一旦漏掉，主进程那个 await 永久挂起：transparent + alwaysOnTop 的覆盖层窗口不关，
    //    就成了压在任务栏图标上的一块黑矩形，且 animating 卡在 true 导致点展开没反应。
    let settled = false;
    let guard: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (guard !== null) clearTimeout(guard);
      host.innerHTML = '';
      resolve();
    };
    anim.onfinish = settle;
    anim.oncancel = settle;
    guard = setTimeout(settle, duration + 800);
  });

export default function DockAnim() {
  useEffect(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
  }, []);
  return null;
}
