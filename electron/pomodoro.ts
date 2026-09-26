import dayjs from 'dayjs';
import { all, lastInsertId, run } from './db';
import type { PomodoroSession, PomodoroSessionWithTask, PomodoroStats } from '../shared/types';

export function recordSession(
  s: Pick<PomodoroSession, 'task_id' | 'kind' | 'started_at' | 'ended_at' | 'minutes'>,
): PomodoroSession {
  run(
    `INSERT INTO pomodoro_sessions (task_id, kind, started_at, ended_at, minutes) VALUES (?, ?, ?, ?, ?)`,
    [s.task_id ?? null, s.kind, s.started_at, s.ended_at, Math.max(0, Math.round(s.minutes))],
  );
  const rows = all<Record<string, unknown>>('SELECT * FROM pomodoro_sessions WHERE id = ?', [lastInsertId()]);
  return rows[0] as unknown as PomodoroSession;
}

export function recentSessions(limit = 20): PomodoroSessionWithTask[] {
  return all<PomodoroSessionWithTask>(
    `SELECT p.*, t.title AS task_title FROM pomodoro_sessions p
     LEFT JOIN tasks t ON t.id = p.task_id
     ORDER BY p.id DESC LIMIT ?`,
    [limit],
  );
}

export function stats(): PomodoroStats {
  const today = dayjs().format('YYYY-MM-DD');
  const weekStart = dayjs().startOf('week').format('YYYY-MM-DD');

  const todayRow = all<{ m: number; c: number }>(
    `SELECT COALESCE(SUM(minutes), 0) AS m, COUNT(*) AS c FROM pomodoro_sessions
     WHERE kind = 'focus' AND substr(started_at, 1, 10) = ?`,
    [today],
  )[0];
  const weekRow = all<{ m: number; c: number }>(
    `SELECT COALESCE(SUM(minutes), 0) AS m, COUNT(*) AS c FROM pomodoro_sessions
     WHERE kind = 'focus' AND substr(started_at, 1, 10) >= ?`,
    [weekStart],
  )[0];

  const since = dayjs().subtract(13, 'day').format('YYYY-MM-DD');
  const rows = all<{ d: string; m: number; c: number }>(
    `SELECT substr(started_at, 1, 10) AS d, COALESCE(SUM(minutes), 0) AS m, COUNT(*) AS c
     FROM pomodoro_sessions WHERE kind = 'focus' AND substr(started_at, 1, 10) >= ? GROUP BY d`,
    [since],
  );
  const byDate = new Map(rows.map((r) => [r.d, r]));
  const trend = Array.from({ length: 14 }, (_, i) => {
    const date = dayjs().subtract(13 - i, 'day').format('YYYY-MM-DD');
    const r = byDate.get(date);
    return { date, minutes: r?.m ?? 0, count: r?.c ?? 0 };
  });

  return {
    todayMinutes: todayRow?.m ?? 0,
    todayCount: todayRow?.c ?? 0,
    weekMinutes: weekRow?.m ?? 0,
    weekCount: weekRow?.c ?? 0,
    trend,
  };
}
