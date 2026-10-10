import { contextBridge, ipcRenderer } from 'electron';
import type {
  HotkeyMap,
  ImportMode,
  ImportRow,
  LaunchInput,
  NoteInput,
  PomodoroSession,
  ReportKind,
  SettingsMap,
  TaskInput,
  TaskStatus,
} from '../shared/types';

const onAIEvent = (cb: (evt: unknown) => void) => {
  const listener = (_e: unknown, evt: unknown) => cb(evt);
  ipcRenderer.on('ai:event', listener as never);
  return () => {
    ipcRenderer.removeListener('ai:event', listener as never);
  };
};

const api = {
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  createTask: (input: TaskInput) => ipcRenderer.invoke('tasks:create', input),
  updateTask: (id: number, patch: Partial<TaskInput>) => ipcRenderer.invoke('tasks:update', id, patch),
  deleteTask: (id: number) => ipcRenderer.invoke('tasks:delete', id),
  setStatus: (id: number, status: TaskStatus) => ipcRenderer.invoke('tasks:setStatus', id, status),
  parseImport: (filePath: string) => ipcRenderer.invoke('import:parse', filePath),
  commitImport: (rows: ImportRow[], mode: ImportMode) => ipcRenderer.invoke('import:commit', rows, mode),
  pickImportFile: () => ipcRenderer.invoke('dialog:pickImportFile'),
  exportTasks: () => ipcRenderer.invoke('export:tasks'),
  saveTemplate: () => ipcRenderer.invoke('export:template'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p),
  showMain: () => ipcRenderer.invoke('window:show'),
  setTitleBar: (dark: boolean) => ipcRenderer.invoke('window:titlebar', dark),
  getSettings: (): Promise<SettingsMap> => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  /** 任意窗口改了数据（任务增删改 / 导入 / AI 写任务）后，主进程广播回来；返回取消订阅函数。
   * 各窗口据此重新拉取数据，保证主窗口与贴边面板、小组件之间数据一致。 */
  onDataChanged: (cb: (kind: string) => void) => {
    const listener = (_e: unknown, kind: string) => cb(kind);
    ipcRenderer.on('data:changed', listener as never);
    return () => ipcRenderer.removeListener('data:changed', listener as never);
  },
  /** 任意窗口调用 settings:set 后，主进程会广播回来；返回取消订阅函数 */
  onSettingsChanged: (cb: (key: string, value: string) => void) => {
    const listener = (_e: unknown, key: string, value: string) => cb(key, value);
    ipcRenderer.on('settings:changed', listener as never);
    return () => ipcRenderer.removeListener('settings:changed', listener as never);
  },
  /** 收起态拉手窗口的鼠标穿透状态切换（主进程轮询光标位置后下发）：
   *  'in' = 光标在拉手实体上（窗口可交互），'out' = 已穿透（渲染层收不到 mouseleave，
   *  必须靠这个信号把「悬停滑出」计时器撤掉，否则光标已经离开还会误展开）。 */
  onDockPointer: (cb: (phase: 'in' | 'out') => void) => {
    const listener = (_e: unknown, phase: 'in' | 'out') => cb(phase);
    ipcRenderer.on('dock:pointer', listener as never);
    return () => ipcRenderer.removeListener('dock:pointer', listener as never);
  },
  pomoRecord: (s: Omit<PomodoroSession, 'id'>) => ipcRenderer.invoke('pomo:record', s),
  pomoRecent: () => ipcRenderer.invoke('pomo:recent'),
  pomoStats: () => ipcRenderer.invoke('pomo:stats'),
  pomoGetState: () => ipcRenderer.invoke('pomo:getState'),
  pomoStart: () => ipcRenderer.invoke('pomo:start'),
  pomoPause: () => ipcRenderer.invoke('pomo:pause'),
  pomoToggle: () => ipcRenderer.invoke('pomo:toggle'),
  pomoSwitchMode: (mode: 'focus' | 'short' | 'long') => ipcRenderer.invoke('pomo:switchMode', mode),
  pomoReset: () => ipcRenderer.invoke('pomo:reset'),
  pomoSkip: () => ipcRenderer.invoke('pomo:skip'),
  pomoSetTask: (taskId: number | undefined) => ipcRenderer.invoke('pomo:setTask', taskId ?? null),
  pomoSetConfig: (cfg: { focus?: number; short?: number; long?: number; rounds?: number }) =>
    ipcRenderer.invoke('pomo:setConfig', cfg),
  onPomoState: (cb: (s: unknown) => void) => {
    const listener = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('pomo:state', listener as never);
    return () => ipcRenderer.removeListener('pomo:state', listener as never);
  },
  onPomoStats: (cb: (p: { stats: unknown; recent: unknown }) => void) => {
    const listener = (_e: unknown, p: { stats: unknown; recent: unknown }) => cb(p);
    ipcRenderer.on('pomo:stats', listener as never);
    return () => ipcRenderer.removeListener('pomo:stats', listener as never);
  },
  dashboardStats: () => ipcRenderer.invoke('stats:dashboard'),
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', title, body),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupOpenDir: () => ipcRenderer.invoke('backup:openDir'),
  backupRestore: (name: string) => ipcRenderer.invoke('backup:restore', name),
  notesList: () => ipcRenderer.invoke('notes:list'),
  notesGet: (id: number) => ipcRenderer.invoke('notes:get', id),
  notesCreate: (input?: NoteInput) => ipcRenderer.invoke('notes:create', input),
  notesUpdate: (id: number, patch: NoteInput) => ipcRenderer.invoke('notes:update', id, patch),
  notesDelete: (id: number) => ipcRenderer.invoke('notes:delete', id),
  notesOpen: (id: number) => ipcRenderer.invoke('notes:open', id),
  notesToggleAll: () => ipcRenderer.invoke('notes:toggleAll'),
  launchList: () => ipcRenderer.invoke('launch:list'),
  launchCreate: (input: LaunchInput) => ipcRenderer.invoke('launch:create', input),
  launchUpdate: (id: number, patch: Partial<LaunchInput>) => ipcRenderer.invoke('launch:update', id, patch),
  launchDelete: (id: number) => ipcRenderer.invoke('launch:delete', id),
  launchOpen: (id: number) => ipcRenderer.invoke('launch:open', id),
  hotkeysGet: (): Promise<HotkeyMap> => ipcRenderer.invoke('hotkeys:get'),
  hotkeysSet: (map: HotkeyMap) => ipcRenderer.invoke('hotkeys:set', map),
  widgetToggle: () => ipcRenderer.invoke('widget:toggle'),
  aiGetConfig: () => ipcRenderer.invoke('ai:getConfig'),
  aiSetConfig: (cfg: { baseURL: string; model: string; apiKey?: string }) => ipcRenderer.invoke('ai:setConfig', cfg),
  aiTest: (cfg: { baseURL: string; model: string; apiKey?: string }) => ipcRenderer.invoke('ai:test', cfg),
  aiSend: (text: string) => ipcRenderer.invoke('ai:send', text),
  aiStop: () => ipcRenderer.invoke('ai:stop'),
  aiMessages: () => ipcRenderer.invoke('ai:messages'),
  aiClear: () => ipcRenderer.invoke('ai:clear'),
  onAIEvent,
  reportGenerate: (kind: ReportKind, which: 'current' | 'previous') => ipcRenderer.invoke('report:generate', kind, which),
  reportList: () => ipcRenderer.invoke('report:list'),
  reportPreviewRange: (kind: ReportKind, which: 'current' | 'previous') =>
    ipcRenderer.invoke('report:previewRange', kind, which),
  reportDelete: (id: number) => ipcRenderer.invoke('report:delete', id),
  reportExport: (id: number) => ipcRenderer.invoke('report:export', id),
  clipsList: (keyword?: string) => ipcRenderer.invoke('clips:list', keyword),
  clipsCopy: (id: number) => ipcRenderer.invoke('clips:copy', id),
  clipsPin: (id: number, pinned: number) => ipcRenderer.invoke('clips:pin', id, pinned),
  clipsDelete: (id: number) => ipcRenderer.invoke('clips:delete', id),
  clipsClear: () => ipcRenderer.invoke('clips:clear'),
  clipsImageData: (id: number) => ipcRenderer.invoke('clips:imageData', id),
  clipsWatchStatus: () => ipcRenderer.invoke('clips:watchStatus'),
  clipsSetWatch: (v: boolean) => ipcRenderer.invoke('clips:setWatch', v),
  searchToggle: () => ipcRenderer.invoke('search:toggle'),
  dockExpand: (page?: string) => ipcRenderer.invoke('dock:expand', page),
  dockPanel: (page: string) => ipcRenderer.invoke('dock:panel', page),
  dockCollapse: () => ipcRenderer.invoke('dock:collapse'),
  dockRailFit: (width: number) => ipcRenderer.invoke('dock:railFit', width),
  dockPeekIn: () => ipcRenderer.invoke('dock:peekIn'),
  dockPeekOut: () => ipcRenderer.invoke('dock:peekOut'),
  railDragTo: (pt: { x: number; y: number }) => ipcRenderer.invoke('rail:dragTo', pt),
  railDragEnd: () => ipcRenderer.invoke('rail:dragEnd'),
};

contextBridge.exposeInMainWorld('api', api);
