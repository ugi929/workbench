import * as fs from 'fs';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { all, lastInsertId, run } from './db';
import type {
  DashboardStats,
  ImportMode,
  ImportResult,
  ImportRow,
  Level,
  ParseResult,
  Task,
  TaskInput,
  TaskStatus,
} from '../shared/types';

dayjs.extend(customParseFormat);

// xlsx（SheetJS）单文件 800KB+，只在真正导入/导出表格时才 require，
// 避免应用一启动就把整个解析器常驻在主进程内存里。
type XlsxModule = typeof import('xlsx');
let xlsxMod: XlsxModule | null = null;
function xlsx(): XlsxModule {
  if (!xlsxMod) xlsxMod = require('xlsx') as XlsxModule;
  return xlsxMod;
}

const STATUS_ZH: Record<TaskStatus, string> = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
  paused: '挂起',
};

const LEVEL_ZH: Record<Level, string> = { high: '高', medium: '中', low: '低' };

const STATUS_FROM_ZH: Record<string, TaskStatus> = {
  待办: 'todo',
  进行中: 'in_progress',
  已完成: 'done',
  已取消: 'cancelled',
  挂起: 'paused',
  todo: 'todo',
  in_progress: 'in_progress',
  done: 'done',
  cancelled: 'cancelled',
  paused: 'paused',
};

const LEVEL_FROM_ZH: Record<string, Level> = {
  高: 'high',
  中: 'medium',
  低: 'low',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export const TEMPLATE_HEADERS = [
  '任务名称',
  '描述',
  '状态',
  '重要度',
  '紧急度',
  '开始日期',
  '截止日期',
  '项目',
  '标签',
  '预估番茄数',
  '进度(%)',
];

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v) || 0);
  return Math.min(max, Math.max(min, n));
}

// 日期字段统一规范化：容忍 AI/导入带来的 "YYYY-MM-DD HH:mm"、"YYYY/M/D"、"YYYY年M月D日" 等写法
export function normalizeDateInput(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : dayjs(v).format('YYYY-MM-DD');
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})/);
  if (m) {
    const d = dayjs(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
    if (d.isValid()) return d.format('YYYY-MM-DD');
  }
  return s;
}

function rowToTask(r: Record<string, unknown>): Task {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(String(r.tags ?? '[]'));
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    tags = [];
  }
  return { ...(r as unknown as Task), tags };
}

function getTask(id: number): Task {
  const rows = all<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!rows.length) throw new Error(`任务不存在: ${id}`);
  return rowToTask(rows[0]);
}

export function listTasks(): Task[] {
  return all<Record<string, unknown>>('SELECT * FROM tasks ORDER BY sort_order ASC, id DESC').map(rowToTask);
}

