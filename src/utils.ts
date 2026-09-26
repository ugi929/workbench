import dayjs from 'dayjs';
import type { Level, Task, TaskStatus } from '../shared/types';

export const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: '待办', color: 'default' },
  in_progress: { label: '进行中', color: 'processing' },
  done: { label: '已完成', color: 'success' },
  paused: { label: '挂起', color: 'warning' },
  cancelled: { label: '已取消', color: 'default' },
};

export const STATUS_OPTIONS = (Object.keys(STATUS_META) as TaskStatus[]).map((v) => ({
  value: v,
  label: STATUS_META[v].label,
}));

export const LEVEL_META: Record<Level, { label: string; color: string }> = {
  high: { label: '高', color: 'red' },
  medium: { label: '中', color: 'gold' },
  low: { label: '低', color: 'default' },
};

export const ACTIVE_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'paused'];

export function isOverdue(t: Task, today: dayjs.Dayjs = dayjs()): boolean {
  return Boolean(t.due_date) && t.status !== 'done' && t.status !== 'cancelled'
    && t.due_date! < today.format('YYYY-MM-DD');
}

export function errMsg(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  const m = s.match(/Error: (.+)$/);
  return m ? m[1] : s;
}
