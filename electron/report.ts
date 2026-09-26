import dayjs from 'dayjs';
import { all, lastInsertId, run } from './db';
import * as ai from './ai';
import type { Report, ReportKind } from '../shared/types';

interface ReportStats {
  kind: ReportKind;
  title: string;
  start: string;
  end: string;
  completedCount: number;
  createdCount: number;
  overdueCount: number;
  activeLeft: number;
  byProject: { name: string; done: number; total: number }[];
  topDone: { title: string; project: string }[];
  focusMinutes: number;
  focusCount: number;
  avgFocusPerDay: number;
}

function resolveRange(kind: ReportKind, which: 'current' | 'previous'): { start: dayjs.Dayjs; end: dayjs.Dayjs } {
  const now = dayjs();
  if (kind === 'weekly') {
    const start = which === 'current' ? now.startOf('week') : now.startOf('week').subtract(7, 'day');
    return { start, end: start.add(6, 'day') };
  }
  if (kind === 'monthly') {
    const base = which === 'current' ? now.startOf('month') : now.startOf('month').subtract(1, 'month');
    return { start: base, end: base.endOf('month') };
  }
  const year = which === 'current' ? now.year() : now.year() - 1;
  return { start: dayjs(`${year}-01-01`), end: dayjs(`${year}-12-31`) };
}

/** 报告里的 AI 叙述最多等这么久，超时就退化成纯统计（报告一定要出得来） */
const AI_TIMEOUT_MS = Number(process.env.WORKBENCH_REPORT_AI_TIMEOUT_MS || '') || 90_000;

const AI_SYSTEM =
  '你是一名高效的个人助理，擅长把统计数据写成结构清晰、语气务实的中文报告。' +
  '只使用给定 JSON 里的数字与任务名，不编造任何数据或任务。';

export function reportTitle(kind: ReportKind, start: dayjs.Dayjs, s: string, e: string): string {
  return kind === 'weekly'
    ? `周报 ${s} ~ ${e}`
    : kind === 'monthly'
      ? `${start.format('YYYY年M月')} 月报`
      : `${start.format('YYYY')} 年报`;
}

/** 给 UI 用：把「周报/月报/年报 + 本期/上期」换算成具体区间，切 tab 时立刻有反馈 */
export function previewRange(
  kind: ReportKind,
  which: 'current' | 'previous',
): { start: string; end: string; days: number; title: string } {
  const { start, end } = resolveRange(kind, which);
  const s = start.format('YYYY-MM-DD');
  const e = end.format('YYYY-MM-DD');
  return { start: s, end: e, days: end.diff(start, 'day') + 1, title: reportTitle(kind, start, s, e) };
}

