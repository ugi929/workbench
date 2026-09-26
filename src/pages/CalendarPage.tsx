import React, { useState } from 'react';
import { App, Button, Card, Calendar, Checkbox, Empty, Radio, Space, Tag, Typography } from 'antd';
import { CalendarProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { Task, TaskInput } from '../../shared/types';
import { STATUS_META, errMsg, isOverdue } from '../utils';
import TaskFormModal from '../components/TaskFormModal';

interface Props {
  tasks: Task[];
  reload: () => Promise<void>;
}

export default function CalendarPage({ tasks, reload }: Props) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [selected, setSelected] = useState<Dayjs>(dayjs());
  const [modal, setModal] = useState<{ open: boolean; initial: Task | null; defaults?: Partial<TaskInput> }>({
    open: false,
    initial: null,
  });

  const dueTasks = (d: Dayjs) => tasks.filter((t) => t.due_date === d.format('YYYY-MM-DD'));

  const toggleDone = async (t: Task) => {
    try {
      await window.api.setStatus(t.id, t.status === 'done' ? 'todo' : 'done');
      await reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const chipRender: CalendarProps<Dayjs>['cellRender'] = (d, info) => {
    if (info.type !== 'date') return null;
    const list = dueTasks(d);
    if (!list.length) return null;
    return (
      <ul className="cal-chip-list">
        {list.slice(0, 3).map((t) => (
          <li
            key={t.id}
            className={`cal-chip chip-${t.status}${isOverdue(t) ? ' overdue' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setModal({ open: true, initial: t });
            }}
          >
            {t.title}
          </li>
        ))}
        {list.length > 3 && <li className="cal-more">+{list.length - 3} 更多</li>}
      </ul>
    );
  };

  const dayList = (d: Dayjs) => {
    const list = dueTasks(d);
    if (!list.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无任务" />;
    return list.map((t) => (
      <div key={t.id} className="task-card" onClick={() => setModal({ open: true, initial: t })}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Checkbox checked={t.status === 'done'} onClick={(e) => e.stopPropagation()} onChange={() => void toggleDone(t)} />
          <span className={`t-title${t.status === 'done' ? ' done' : ''}`} style={{ flex: 1 }}>
            {t.title}
          </span>
          <Tag color={STATUS_META[t.status].color} style={{ marginRight: 0 }}>
            {STATUS_META[t.status].label}
          </Tag>
        </div>
        {(t.project || t.importance === 'high') && (
          <div className="t-meta" style={{ marginTop: 4 }}>
            {t.project && <span>{t.project}</span>}
            {t.importance === 'high' && <span>重要度：高</span>}
          </div>
        )}
      </div>
    ));
  };

  const addBtn = (d: Dayjs) => (
    <Button
      type="dashed"
      size="small"
      block
      icon={<PlusOutlined />}
      onClick={() =>
        setModal({
          open: true,
          initial: null,
          defaults: { due_date: d.format('YYYY-MM-DD'), status: 'todo' },
        })
      }
    >
      新建
    </Button>
  );

  const weekStart = selected.startOf('week');
  const weekDays = Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="page-toolbar">
        <Radio.Group
          optionType="button"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          options={[
            { value: 'month', label: '月视图' },
            { value: 'week', label: '周视图' },
          ]}
        />
        <span className="spacer" />
        <Typography.Text type="secondary">按截止日期展示任务，点击日期卡片可编辑</Typography.Text>
      </div>

      {mode === 'month' ? (
        <div className="cal-layout" style={{ height: 'calc(100vh - 130px)' }}>
          <Card size="small" className="cal-main" styles={{ body: { padding: 8, height: '100%', overflow: 'auto' } }}>
            <Calendar cellRender={chipRender} onSelect={(d) => setSelected(d)} />
          </Card>
          <Card
            size="small"
            className="cal-side"
            styles={{ body: { padding: 12, flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' } }}
          >
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {selected.format('M月D日 dddd')}
            </Typography.Title>
            <div style={{ flex: 1, overflowY: 'auto' }}>{dayList(selected)}</div>
            <div style={{ paddingTop: 8 }}>{addBtn(selected)}</div>
          </Card>
        </div>
      ) : (
        <div className="week-grid">
          {weekDays.map((d) => (
            <div key={d.format('YYYY-MM-DD')} className={`week-col${d.isSame(dayjs(), 'day') ? ' today' : ''}`}>
              <div className="week-head">
                <span>{d.format('ddd')}</span>
                <span style={{ fontWeight: d.isSame(dayjs(), 'day') ? 700 : 400 }}>{d.format('M/D')}</span>
              </div>
              <div className="week-body">
                {dayList(d)}
                {addBtn(d)}
              </div>
            </div>
          ))}
        </div>
      )}

      <TaskFormModal
        open={modal.open}
        initial={modal.initial}
        defaults={modal.defaults}
        projects={Array.from(new Set(tasks.map((t) => t.project).filter(Boolean)))}
        onClose={() => setModal({ open: false, initial: null })}
        onSaved={() => void reload()}
      />
    </div>
  );
}
