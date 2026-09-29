import { BrowserWindow } from 'electron';

/**
 * 向所有还活着的渲染窗口广播一条 IPC 事件。
 * 用于「数据变化让所有窗口（主窗口 / 贴边面板 / 小组件）一起刷新」这类场景：
 * 在某个窗口改了任务后，其它窗口不用重开就能看到最新数据。
 * 发送时包裹 try/catch——窗口正在销毁时 webContents.send 可能抛错，忽略即可。
 */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    try {
      w.webContents.send(channel, ...args);
    } catch {
      // 窗口正在销毁，忽略
    }
  }
}