function collectStats(kind: ReportKind, which: 'current' | 'previous'): ReportStats {
  const { start, end } = resolveRange(kind, which);
  const s = start.format('YYYY-MM-DD');
  const e = end.format('YYYY-MM-DD');
  const days = end.diff(start, 'day') + 1;

  const completed = all<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE status = 'done' AND substr(completed_at, 1, 10) BETWEEN ? AND ? ORDER BY completed_at ASC`,
    [s, e],
  );
  const createdCount = all<{ c: number }>(
    `SELECT COUNT(*) AS c FROM tasks WHERE substr(created_at, 1, 10) BETWEEN ? AND ?`,
    [s, e],
  )[0]?.c ?? 0;
  const today = dayjs().format('YYYY-MM-DD');
  const overdueCount = all<{ c: number }>(
    `SELECT COUNT(*) AS c FROM tasks WHERE status IN ('todo','in_progress','paused') AND due_date IS NOT NULL AND due_date < ?`,
    [today],
  )[0]?.c ?? 0;
  const activeLeft = all<{ c: number }>(
    `SELECT COUNT(*) AS c FROM tasks WHERE status IN ('todo','in_progress','paused')`,
  )[0]?.c ?? 0;
  const focus = all<{ m: number; c: number }>(
    `SELECT COALESCE(SUM(minutes),0) AS m, COUNT(*) AS c FROM pomodoro_sessions
     WHERE kind = 'focus' AND substr(started_at, 1, 10) BETWEEN ? AND ?`,
    [s, e],
  )[0];

  const projMap = new Map<string, { done: number; total: number }>();
  for (const row of completed) {
    const name = String(row.project || '未分组');
    projMap.set(name, { done: (projMap.get(name)?.done ?? 0) + 1, total: (projMap.get(name)?.total ?? 0) + 1 });
  }

  return {
    kind,
    title: reportTitle(kind, start, s, e),
    start: s,
    end: e,
    completedCount: completed.length,
    createdCount,
    overdueCount,
    activeLeft,
    byProject: Array.from(projMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.done - a.done),
    topDone: completed.slice(0, 10).map((r) => ({
      title: String(r.title),
      project: String(r.project || ''),
    })),
    focusMinutes: focus?.m ?? 0,
    focusCount: focus?.c ?? 0,
    avgFocusPerDay: Math.round(((focus?.m ?? 0) / days) * 10) / 10,
  };
}

function statsToMarkdown(st: ReportStats): string {
  const lines: string[] = [];
  lines.push(`# ${st.title}`, '');
  lines.push(`统计区间：${st.start} ~ ${st.end}`, '');
  lines.push('## 核心数据', '');
  lines.push(`- 完成任务：**${st.completedCount}** 项（本期新建 ${st.createdCount} 项）`);
  lines.push(`- 当前逾期：${st.overdueCount} 项，未完成任务存量 ${st.activeLeft} 项`);
  lines.push(`- 专注时长：**${st.focusMinutes}** 分钟（${st.focusCount} 个番茄，日均 ${st.avgFocusPerDay} 分钟）`, '');
  if (st.byProject.length) {
    lines.push('## 按项目分布（完成）', '');
    for (const p of st.byProject) lines.push(`- ${p.name}：完成 ${p.done} 项`);
    lines.push('');
  }
  if (st.topDone.length) {
    lines.push('## 本期完成的主要任务', '');
    for (const t of st.topDone) lines.push(`- ${t.title}${t.project ? `（${t.project}）` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

function buildPrompt(st: ReportStats): string {
  return [
    '请根据下面这份 JSON 统计数据，撰写一份中文' +
      (st.kind === 'weekly' ? '周报' : st.kind === 'monthly' ? '月报' : '年报') +
      '，Markdown 格式。',
    '',
    '要求：',
    '1. 结构包含：本期概览（2-3 句总结）、核心数据、按项目/主题的进展、问题与风险（逾期情况）、下期建议。',
    '2. 只能使用 JSON 中的数字与任务名，不要编造任何数据或任务。',
    '3. 语气务实，突出成果，明确指出逾期风险。',
    '',
    '```json',
    JSON.stringify(st, null, 2),
    '```',
  ].join('\n');
}

export async function generateReport(kind: ReportKind, which: 'current' | 'previous'): Promise<Report> {
  const st = collectStats(kind, which);
  let content: string;
  if (ai.isConfigured()) {
    try {
      // 注意：这里走 writeMarkdown（单轮、无工具、无聊天历史、不写 ai_messages），
      // 不要改回 runAgent —— 详见 ai.ts 里 writeMarkdown 的注释。
      content = await ai.writeMarkdown(buildPrompt(st), { timeoutMs: AI_TIMEOUT_MS, system: AI_SYSTEM });
    } catch (err) {
      content =
        statsToMarkdown(st) +
        `\n---\n> AI 叙述生成失败（${err instanceof Error ? err.message : String(err)}），以上为纯统计数据。`;
    }
  } else {
    content = statsToMarkdown(st) + '\n---\n> 未配置 AI，以上为纯统计数据。配置 AI 后可自动生成叙述性总结。';
  }
  run('INSERT INTO reports (kind, period, title, content, created_at) VALUES (?, ?, ?, ?, ?)', [
    st.kind,
    st.start.slice(0, kind === 'yearly' ? 4 : kind === 'monthly' ? 7 : 10),
    st.title,
    content,
    dayjs().format('YYYY-MM-DD HH:mm:ss'),
  ]);
  const rows = all<Record<string, unknown>>('SELECT * FROM reports WHERE id = ?', [lastInsertId()]);
  return rows[0] as unknown as Report;
}

export function listReports(limit = 50): Report[] {
  return all<Record<string, unknown>>('SELECT * FROM reports ORDER BY id DESC LIMIT ?', [limit]).map(
    (r) => r as unknown as Report,
  );
}

export function getReport(id: number): Report {
  const rows = all<Record<string, unknown>>('SELECT * FROM reports WHERE id = ?', [id]);
  if (!rows.length) throw new Error('报告不存在');
  return rows[0] as unknown as Report;
}

export function deleteReport(id: number): void {
  run('DELETE FROM reports WHERE id = ?', [id]);
}
