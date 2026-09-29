import React from 'react';
import { Button, Progress, Tag } from 'antd';
import { CloseOutlined, LayoutOutlined, PauseOutlined, PlayCircleOutlined, RedoOutlined, StepForwardOutlined } from '@ant-design/icons';
import { usePomo, usePomoStats } from '../pomodoroStore';
import type { PomodoroConfig } from '../../shared/types';

const DEFAULT_CONFIG: PomodoroConfig = { focus: 25, short: 5, long: 15, rounds: 4 };

const MODE_META: Record<'focus' | 'short' | 'long', { label: string; color: string; bg: string }> = {
  focus: { label: '专注中', color: '#4c6ef5', bg: 'rgba(76,110,245,0.14)' },
  short: { label: '短休息', color: '#52c41a', bg: 'rgba(82,196,26,0.14)' },
  long: { label: '长休息', color: '#fa8c16', bg: 'rgba(250,140,22,0.14)' },
};

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function PomodoroWidgetPage() {
  const pomo = usePomo();
  const statsData = usePomoStats();
  const snap = pomo.snap;
  const running = snap?.running ?? false;
  const mode = snap?.mode ?? 'focus';
  const remaining = pomo.remaining;
  const config = snap?.config ?? DEFAULT_CONFIG;
  const meta = MODE_META[mode];
  const total = config[mode] * 60;
  const percent = total > 0 ? Math.max(0, Math.round((remaining / total) * 100)) : 0;
  const todayMinutes = statsData?.stats.todayMinutes ?? 0;
  const todayCount = statsData?.stats.todayCount ?? 0;

  return (
    <div className="widget-root">
      <div className="widget-card pomo-widget">
        <div className="widget-head">
          <span className="widget-date">🍅 番茄钟</span>
          <span className="widget-head-btns">
            <button className="widget-btn" title="打开主窗口" onClick={() => void window.api.showMain('pomodoro')}>
              <LayoutOutlined />
            </button>
            <button className="widget-btn" title="关闭" onClick={() => window.close()}>
              <CloseOutlined />
            </button>
          </span>
        </div>

        <div className="pomo-w-ring" style={{ background: meta.bg }}>
          <Progress type="circle" percent={percent} size={168} strokeWidth={7} strokeColor={meta.color} showInfo={false} />
          <div className="pomo-w-time" style={{ color: meta.color }}>
            {mmss(Math.max(0, remaining))}
          </div>
        </div>

        <div className="pomo-w-mode">
          <Tag color={meta.color} style={{ fontSize: 13, padding: '1px 10px', margin: 0 }}>
            {meta.label}
          </Tag>
        </div>

        <div className="pomo-w-actions">
          <Button type="primary" size="middle" icon={running ? <PauseOutlined /> : <PlayCircleOutlined />} onClick={() => void pomo.toggle()}>
            {running ? '暂停' : '开始'}
          </Button>
          <Button size="middle" icon={<StepForwardOutlined />} onClick={() => void pomo.skip()}>
            跳过
          </Button>
          <Button size="middle" icon={<RedoOutlined />} onClick={() => void pomo.reset()}>
            重置
          </Button>
        </div>

        <div className="pomo-w-foot">
          <span>今日 {todayMinutes} 分钟</span>
          <span>{todayCount} 个番茄</span>
        </div>
      </div>
    </div>
  );
}
