import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import dayjs from 'dayjs';
import { all, lastInsertId, run } from './db';
import type { Note, NoteInput } from '../shared/types';

const windows = new Map<number, BrowserWindow>();
let quitting = false;
let appPath = '.';

export function initNotes(appDir: string): void {
  appPath = appDir;
}

export function setQuitting(v: boolean): void {
  quitting = v;
}

function rowToNote(r: Record<string, unknown>): Note {
  return {
    id: Number(r.id),
    content: String(r.content ?? ''),
    color: String(r.color ?? 'yellow'),
    pos_x: r.pos_x === null || r.pos_x === undefined ? null : Number(r.pos_x),
    pos_y: r.pos_y === null || r.pos_y === undefined ? null : Number(r.pos_y),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export function listNotes(): Note[] {
  return all<Record<string, unknown>>('SELECT * FROM notes ORDER BY id ASC').map(rowToNote);
}

export function getNote(id: number): Note {
  const rows = all<Record<string, unknown>>('SELECT * FROM notes WHERE id = ?', [id]);
  if (!rows.length) throw new Error(`便签不存在: ${id}`);
  return rowToNote(rows[0]);
}

export function createNote(input: NoteInput = {}): Note {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  run(
    `INSERT INTO notes (content, color, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [input.content ?? '', input.color ?? 'yellow', now, now],
  );
  return getNote(lastInsertId());
}

export function updateNote(id: number, patch: NoteInput): Note {
  const sets: string[] = [];
  const params: (number | string | null)[] = [];
  if (patch.content !== undefined) {
    sets.push('content = ?');
    params.push(patch.content);
  }
  if (patch.color !== undefined) {
    sets.push('color = ?');
    params.push(patch.color);
  }
  if (patch.pos_x !== undefined) {
    sets.push('pos_x = ?');
    params.push(patch.pos_x);
  }
  if (patch.pos_y !== undefined) {
    sets.push('pos_y = ?');
    params.push(patch.pos_y);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(dayjs().format('YYYY-MM-DD HH:mm:ss'));
    run(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }
  return getNote(id);
}

export function deleteNote(id: number): void {
  const w = windows.get(id);
  if (w && !w.isDestroyed()) w.destroy();
  windows.delete(id);
  run('DELETE FROM notes WHERE id = ?', [id]);
}

function cascadePosition(): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea;
  const offset = (windows.size % 8) * 30;
  return { x: wa.x + wa.width - 340 - offset, y: wa.y + 80 + offset };
}

export function openNote(id: number): void {
  const existing = windows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }
  const note = getNote(id);
  const pos = note.pos_x !== null && note.pos_y !== null
    ? { x: note.pos_x, y: note.pos_y }
    : cascadePosition();
  const win = new BrowserWindow({
    width: 280,
    height: 240,
    minWidth: 180,
    minHeight: 140,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    // 同 launchWidget：默认 backgroundColor 是白色不透明，必须显式置为全透明
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: '便签',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.once('ready-to-show', () => win.show());
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  const savePos = () => {
    if (win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    run('UPDATE notes SET pos_x = ?, pos_y = ? WHERE id = ?', [x, y, id]);
  };
  win.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(savePos, 500);
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => windows.delete(id));
  windows.set(id, win);
  void win.loadFile(path.join(appPath, 'dist/index.html'), { hash: `/note/${id}` });
}

export function openAllNotes(): void {
  for (const n of listNotes()) openNote(n.id);
}

export function hideAllNotes(): void {
  for (const w of windows.values()) {
    if (!w.isDestroyed()) w.hide();
  }
}

export function anyNoteVisible(): boolean {
  for (const w of windows.values()) {
    if (!w.isDestroyed() && w.isVisible()) return true;
  }
  return false;
}

export function toggleAllNotes(): void {
  if (anyNoteVisible()) hideAllNotes();
  else openAllNotes();
}

export function getNoteWindow(id: number): BrowserWindow | null {
  const w = windows.get(id);
  return w && !w.isDestroyed() ? w : null;
}

export function reloadNote(id: number): void {
  const w = windows.get(id);
  if (w && !w.isDestroyed()) w.webContents.reload();
}
