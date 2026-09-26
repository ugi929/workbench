import React, { useEffect } from 'react';
import { Button, Card, Progress, Select, Space, Table, Tag, Typography } from 'antd';
import { PauseOutlined, PlayCircleOutlined, StepForwardOutlined, UndoOutlined } from '@ant-design/icons';
import type { PomodoroConfig, Task, TaskStatus } from '../../shared/types';
import { ACTIVE_STATUSES } from '../utils';
import { usePomo, usePomoStats } from '../pomodoroStore';

const DEFAULT_CONFIG: PomodoroConfig = { focus: 25, short: 5, long: 15, rounds: 4 };

const MODE_META: Record<'focus' | 'short' | 'long', { label: string; color: string; bg: string }> = {
  focus: { label: '专注中', color: '#4c6ef5', bg: 'rgba(76,110,245,0.12)' },
  short: { label: '短休息', color: '#52c41a', bg: 'rgba(82,196,26,0.12)' },
  long: { label: '长休息', color: '#fa8c16', bg: 'rgba(250,140,22,0.12)' },
};

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Props {
  tasks: Task[];
  settingsRevision: number;
}

export default function PomodoroPage({ tasks, settingsRevision }: Props) {
  const pomo = usePomo();
  const statsData = usePomoStats();
  const snap = pomo.snap;
  const running = snap?.running ?? false;
  const mode = snap?.mode ?? 'focus';
  const focusDone = snap?.focusDone ?? 0;
  const config = snap?.config ?? DEFAULT_CONFIG;
  const taskId = snap?.taskId;
  const remaining = pomo.remaining;

  const activeTasks = React.useMemo(
    () => tasks.filter((t) => ACTIVE_STATUSES.includes(t.status as TaskStatus)),
    [tasks],
  );

  // 配置来自设置（pomodoro JSON）；变化时同步到主进程计时服务
  useEffect(() => {
    let cancelled = false;
    void window.api.getSettings().then((s) => {
      if (cancelled) return;
      if (s.pomodoro) {
        try {
          const parsed = JSON.parse(s.pomodoro) as PomodoroConfig;
          if (parsed.focus > 0) pomo.setConfig({ ...DEFAULT_CONFIG, ...parsed });
        } catch {
          // 配置损坏时用默认值
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [settingsRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = config[mode] * 60;

  useEffect(() => {
    document.title = running ? `${mmss(Math.max(0, remaining))} ${MODE_META[mode].label} · 工作台` : '工作台';
    return () => {
      document.title = '工作台';
    };
  }, [remaining, running, mode]);

  const meta = MODE_META[mode];
  const percent = total > 0 ? Math.max(0, Math.round((remaining / total) * 100)) : 0;
  const currentTask = activeTasks.find((t) => t.id === taskId);

  const maxFocus = Math.max(30, ...(statsData?.stats.trend.map((d) => d.minutes) ?? [30]));

  return (
    <div className="pomo-page">
      <div className="pomo-main">
        <Tag className="pomo-mode-tag" color={meta.color} style={{ fontSize: 14, padding: '2px 12px' }}>
          {meta.label}
        </Tag>
        <div className="pomo-ring" style={{ background: meta.bg, borderRadius: '50%' }}>
          <Progress
            type="circle"
            percent={percent}
            size={260}
            strokeWidth={6}
            strokeColor={meta.color}
            showInfo={false}
          />
          <div className="pomo-time" style={{ color: meta.color }}>
            {mmss(Math.max(0, remaining))}
          </div>
        </div>
        <div className="pomo-round">
          本轮第 {focusDone % config.rounds || (focusDone > 0 ? config.rounds : 0)} / {config.rounds} 个番茄
          {currentTask ? ` · ${currentTask.title}` : ''}
        </div>
        <Space size={12}>
          <Button
            type="primary"
            size="large"
            icon={running ? <PauseOutlined /> : <PlayCircleOutlined />}
            onClick={() => pomo.toggle()}
            style={{ minWidth: 120 }}
          >
            {running ? '暂停' : '开始'}
          </Button>
          <Button size="large" icon={<StepForwardOutlined />} onClick={() => pomo.skip()}>
            跳过
          </Button>
          <Button size="large" icon={<UndoOutlined />} onClick={() => pomo.reset()}>
            重置
          </Button>
        </Space>
        <Select
          style={{ width: 320 }}
          allowClear
          placeholder="选择要专注的任务（可选）"
          value={taskId}
          onChange={(v) => pomo.setTask(v)}
          options={activeTasks.map((t) => ({ value: t.id, label: t.title }))}
          showSearch
          optionFilterProp="label"
        />
      </div>

      <div className="pomo-side">
        <Card size="small" title="专注统计">
          <div className="pomo-stats-row">
            <div className="pomo-stat">
              <div className="v">{statsData?.stats.todayMinutes ?? 0}<span style={{ fontSize: 12 }}> 分钟</span></div>
              <div className="k">今日专注 · {statsData?.stats.todayCount ?? 0} 个番茄</div>
            </div>
            <div className="pomo-stat">
              <div className="v">{statsData?.stats.weekMinutes ?? 0}<span style={{ fontSize: 12 }}> 分钟</span></div>
              <div className="k">本周专注 · {statsData?.stats.weekCount ?? 0} 个番茄</div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>最近 14 天</Typography.Text>
            <div className="trend-chart">
              {(statsData?.stats.trend ?? []).map((d) => (
                <div key={d.date} className="trend-col" title={`${d.date}：${d.minutes} 分钟 / ${d.count} 个`}>
                  <div className="trend-bars">
                    <div className="trend-bar focus" style={{ width: '70%', height: `${(d.minutes / maxFocus) * 100}%` }} />
                  </div>
                  <div className="trend-label">{d.date.slice(8)}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card size="small" title="最近记录">
          <Table
            rowKey="id"
            size="small"
            dataSource={statsData?.recent ?? []}
            pagination={false}
            scroll={{ y: 220 }}
            columns={[
              {
                title: '任务',
                dataIndex: 'task_title',
                render: (v: string | null) => v ?? '未绑定任务',
                ellipsis: true,
              },
              { title: '时长', width: 70, render: (_, r) => `${r.minutes} 分钟` },
              {
                title: '时间',
                dataIndex: 'ended_at',
                width: 110,
                render: (v: string) => React.createElement('span', null, v.slice(5, 16)),
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