export function createTask(input: TaskInput): Task {
  const title = String(input.title ?? '').trim();
  if (!title) throw new Error('任务名称不能为空');
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const status: TaskStatus = input.status ?? 'todo';
  run(
    `INSERT INTO tasks
      (title, description, status, importance, urgency, project, tags,
       start_date, due_date, progress, estimated_pomos, sort_order,
       created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      title,
      String(input.description ?? ''),
      status,
      input.importance ?? 'medium',
      input.urgency ?? 'medium',
      String(input.project ?? ''),
      JSON.stringify(input.tags ?? []),
      normalizeDateInput(input.start_date),
      normalizeDateInput(input.due_date),
      clampInt(input.progress ?? 0, 0, 100),
      clampInt(input.estimated_pomos ?? 0, 0, 9999),
      now,
      now,
      status === 'done' ? now : null,
    ],
  );
  return getTask(lastInsertId());
}

export function updateTask(id: number, patch: Partial<TaskInput>): Task {
  const existing = getTask(id);
  const sets: string[] = [];
  const params: (number | string | null)[] = [];
  if (patch.title !== undefined) {
    const t = String(patch.title).trim();
    if (!t) throw new Error('任务名称不能为空');
    sets.push('title = ?');
    params.push(t);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(String(patch.description));
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
    sets.push('completed_at = ?');
    params.push(patch.status === 'done' ? dayjs().format('YYYY-MM-DD HH:mm:ss') : null);
  }
  if (patch.importance !== undefined) {
    sets.push('importance = ?');
    params.push(patch.importance);
  }
  if (patch.urgency !== undefined) {
    sets.push('urgency = ?');
    params.push(patch.urgency);
  }
  if (patch.project !== undefined) {
    sets.push('project = ?');
    params.push(String(patch.project));
  }
  if (patch.tags !== undefined) {
    sets.push('tags = ?');
    params.push(JSON.stringify(patch.tags));
  }
  if (patch.start_date !== undefined) {
    sets.push('start_date = ?');
    params.push(normalizeDateInput(patch.start_date));
  }
  if (patch.due_date !== undefined) {
    sets.push('due_date = ?');
    params.push(normalizeDateInput(patch.due_date));
  }
  if (patch.progress !== undefined) {
    sets.push('progress = ?');
    params.push(clampInt(patch.progress, 0, 100));
  }
  if (patch.estimated_pomos !== undefined) {
    sets.push('estimated_pomos = ?');
    params.push(clampInt(patch.estimated_pomos, 0, 9999));
  }
  if (!sets.length) return existing;
  sets.push('updated_at = ?');
  params.push(dayjs().format('YYYY-MM-DD HH:mm:ss'));
  run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  return getTask(id);
}

export function deleteTask(id: number): void {
  run('DELETE FROM tasks WHERE id = ?', [id]);
}

function normalizeDate(v: unknown): string | null | 'invalid' {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'invalid' : dayjs(v).format('YYYY-MM-DD');
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? 'invalid' : dayjs(d).format('YYYY-MM-DD');
  }
  let s = String(v).trim();
  if (!s) return null;
  if (/^\d{8}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  s = s.replace(/日/g, '').replace(/[./年月]/g, '-');
  const d = dayjs(s, ['YYYY-M-D', 'YYYY-MM-DD']);
  if (d.isValid() && d.year() >= 2000 && d.year() <= 2100) return d.format('YYYY-MM-DD');
  return 'invalid';
}

function toImportRow(raw: Record<string, unknown>, rowNo: number): ImportRow {
  const errors: string[] = [];
  const pick = (...names: string[]): unknown => {
    for (const name of names) {
      const key = Object.keys(raw).find((k) => String(k).trim() === name);
      if (key !== undefined) {
        const v = raw[key];
        if (v !== '' && v !== null && v !== undefined) return v;
      }
    }
    return '';
  };
  const data: TaskInput = { title: '' };

  const title = String(pick('任务名称')).trim();
  if (!title) errors.push('任务名称不能为空');
  data.title = title;
  data.description = String(pick('描述'));

  const statusRaw = String(pick('状态')).trim();
  if (statusRaw) {
    const s = STATUS_FROM_ZH[statusRaw];
    if (!s) errors.push(`状态“${statusRaw}”无法识别`);
    else data.status = s;
  }

  const impRaw = String(pick('重要度')).trim();
  if (impRaw) {
    const l = LEVEL_FROM_ZH[impRaw];
    if (!l) errors.push(`重要度“${impRaw}”无法识别（应为 高/中/低）`);
    else data.importance = l;
  }

  const urgRaw = String(pick('紧急度')).trim();
  if (urgRaw) {
    const l = LEVEL_FROM_ZH[urgRaw];
    if (!l) errors.push(`紧急度“${urgRaw}”无法识别（应为 高/中/低）`);
    else data.urgency = l;
  }

  data.project = String(pick('项目')).trim();
  const tagsRaw = String(pick('标签')).trim();
  data.tags = tagsRaw ? tagsRaw.split(/[,，、;；]/).map((t) => t.trim()).filter(Boolean) : [];

  const start = normalizeDate(pick('开始日期'));
  if (start === 'invalid') errors.push('开始日期无法识别（应为 YYYY-MM-DD）');
  else data.start_date = start ?? null;

  const due = normalizeDate(pick('截止日期'));
  if (due === 'invalid') errors.push('截止日期无法识别（应为 YYYY-MM-DD）');
  else data.due_date = due ?? null;

  const pomoRaw = pick('预估番茄数');
  if (pomoRaw !== '') {
    const n = Number(pomoRaw);
    if (!Number.isFinite(n) || n < 0) errors.push('预估番茄数应为非负数字');
    else data.estimated_pomos = Math.round(n);
  }

  const progRaw = pick('进度(%)', '进度');
  if (progRaw !== '') {
    let n = Number(String(progRaw).replace('%', ''));
    if (!Number.isFinite(n)) errors.push('进度应为数字');
    else {
      if (n > 0 && n <= 1 && !Number.isInteger(n)) n = Math.round(n * 100);
      if (n < 0 || n > 100) errors.push('进度应在 0-100 之间');
      else data.progress = n;
    }
  }

  return { row: rowNo, data, errors };
}

export function parseImportFile(filePath: string): ParseResult {
  const X = xlsx();
  const wb = X.read(fs.readFileSync(filePath), { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('文件中没有工作表');
  const raw = X.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const rows = raw.map((r, i) => toImportRow(r, i + 2));
  const validCount = rows.filter((r) => r.errors.length === 0).length;
  return { rows, validCount, invalidCount: rows.length - validCount };
}

export function commitImport(rows: ImportRow[], mode: ImportMode): ImportResult {
  const valid = rows.filter((r) => r.errors.length === 0);
  if (!valid.length) throw new Error('没有可导入的有效数据');
  if (mode === 'overwrite') run('DELETE FROM tasks');
  for (const r of valid) createTask(r.data);
  return { inserted: valid.length, invalidCount: rows.length - valid.length };
}

function writeWorkbook(
  filePath: string,
  sheets: { name: string; rows: (string | number)[][]; widths: number[] }[],
): void {
  const X = xlsx();
  const wb = X.utils.book_new();
  for (const s of sheets) {
    const ws = X.utils.aoa_to_sheet(s.rows);
    ws['!cols'] = s.widths.map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, s.name);
  }
  X.writeFile(wb, filePath);
}

const COL_WIDTHS = [30, 40, 8, 8, 8, 12, 12, 14, 20, 10, 8];

export function exportTasks(filePath: string): number {
  const tasks = listTasks();
  const rows: (string | number)[][] = [
    TEMPLATE_HEADERS,
    ...tasks.map((t) => [
      t.title,
      t.description,
      STATUS_ZH[t.status],
      LEVEL_ZH[t.importance],
      LEVEL_ZH[t.urgency],
      t.start_date ?? '',
      t.due_date ?? '',
      t.project,
      t.tags.join('、'),
      t.estimated_pomos,
      t.progress,
    ]),
  ];
  writeWorkbook(filePath, [{ name: '任务列表', rows, widths: COL_WIDTHS }]);
  return tasks.length;
}

export function saveTemplate(filePath: string): void {
  const today = dayjs().format('YYYY-MM-DD');
  const nextWeek = dayjs().add(7, 'day').format('YYYY-MM-DD');
  const rows: (string | number)[][] = [
    TEMPLATE_HEADERS,
    ['示例：完成供应商接口联调', '与XX供应商完成接口联调并出报告', '进行中', '高', '高', today, nextWeek, '项目A', '联调、外部协作', 4, 20],
    ['示例：整理季度归档资料', '', '待办', '中', '低', '', '', '', '整理', 2, 0],
  ];
  const guide: string[][] = [
    ['列名', '是否必填', '填写说明'],
    ['任务名称', '是', '不能为空'],
    ['描述', '否', '任务补充说明'],
    ['状态', '否', '待办 / 进行中 / 已完成 / 已取消 / 挂起，默认“待办”'],
    ['重要度', '否', '高 / 中 / 低，默认“中”'],
    ['紧急度', '否', '高 / 中 / 低，默认“中”'],
    ['开始日期', '否', '格式 2026-09-25，Excel 日期格式也可以'],
    ['截止日期', '否', '同上'],
    ['项目', '否', '项目名称，纯文本'],
    ['标签', '否', '多个标签用逗号或顿号分隔'],
    ['预估番茄数', '否', '非负整数'],
    ['进度(%)', '否', '0-100 的数字'],
  ];
  writeWorkbook(filePath, [
    { name: '任务数据', rows, widths: COL_WIDTHS },
    { name: '填写说明', rows: guide, widths: [12, 10, 50] },
  ]);
}

export function dashboardStats(): DashboardStats {
  const today = dayjs().format('YYYY-MM-DD');
  const weekStart = dayjs().startOf('week').format('YYYY-MM-DD');
  const active = `status IN ('todo', 'in_progress', 'paused')`;

  const todayDue = all<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE ${active} AND due_date = ? ORDER BY importance DESC, id DESC`,
    [today],
  ).map(rowToTask);
  const overdue = all<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE ${active} AND due_date < ? AND due_date IS NOT NULL ORDER BY due_date ASC LIMIT 20`,
    [today],
  ).map(rowToTask);
  const recentlyDone = all<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE status = 'done' ORDER BY completed_at DESC LIMIT 8`,
  ).map(rowToTask);
  const doneRow = all<{ c: number }>(
    `SELECT COUNT(*) AS c FROM tasks WHERE status = 'done' AND completed_at >= ?`,
    [weekStart],
  )[0];
  const focusRow = all<{ m: number; c: number }>(
    `SELECT COALESCE(SUM(minutes), 0) AS m, COUNT(*) AS c FROM pomodoro_sessions
     WHERE kind = 'focus' AND substr(started_at, 1, 10) = ?`,
    [today],
  )[0];

  return {
    todayDue,
    overdue,
    recentlyDone,
    doneThisWeek: doneRow?.c ?? 0,
    focusMinutesToday: focusRow?.m ?? 0,
    focusCountToday: focusRow?.c ?? 0,
  };
}
