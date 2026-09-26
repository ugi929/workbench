import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';

let db: Database;
let dbFile = '';
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  importance TEXT NOT NULL DEFAULT 'medium',
  urgency TEXT NOT NULL DEFAULT 'medium',
  project TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  start_date TEXT,
  due_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  estimated_pomos INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'focus',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  minutes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pomo_started ON pomodoro_sessions(started_at);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'yellow',
  pos_x INTEGER,
  pos_y INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS launch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  target TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL DEFAULT '',
  file_path TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at);
`;

export async function initDb(): Promise<string> {
  const wasmDir = path.dirname(require.resolve('sql.js'));
  const SQL = await initSqlJs({ locateFile: (file: string) => path.join(wasmDir, file) });
  const dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  dbFile = path.join(dataDir, 'workbench.sqlite');
  db = fs.existsSync(dbFile) ? new SQL.Database(fs.readFileSync(dbFile)) : new SQL.Database();
  db.run(SCHEMA);
  persistNow();
  return dbFile;
}

export function persistNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!db || !dbFile) return;
  const data = Buffer.from(db.export());
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dbFile);
}

function persist(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(persistNow, 300);
}

export function all<T = Record<string, unknown>>(sql: string, params: (number | string | null)[] = []): T[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export function run(sql: string, params: (number | string | null)[] = []): void {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    stmt.step();
  } finally {
    stmt.free();
  }
  persist();
}

export function lastInsertId(): number {
  return all<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id;
}

export function getDbFile(): string {
  return dbFile;
}

export function kvGet(key: string): string | null {
  const rows = all<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
  return rows.length ? rows[0].value : null;
}

export function kvSet(key: string, value: string): void {
  run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
}
