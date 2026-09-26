import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

let file = '';

export function initLogger(): void {
  try {
    file = path.join(app.getPath('userData'), 'app.log');
    // 防止日志无限增长：超过 2MB 时清空重记
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      fs.writeFileSync(file, `[${new Date().toISOString()}] log rotated\n`);
    }
  } catch {
    file = '';
  }
}

export function appLog(...parts: unknown[]): void {
  try {
    if (!file) return;
    const line = `[${new Date().toISOString()}] ${parts
      .map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === 'object' ? JSON.stringify(p) : String(p)))
      .join(' ')}\n`;
    fs.appendFileSync(file, line);
  } catch {
    // 日志失败不影响主流程
  }
}
