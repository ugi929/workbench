import React, { useEffect, useState } from 'react';
import { App, Card, Checkbox, Col, Empty, Row, Statistic, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import type { DashboardStats, PomodoroStats, Task } from '../../shared/types';
import { STATUS_META, errMsg, isOverdue } from '../utils';
import TaskFormModal from '../components/TaskFormModal';

interface Props {
  tasks: Task[];
  reload: () => Promise<void>;
}

export default function DashboardPage({ tasks, reload }: Props) {
  const { message } = App.useApp();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pomo, setPomo] = useState<PomodoroStats | null>(null);
  const [modal, setModal] = useState<{ open: boolean; initial: Task | null }>({ open: false, initial: null });

  const load = React.useCallback(async () => {
    try {
      setStats(await window.api.dashboardStats());
      setPomo(await window.api.pomoStats());
    } catch (e) {
      message.error(errMsg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, tasks]);

  const toggleDone = async (t: Task) => {
    try {
      await window.api.setStatus(t.id, t.status === 'done' ? 'todo' : 'done');
      await reload();
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const maxDone = Math.max(1, ...(pomo?.trend.map((d) => d.count) ?? [1]));
  const maxFocus = Math.max(30, ...(pomo?.trend.map((d) => d.minutes) ?? [30]));

  const taskItem = (t: Task, danger = false) => (
    <div key={t.id} className="task-card" onClick={() => setModal({ open: true, initial: t })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox checked={t.status === 'done'} onClick={(e) => e.stopPropagation()} onChange={() => void toggleDone(t)} />
        <span className={`t-title${t.status === 'done' ? ' done' : ''}`} style={{ flex: 1, margin: 0 }}>
          {t.title}
        </span>
        {danger && isOverdue(t) && (
          <Tag color="red" style={{ marginRight: 0 }}>
            逾期
          </Tag>
        )}
        <Tag color={STATUS_META[t.status].color} style={{ marginRight: 0 }}>
          {STATUS_META[t.status].label}
        </Tag>
      </div>
      <div className="t-meta" style={{ marginTop: 4 }}>
        {t.due_date && <span>截止 {t.due_date}</span>}
        {t.project && <span>{t.project}</span>}
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="stat-grid">
        <Card size="small" className="stat-card">
          <Statistic title="今日待办" value={stats?.todayDue.length ?? 0} />
        </Card>
        <Card size="small" className="stat-card">
          <Statistic title="已逾期" value={stats?.overdue.length ?? 0} valueStyle={{ color: '#cf1322' }} />
        </Card>
        <Card size="small" className="stat-card">
          <Statistic title="本周完成" value={stats?.doneThisWeek ?? 0} valueStyle={{ color: '#52c41a' }} />
        </Card>
        <Card size="small" className="stat-card">
          <div className="focus-stat">
            <span className="focus-stat-label">今日专注</span>
            <div className="focus-stat-main">
              <span className="focus-stat-num">{stats?.focusMinutesToday ?? 0}</span>
              <span className="focus-stat-unit">分钟</span>
            </div>
            <div className="focus-stat-sub">{stats?.focusCountToday ?? 0} 个番茄</div>
          </div>
        </Card>
      </div>

      <div className="board-panels" style={{ marginBottom: 12 }}>
        <Card size="small" title={`今日待办（${stats?.todayDue.length ?? 0}）`}>
          <div className="board-list">
            {stats && stats.todayDue.length > 0 ? (
              stats.todayDue.map((t) => taskItem(t))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今天没有截止任务，安排点重要的吧" />
            )}
          </div>
        </Card>
        <Card size="small" title={`已逾期（${stats?.overdue.length ?? 0}）`} styles={{ header: { color: '#cf1322' } }}>
          <div className="board-list">
            {stats && stats.overdue.length > 0 ? (
              stats.overdue.map((t) => taskItem(t, true))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有逾期任务，很棒 👍" />
            )}
          </div>
        </Card>
      </div>

      <Card size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography.Text strong>最近 14 天趋势</Typography.Text>
          <span className="t-meta">
            <span className="legend-dot" style={{ background: 'var(--primary)' }} />完成任务
            <span className="legend-dot" style={{ background: '#52c41a', marginLeft: 12 }} />专注分钟
          </span>
        </div>
        <div className="trend-chart">
          {(pomo?.trend ?? []).map((d) => (
            <div key={d.date} className="trend-col" title={`${d.date}：完成 ${d.count} 项 · 专注 ${d.minutes} 分钟`}>
              <div className="trend-bars">
                <div className="trend-bar done" style={{ height: `${(d.count / maxDone) * 100}%` }} />
                <div className="trend-bar focus" style={{ height: `${(d.minutes / maxFocus) * 100}%` }} />
              </div>
              <div className="trend-label">{d.date.slice(5).replace('-', '/')}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card size="small" title="最近完成" style={{ marginTop: 12 }}>
        <Row gutter={[8, 8]}>
          {(stats?.recentlyDone ?? []).map((t) => (
            <Col key={t.id} span={6}>
              <div className="t-meta" style={{ fontSize: 13 }}>
                <span className="legend-dot" style={{ background: '#52c41a' }} />
                <TooltipedTitle task={t} />
              </div>
            </Col>
          ))}
          {!stats?.recentlyDone.length && (
            <Col span={24}>
              <span className="t-meta">还没有已完成任务</span>
            </Col>
          )}
        </Row>
      </Card>

      <TaskFormModal
        open={modal.open}
        initial={modal.initial}
        projects={Array.from(new Set(tasks.map((t) => t.project).filter(Boolean)))}
        onClose={() => setModal({ open: false, initial: null })}
        onSaved={() => {
          void reload();
          void load();
        }}
      />
    </div>
  );
}

function TooltipedTitle({ task }: { task: Task }) {
  return (
    <span>
      {task.title}
      <span style={{ color: 'var(--text-sub)', marginLeft: 6, fontSize: 12 }}>
        {task.completed_at ? dayjs(task.completed_at).format('MM-DD HH:mm') : ''}
      </span>
    </span>
  );
}
