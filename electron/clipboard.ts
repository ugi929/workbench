import { app, clipboard, nativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import dayjs from 'dayjs';
import { all, kvGet, kvSet, run } from './db';
import type { Clip } from '../shared/types';

const KEEP_MAX = 500;
const KEEP_DAYS = 7;
let timer: ReturnType<typeof setInterval> | null = null;
let lastSig = '';
let primed = false;

function rowToClip(r: Record<string, unknown>): Clip {
  return {
    id: Number(r.id),
    type: String(r.type) as 'text' | 'image',
    content: String(r.content ?? ''),
    file_path: r.file_path ? String(r.file_path) : null,
    pinned: Number(r.pinned ?? 0),
    created_at: String(r.created_at),
  };
}

export function listClips(keyword = '', limit = 300): Clip[] {
  const kw = keyword.trim();
  const rows = kw
    ? all<Record<string, unknown>>(
        `SELECT * FROM clips WHERE type = 'text' AND content LIKE ? ORDER BY pinned DESC, id DESC LIMIT ?`,
        [`%${kw}%`, limit],
      )
    : all<Record<string, unknown>>(`SELECT * FROM clips ORDER BY pinned DESC, id DESC LIMIT ?`, [limit]);
  return rows.map(rowToClip);
}

function insertClip(type: 'text' | 'image', content: string, filePath: string | null): void {
  const top = all<Record<string, unknown>>('SELECT * FROM clips ORDER BY pinned DESC, id DESC LIMIT 1')[0];
  if (top && String(top.type) === type && String(top.content) === content) {
    run('UPDATE clips SET created_at = ? WHERE id = ?', [dayjs().format('YYYY-MM-DD HH:mm:ss'), Number(top.id)]);
  } else {
    run('INSERT INTO clips (type, content, file_path, created_at) VALUES (?, ?, ?, ?)', [
      type,
      content,
      filePath,
      dayjs().format('YYYY-MM-DD HH:mm:ss'),
    ]);
  }
  prune();
}

function prune(): void {
  const cutoff = dayjs().subtract(KEEP_DAYS, 'day').format('YYYY-MM-DD HH:mm:ss');
  run('DELETE FROM clips WHERE pinned = 0 AND created_at < ?', [cutoff]);
  run(
    `DELETE FROM clips WHERE pinned = 0 AND id NOT IN (
       SELECT id FROM clips WHERE pinned = 0 ORDER BY id DESC LIMIT ${KEEP_MAX}
     )`,
  );
}

function tick(): void {
  if (kvGet('clipWatch') === '0') return;
  const formats = clipboard.availableFormats();
  if (formats.includes('image')) {
    const img = clipboard.readImage();
    if (img.isEmpty()) return;
    const png = img.toPNG();
    const sig = `img:${img.getSize().width}x${img.getSize().height}:${png.length}`;
    if (!primed) {
      lastSig = sig;
      primed = true;
      return;
    }
    if (sig === lastSig) return;
    lastSig = sig;
    const dir = path.join(app.getPath('userData'), 'clips');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `clip-${Date.now()}.png`);
    fs.writeFileSync(file, png);
    insertClip('image', `图片 ${img.getSize().width}×${img.getSize().height}`, file);
  } else {
    const text = clipboard.readText();
    if (!text.trim()) return;
    const sig = `txt:${text}`;
    if (!primed) {
      lastSig = sig;
      primed = true;
      return;
    }
    if (sig === lastSig) return;
    lastSig = sig;
    insertClip('text', text.length > 100000 ? text.slice(0, 100000) : text, null);
  }
}

export function startClipboardWatch(): void {
  if (timer) return;
  primed = false;
  tick();
  timer = setInterval(tick, 1500);
}

export function stopClipboardWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function watchEnabled(): boolean {
  return kvGet('clipWatch') !== '0';
}

export function setWatchEnabled(v: boolean): void {
  kvSet('clipWatch', v ? '1' : '0');
  if (v) startClipboardWatch();
}

export function copyClip(id: number): void {
  const rows = all<Record<string, unknown>>('SELECT * FROM clips WHERE id = ?', [id]);
  if (!rows.length) return;
  const clip = rowToClip(rows[0]);
  if (clip.type === 'image' && clip.file_path && fs.existsSync(clip.file_path)) {
    const img = nativeImage.createFromPath(clip.file_path);
    if (!img.isEmpty()) clipboard.writeImage(img);
  } else {
    clipboard.writeText(clip.content);
  }
}

export function pinClip(id: number, pinned: number): void {
  run('UPDATE clips SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id]);
}

export function deleteClip(id: number): void {
  const rows = all<Record<string, unknown>>('SELECT * FROM clips WHERE id = ?', [id]);
  const clip = rows.length ? rowToClip(rows[0]) : null;
  run('DELETE FROM clips WHERE id = ?', [id]);
  if (clip?.file_path) fs.rmSync(clip.file_path, { force: true });
}

export function clearClips(): void {
  for (const c of listClips('', 100000)) {
    if (c.file_path) fs.rmSync(c.file_path, { force: true });
  }
  run('DELETE FROM clips');
}

export function imageClipDataUrl(id: number): string {
  const rows = all<Record<string, unknown>>('SELECT * FROM clips WHERE id = ?', [id]);
  if (!rows.length) return '';
  const clip = rowToClip(rows[0]);
  if (clip.type !== 'image' || !clip.file_path || !fs.existsSync(clip.file_path)) return '';
  const img = nativeImage.createFromPath(clip.file_path);
  return img.isEmpty() ? '' : img.toDataURL();
}

export function seedDemoClips(): void {
  insertClip('text', '示例剪贴板：周一 10:00 项目例会，会议室 B302', null);
  insertClip('text', '示例剪贴板：https://github.com/', null);
  insertClip('text', '示例剪贴板：账号提示——服务器 192.168.1.20，端口 22', null);
}
