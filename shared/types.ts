export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled' | 'paused';
export type Level = 'high' | 'medium' | 'low';
export type ImportMode = 'append' | 'overwrite';
export type ThemeMode = 'light' | 'dark';

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  importance: Level;
  urgency: Level;
  project: string;
  tags: string[];
  start_date: string | null;
  due_date: string | null;
  progress: number;
  estimated_pomos: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  importance?: Level;
  urgency?: Level;
  project?: string;
  tags?: string[];
  start_date?: string | null;
  due_date?: string | null;
  progress?: number;
  estimated_pomos?: number;
}

export interface ImportRow {
  row: number;
  data: TaskInput;
  errors: string[];
}

export interface ParseResult {
  rows: ImportRow[];
  validCount: number;
  invalidCount: number;
}

export interface ImportResult {
  inserted: number;
  invalidCount: number;
}

export interface AppInfo {
  dataDir: string;
  version: string;
}

export interface PomodoroSession {
  id: number;
  task_id: number | null;
  kind: 'focus' | 'short' | 'long';
  started_at: string;
  ended_at: string;
  minutes: number;
}

export interface PomodoroSessionWithTask extends PomodoroSession {
  task_title: string | null;
}

export interface PomodoroConfig {
  focus: number;
  short: number;
  long: number;
  rounds: number;
}

export interface PomodoroStats {
  todayMinutes: number;
  todayCount: number;
  weekMinutes: number;
  weekCount: number;
  trend: { date: string; minutes: number; count: number }[];
}

export interface DashboardStats {
  todayDue: Task[];
  overdue: Task[];
  recentlyDone: Task[];
  doneThisWeek: number;
  focusMinutesToday: number;
  focusCountToday: number;
}

export interface BackupInfo {
  name: string;
  size: number;
  mtime: string;
}

export type SettingsMap = Record<string, string | null>;

// 桌面小组件（启动项小组件 Alt+L / 任务小组件 Alt+W）的外观
export interface WidgetStyle {
  /** 背景基色，`#rrggbb` */
  bgColor: string;
  /** 背景不透明度百分比 0~100 */
  bgOpacity: number;
}

export interface Note {
  id: number;
  content: string;
  color: string;
  pos_x: number | null;
  pos_y: number | null;
  created_at: string;
  updated_at: string;
}

export interface NoteInput {
  content?: string;
  color?: string;
  pos_x?: number | null;
  pos_y?: number | null;
}

export type LaunchType = 'folder' | 'url' | 'app';

export interface LaunchItem {
  id: number;
  name: string;
  type: LaunchType;
  target: string;
  sort_order: number;
  created_at: string;
}

export interface LaunchInput {
  name: string;
  type: LaunchType;
  target: string;
}

export interface HotkeyMap {
  main: string;
  widget: string;
  note: string;
  search: string;
  launch: string;
}

export interface Clip {
  id: number;
  type: 'text' | 'image';
  content: string;
  file_path: string | null;
  pinned: number;
  created_at: string;
}

export type ReportKind = 'weekly' | 'monthly' | 'yearly';

export interface Report {
  id: number;
  kind: ReportKind;
  period: string;
  title: string;
  content: string;
  created_at: string;
}

export type AiEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'error'; message: string };

export interface AiChatMessage {
  id: number | string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  created_at?: string;
}

export interface AiConfigPublic {
  baseURL: string;
  model: string;
  hasKey: boolean;
  keyMask: string;
}
