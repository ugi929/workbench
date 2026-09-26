import * as fs from 'fs';
import * as path from 'path';
import dayjs from 'dayjs';
import { getDbFile, kvGet, persistNow } from './db';
import type { BackupInfo } from '../shared/types';

const PREFIX = 'workbench-backup-';
const KEEP = 10;

export function backupDir(): string {
  return kvGet('backupDir') || path.join(path.dirname(getDbFile()), 'backups');
}

export function backupNow(): { name: string; size: number } {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = `${PREFIX}${dayjs().format('YYYYMMDD-HHmmss')}.sqlite`;
  const dest = path.join(dir, name);
  persistNow();
  fs.copyFileSync(getDbFile(), dest);
  prune(dir);
  return { name, size: fs.statSync(dest).size };
}

function prune(dir: string, keep = KEEP): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.sqlite'))
    .sort()
    .reverse();
  for (const f of files.slice(keep)) {
    try {
      fs.rmSync(path.join(dir, f), { force: true });
    } catch {
      // NAS 上可能被占用，忽略单个删除失败
    }
  }
}

export function listBackups(): BackupInfo[] {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.sqlite'))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function autoBackupIfDue(): void {
  if (kvGet('backupAuto') !== '1') return;
  const todayPrefix = `${PREFIX}${dayjs().format('YYYYMMDD')}`;
  const exists = listBackups().some((b) => b.name.startsWith(todayPrefix));
  if (exists) return;
  try {
    backupNow();
  } catch (err) {
    console.error('AUTO_BACKUP_FAIL', err);
  }
}

export function restoreBackup(name: string): void {
  if (!name.startsWith(PREFIX) || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('非法的备份文件名');
  }
  const src = path.join(backupDir(), name);
  if (!fs.existsSync(src)) throw new Error('备份文件不存在');
  persistNow();
  fs.copyFileSync(src, getDbFile());
}
