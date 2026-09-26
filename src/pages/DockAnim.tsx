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

    const anim = img.animate(frames, {
      duration: o.dir === 'collapse' ? 470 : 520,
      easing: o.dir === 'collapse' ? 'cubic-bezier(.55,0,1,.45)' : 'cubic-bezier(.2,.65,.3,1)',
      fill: 'forwards',
    });
    anim.onfinish = () => {
      host.innerHTML = '';
      resolve();
    };
  });

export default function DockAnim() {
  useEffect(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
  }, []);
  return null;
}
