import React, { useEffect, useState } from 'react';
import { Input } from 'antd';
import { CloseOutlined, LayoutOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { DashboardStats, Task } from '../../shared/types';
import { ACTIVE_STATUSES, errMsg } from '../utils';
import { initWidgetStyle } from '../widgetStyle';

export default function WidgetPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [quick, setQuick] = useState('');
  const [adding, setAdding] = useState(false);

  const load = React.useCallback(async () => {
    try {
      setTasks(await window.api.listTasks());
      setStats(await window.api.dashboardStats());
    } catch {
      // 小组件静默重试
    }
  }, []);

  useEffect(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    void load();
    const t = setInterval(() => void load(), 30000);
    // 其它窗口改了任务 → 立即刷新，不必等 30s 轮询
    const offData = window.api.onDataChanged(() => void load());
    // 背景色 / 不透明度来自设置页，并订阅变更实时刷新
    let off: (() => void) | null = null;
    let disposed = false;
    void initWidgetStyle().then((fn) => {
      if (disposed) fn();
      else off = fn;
    });
    return () => {
      disposed = true;
      clearInterval(t);
      off?.();
      offData();
    };
  }, [load]);

  const today = dayjs().format('YYYY-MM-DD');
  // 与 dashboardStats().todayDue 口径一致：到期日是今天，或起止区间包含今天的跨天任务
  const isTodayTask = (t: Task): boolean => {
    if (!ACTIVE_STATUSES.includes(t.status)) return false;
    if (t.due_date === today) return true;
    if (t.start_date && t.start_date <= today && (!t.due_date || t.due_date >= today)) return true;
    return false;
  };
  const todayTasks = tasks
    .filter(isTodayTask)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
    .slice(0, 8);

  const toggleDone = async (t: Task) => {
    await window.api.setStatus(t.id, t.status === 'done' ? 'todo' : 'done');
    void load();
  };

  const quickAdd = async () => {
    const title = quick.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await window.api.createTask({ title });
      setQuick('');
      await load();
    } catch (e) {
      // 小组件不弹错误提示，仅重置
      void errMsg(e);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="widget-root">
      <div className="widget-card">
        <div className="widget-head">
          <span className="widget-date">{dayjs().format('M月D日 dddd')}</span>
          <span className="widget-head-btns">
            <button className="widget-btn" title="打开主窗口" onClick={() => void window.api.showMain()}>
              <LayoutOutlined />
            </button>
            <button className="widget-btn" title="关闭" onClick={() => window.close()}>
              <CloseOutlined />
            </button>
          </span>
        </div>

        <div className="widget-quick">
          <Input
            size="small"
            placeholder="快速添加任务，回车确认"
            prefix={<PlusOutlined />}
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onPressEnter={() => void quickAdd()}
          />
        </div>

        <div className="widget-list">
          {todayTasks.length === 0 && <div className="widget-empty">今天没有待办 🎉</div>}
          {todayTasks.map((t) => (
            <label key={t.id} className="widget-item">
              <input
                type="checkbox"
                checked={false}
                onChange={() => void toggleDone(t)}
              />
              <span className={`widget-item-title${t.due_date && t.due_date < today ? ' overdue' : ''}`}>
                {t.title}
              </span>
              <span className="widget-item-due">
                {t.due_date === today ? '今天' : (t.due_date ?? '').slice(5)}
              </span>
            </label>
          ))}
        </div>

        <div className="widget-foot">
          <span>本周完成 {stats?.doneThisWeek ?? 0}</span>
          <span>逾期 {stats?.overdue.length ?? 0}</span>
          <span>今日专注 {stats?.focusMinutesToday ?? 0} 分钟</span>
        </div>
      </div>
    </div>
  );
}
