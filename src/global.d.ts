import type {
  AiChatMessage,
  AiConfigPublic,
  AppInfo,
  BackupInfo,
  Clip,
  DashboardStats,
  HotkeyMap,
  ImportMode,
  ImportResult,
  ImportRow,
  LaunchItem,
  LaunchInput,
  Note,
  NoteInput,
  ParseResult,
  PomodoroSession,
  PomodoroSessionWithTask,
  PomodoroStats,
  Report,
  ReportKind,
  SettingsMap,
  Task,
  TaskInput,
  TaskStatus,
} from '../shared/types';

declare global {
  interface Window {
    api: {
      listTasks(): Promise<Task[]>;
      createTask(input: TaskInput): Promise<Task>;
      updateTask(id: number, patch: Partial<TaskInput>): Promise<Task>;
      deleteTask(id: number): Promise<void>;
      setStatus(id: number, status: TaskStatus): Promise<Task>;
      parseImport(filePath: string): Promise<ParseResult>;
      commitImport(rows: ImportRow[], mode: ImportMode): Promise<ImportResult>;
      pickImportFile(): Promise<string | null>;
      exportTasks(): Promise<{ filePath: string; count: number } | null>;
      saveTemplate(): Promise<{ filePath: string } | null>;
      getAppInfo(): Promise<AppInfo>;
      openPath(p: string): Promise<string>;
      showMain(page?: string): Promise<void>;
      setTitleBar(dark: boolean): Promise<boolean>;
      getSettings(): Promise<SettingsMap>;
      setSetting(key: string, value: string): Promise<void>;
      /** 数据变更广播（任务增删改 / 导入 / AI 写任务后推送给所有窗口），返回取消订阅函数 */
      onDataChanged(cb: (kind: string) => void): () => void;
      /** 设置变更广播（主进程 settings:set 后推送给所有窗口），返回取消订阅函数 */
      onSettingsChanged(cb: (key: string, value: string) => void): () => void;
      pomoRecord(s: Omit<PomodoroSession, 'id'>): Promise<PomodoroSession>;
      pomoRecent(): Promise<PomodoroSessionWithTask[]>;
      pomoStats(): Promise<PomodoroStats>;
      pomoGetState(): Promise<{
        running: boolean;
        mode: 'focus' | 'short' | 'long';
        endAt: number | null;
        segmentLen: number;
        focusDone: number;
        taskId?: number;
        config: PomodoroConfig;
      }>;
      pomoStart(): Promise<void>;
      pomoPause(): Promise<void>;
      pomoToggle(): Promise<void>;
      pomoSwitchMode(mode: 'focus' | 'short' | 'long'): Promise<void>;
      pomoReset(): Promise<void>;
      pomoSkip(): Promise<void>;
      pomoSetTask(taskId: number | undefined): Promise<void>;
      pomoSetConfig(cfg: { focus?: number; short?: number; long?: number; rounds?: number }): Promise<void>;
      onPomoState(cb: (s: {
        running: boolean;
        mode: 'focus' | 'short' | 'long';
        endAt: number | null;
        segmentLen: number;
        focusDone: number;
        taskId?: number;
        config: PomodoroConfig;
      }) => void): () => void;
      onPomoStats(cb: (p: { stats: PomodoroStats; recent: PomodoroSessionWithTask[] }) => void): () => void;
      dashboardStats(): Promise<DashboardStats>;
      notify(title: string, body: string): Promise<void>;
      backupNow(): Promise<{ name: string; size: number }>;
      backupList(): Promise<BackupInfo[]>;
      backupOpenDir(): Promise<string>;
      backupRestore(name: string): Promise<boolean>;
      notesList(): Promise<Note[]>;
      notesGet(id: number): Promise<Note>;
      notesCreate(input?: NoteInput): Promise<Note>;
      notesUpdate(id: number, patch: NoteInput): Promise<Note>;
      notesDelete(id: number): Promise<void>;
      notesOpen(id: number): Promise<void>;
      notesToggleAll(): Promise<void>;
      launchList(): Promise<LaunchItem[]>;
      launchCreate(input: LaunchInput): Promise<LaunchItem>;
      launchUpdate(id: number, patch: Partial<LaunchInput>): Promise<LaunchItem>;
      launchDelete(id: number): Promise<void>;
      launchOpen(id: number): Promise<string>;
      hotkeysGet(): Promise<HotkeyMap>;
      hotkeysSet(map: HotkeyMap): Promise<{ failed: string[] }>;
      widgetToggle(): Promise<void>;
      aiGetConfig(): Promise<AiConfigPublic>;
      aiSetConfig(cfg: { baseURL: string; model: string; apiKey?: string }): Promise<AiConfigPublic>;
      aiTest(cfg: { baseURL: string; model: string; apiKey?: string }): Promise<string>;
      aiSend(text: string): Promise<string>;
      aiStop(): Promise<void>;
      aiMessages(): Promise<AiChatMessage[]>;
      aiClear(): Promise<void>;
      onAIEvent(cb: (evt: { type: 'delta'; text: string } | { type: 'tool'; name: string; summary: string } | { type: 'error'; message: string }) => void): () => void;
      reportGenerate(kind: ReportKind, which: 'current' | 'previous'): Promise<Report>;
      reportList(): Promise<Report[]>;
      reportPreviewRange(
        kind: ReportKind,
        which: 'current' | 'previous',
      ): Promise<{ start: string; end: string; days: number; title: string }>;
      reportDelete(id: number): Promise<void>;
      reportExport(id: number): Promise<{ filePath: string } | null>;
      clipsList(keyword?: string): Promise<Clip[]>;
      clipsCopy(id: number): Promise<void>;
      clipsPin(id: number, pinned: number): Promise<void>;
      clipsDelete(id: number): Promise<void>;
      clipsClear(): Promise<void>;
      clipsImageData(id: number): Promise<string>;
      clipsWatchStatus(): Promise<boolean>;
      clipsSetWatch(v: boolean): Promise<void>;
      searchToggle(): Promise<void>;
      dockExpand(page?: string): Promise<void>;
      dockPanel(page: string): Promise<void>;
      dockCollapse(): Promise<void>;
      dockRailFit(width: number): Promise<void>;
      dockPeekIn(): Promise<void>;
      dockPeekOut(): Promise<void>;
      railDragTo(pt: { x: number; y: number }): Promise<void>;
      railDragEnd(): Promise<void>;
    };
  }
}

export {};
