import { shell } from 'electron';
import { all, lastInsertId, run } from './db';
import type { LaunchInput, LaunchItem, LaunchType } from '../shared/types';

function rowToItem(r: Record<string, unknown>): LaunchItem {
  return {
    id: Number(r.id),
    name: String(r.name),
    type: String(r.type) as LaunchType,
    target: String(r.target),
    sort_order: Number(r.sort_order ?? 0),
    created_at: String(r.created_at),
  };
}

export function listLaunch(): LaunchItem[] {
  return all<Record<string, unknown>>(
    'SELECT * FROM launch_items ORDER BY sort_order ASC, id ASC',
  ).map(rowToItem);
}

export function createLaunch(input: LaunchInput): LaunchItem {
  const name = String(input.name ?? '').trim();
  const target = String(input.target ?? '').trim();
  if (!name) throw new Error('名称不能为空');
  if (!target) throw new Error('目标地址不能为空');
  const type: LaunchType = input.type ?? 'url';
  run(
    `INSERT INTO launch_items (name, type, target, sort_order, created_at) VALUES (?, ?, ?, 0, ?)`,
    [name, type, target, new Date().toISOString().slice(0, 19).replace('T', ' ')],
  );
  return rowToItem(all<Record<string, unknown>>('SELECT * FROM launch_items WHERE id = ?', [lastInsertId()])[0]);
}

export function updateLaunch(id: number, patch: Partial<LaunchInput>): LaunchItem {
  const sets: string[] = [];
  const params: (number | string)[] = [];
  if (patch.name !== undefined) {
    const n = String(patch.name).trim();
    if (!n) throw new Error('名称不能为空');
    sets.push('name = ?');
    params.push(n);
  }
  if (patch.type !== undefined) {
    sets.push('type = ?');
    params.push(patch.type);
  }
  if (patch.target !== undefined) {
    const t = String(patch.target).trim();
    if (!t) throw new Error('目标地址不能为空');
    sets.push('target = ?');
    params.push(t);
  }
  if (sets.length) run(`UPDATE launch_items SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  const rows = all<Record<string, unknown>>('SELECT * FROM launch_items WHERE id = ?', [id]);
  if (!rows.length) throw new Error('启动项不存在');
  return rowToItem(rows[0]);
}

export function deleteLaunch(id: number): void {
  run('DELETE FROM launch_items WHERE id = ?', [id]);
}

export async function openLaunch(id: number): Promise<string> {
  const rows = all<Record<string, unknown>>('SELECT * FROM launch_items WHERE id = ?', [id]);
  if (!rows.length) throw new Error('启动项不存在');
  const item = rowToItem(rows[0]);
  if (item.type === 'url') {
    let url = item.target;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    await shell.openExternal(url);
    return '';
  }
  const err = await shell.openPath(item.target);
  return err;
}
