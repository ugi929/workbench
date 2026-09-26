import React, { useState } from 'react';
import { App, Button, Empty, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { Task, TaskInput } from '../../shared/types';
import { LEVEL_META, STATUS_META, ACTIVE_STATUSES, errMsg, isOverdue } from '../utils';
import TaskFormModal from '../components/TaskFormModal';

interface Props {
  tasks: Task[];
  reload: () => Promise<void>;
}

interface Quadrant {
  key: string;
  title: string;
  subtitle: string;
  color: string;
  isImportant: boolean;
  isUrgent: boolean;
}

const QUADRANTS: Quadrant[] = [
  { key: 'q1', title: '重要且紧急', subtitle: '立即做', color: '#ff4d4f', isImportant: true, isUrgent: true },
  { key: 'q2', title: '重要不紧急', subtitle: '计划做', color: '#2f54eb', isImportant: true, isUrgent: false },
  { key: 'q3', title: '紧急不重要', subtitle: '快速处理', color: '#fa8c16', isImportant: false, isUrgent: true },
  { key: 'q4', title: '不重要不紧急', subtitle: '尽量少做', color: '#8c8c8c', isImportant: false, isUrgent: false },
];

export default function QuadrantPage({ tasks, reload }: Props) {
  const { message } = App.useApp();
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; initial: Task | null; defaults?: Partial<TaskInput> }>({
    open: false,
    initial: null,
  });

  const active = tasks.filter((t) => ACTIVE_STATUSES.includes(t.status));

  const byQuadrant = (q: Quadrant) =>
    active.filter(
      (t) => (t.importance === 'high') === q.isImportant && (t.urgency === 'high') === q.isUrgent,
    );

  const moveTo = async (q: Quadrant, taskId: number) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    try {
      await window.api.updateTask(taskId, {
        importance: q.isImportant ? 'high' : 'low',
        urgency: q.isUrgent ? 'high' : 'low',
      });
      message.success(`「${t.title}」已移到「${q.title}」`);
      await reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const renderCard = (t: Task) => (
    <div
      key={t.id}
      className={`task-card${t.status === 'done' ? ' done' : ''}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/task-id', String(t.id))}
      onClick={() => setModal({ open: true, initial: t })}
    >
      <div className="t-title">{t.title}</div>
      <div className="t-meta">
        <Tag color={STATUS_META[t.status].color} style={{ marginRight: 0 }}>
          {STATUS_META[t.status].label}
        </Tag>
        {t.due_date && (
          <span style={isOverdue(t) ? { color: '#cf1322', fontWeight: 600 } : undefined}>
            截止 {t.due_date}
          </span>
        )}
        {t.progress > 0 && <span>进度 {t.progress}%</span>}
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-toolbar">
        <span style={{ color: '#8c8c8c' }}>
          拖拽卡片到其他象限可调整重要/紧急程度；点击卡片编辑；共 {active.length} 个未完结任务
        </span>
        <span className="spacer" />
      </div>
      <div className="quadrant-grid">
        {QUADRANTS.map((q) => {
          const list = byQuadrant(q);
          return (
            <div
              key={q.key}
              className={`quadrant-cell${dragOverKey === q.key ? ' drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverKey(q.key);
              }}
              onDragLeave={() => setDragOverKey((k) => (k === q.key ? null : k))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverKey(null);
                const id = Number(e.dataTransfer.getData('text/task-id'));
                if (id) void moveTo(q, id);
              }}
            >
              <div className="quadrant-head">
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: q.color,
                    display: 'inline-block',
                  }}
                />
                <b>{q.title}</b>
                <span style={{ color: '#8c8c8c', fontSize: 12 }}>{q.subtitle}</span>
                <Tag style={{ marginRight: 0 }}>{list.length}</Tag>
                <span className="spacer" style={{ flex: 1 }} />
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setModal({
                      open: true,
                      initial: null,
                      defaults: {
                        importance: q.isImportant ? 'high' : 'low',
                        urgency: q.isUrgent ? 'high' : 'low',
                        status: 'todo',
                      },
                    })
                  }
                >
                  添加
                </Button>
              </div>
              <div className="quadrant-body">
                {list.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="拖拽任务到这里" />}
                {list.map(renderCard)}
              </div>
            </div>
          );
        })}
      </div>

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
