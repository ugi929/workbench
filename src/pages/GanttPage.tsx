import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Empty, Radio, Tag, Tooltip } from 'antd';
import { CaretDownOutlined, CaretRightOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { Task, TaskInput } from '../../shared/types';
import { STATUS_META, errMsg, isOverdue } from '../utils';
import TaskFormModal from '../components/TaskFormModal';

interface Props {
  tasks: Task[];
  reload: () => Promise<void>;
}

type Scale = 'day' | 'week' | 'month';
type DragMode = 'move' | 'left' | 'right';

const NAME_W = 220;
const SCALES: Record<Scale, number> = { day: 32, week: 14, month: 5 };
const BAR_COLORS: Record<string, string> = {
  todo: '#5b8ff9',
  in_progress: '#4c6ef5',
  done: '#52c41a',
  paused: '#faad14',
  cancelled: '#bfbfbf',
};

interface DragState {
  id: number;
  mode: DragMode;
  startX: number;
  dx: number;
}

export default function GanttPage({ tasks, reload }: Props) {
  const { message } = App.useApp();
  const [scale, setScale] = useState<Scale>(() => {
    const m = window.location.hash.match(/scale=(day|week|month)/);
    return (m?.[1] as Scale) ?? 'week';
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; initial: Task | null }>({ open: false, initial: null });
  const dragRef = useRef<DragState | null>(null);
  const movedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [availW, setAvailW] = useState(900);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setAvailW(Math.max(320, el.clientWidth - 2));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dated = useMemo(() => tasks.filter((t) => t.start_date || t.due_date), [tasks]);
  const unscheduled = useMemo(
    () => tasks.filter((t) => !t.start_date && !t.due_date),
    [tasks],
  );

  const range = useMemo(() => {
    let min = dayjs();
    let max = dayjs().add(14, 'day');
    for (const t of dated) {
      const s = t.start_date ? dayjs(t.start_date) : null;
      const e = t.due_date ? dayjs(t.due_date) : s;
      if (s && s.isBefore(min)) min = s;
      if (e && e.isAfter(max)) max = e;
    }
    const start = min.subtract(2, 'day');
    const days = Math.max(21, max.diff(start, 'day') + 5);
    return { start, days };
  }, [dated]);

  const dayList = useMemo(
    () => Array.from({ length: range.days }, (_, i) => range.start.add(i, 'day')),
    [range],
  );

  // 时间轴始终占满容器宽度：天数少时按可用宽度放大格子，天数多时保底密度并横向滚动
  const px = Math.max(SCALES[scale], (availW - NAME_W) / range.days);

  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of dated) {
      const key = t.project || '未分组';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => (a.start_date ?? a.due_date ?? '').localeCompare(b.start_date ?? b.due_date ?? ''),
      );
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [dated]);

  useEffect(() => {
    if (!dragActive) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (Math.abs(e.clientX - d.startX) > 3) movedRef.current = true;
      const dx = Math.round((e.clientX - d.startX) / px);
      if (dx !== d.dx) {
        dragRef.current = { ...d, dx };
        setDrag(dragRef.current);
      }
    };
    const onUp = () => {
      void endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragActive, px]);

  const startDrag = (t: Task, mode: DragMode) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { id: t.id, mode, startX: e.clientX, dx: 0 };
    movedRef.current = false;
    setDrag(dragRef.current);
    setDragActive(true);
  };

  const endDrag = async () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    setDragActive(false);
    if (!d || d.dx === 0 || !movedRef.current) return;
    const t = tasks.find((x) => x.id === d.id);
    if (!t) return;
    const patch: Partial<TaskInput> = {};
    if (d.mode === 'move') {
      if (t.start_date) patch.start_date = dayjs(t.start_date).add(d.dx, 'day').format('YYYY-MM-DD');
      if (t.due_date) patch.due_date = dayjs(t.due_date).add(d.dx, 'day').format('YYYY-MM-DD');
    } else if (d.mode === 'left' && t.start_date) {
      const ns = dayjs(t.start_date).add(d.dx, 'day');
      if (t.due_date && ns.isAfter(dayjs(t.due_date), 'day')) {
        message.warning('开始日期不能晚于截止日期');
        return;
      }
      patch.start_date = ns.format('YYYY-MM-DD');
    } else if (d.mode === 'right' && t.due_date) {
      const nd = dayjs(t.due_date).add(d.dx, 'day');
      if (t.start_date && nd.isBefore(dayjs(t.start_date), 'day')) {
        message.warning('截止日期不能早于开始日期');
        return;
      }
      patch.due_date = nd.format('YYYY-MM-DD');
    }
    if (!Object.keys(patch).length) return;
    try {
      await window.api.updateTask(t.id, patch);
      await reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderBar = (t: Task) => {
    const barStart = t.start_date ? dayjs(t.start_date) : dayjs(t.due_date!);
    const barDue = t.due_date ? dayjs(t.due_date) : dayjs(t.start_date!);
    const left = barStart.diff(range.start, 'day') * px;
    const width = Math.max(6, (barDue.diff(barStart, 'day') + 1) * px);
    const isDragging = drag?.id === t.id;
    const dxp = isDragging ? drag!.dx * px : 0;
    let style: React.CSSProperties = { left, width, background: BAR_COLORS[t.status] };
    if (isDragging) {
      if (drag!.mode === 'move') style = { ...style, left: left + dxp };
      else if (drag!.mode === 'left') style = { ...style, left: left + dxp, width: Math.max(6, width - dxp) };
      else style = { ...style, width: Math.max(6, width + dxp) };
    }
    const resizable = Boolean(t.start_date && t.due_date) && width > 26;
    const hasDates = Boolean(t.start_date && t.due_date);
    return (
      <Tooltip title={`${t.start_date ?? ''} ~ ${t.due_date ?? ''} · ${STATUS_META[t.status].label}${t.progress ? ` · ${t.progress}%` : ''}`}>
        <div
          className="gantt-bar"
          style={{ ...style, outline: isOverdue(t) ? '2px solid #cf1322' : undefined }}
          onPointerDown={startDrag(t, 'move')}
          onClick={() => {
            if (movedRef.current) {
              movedRef.current = false;
              return;
            }
            setModal({ open: true, initial: t });
          }}
        >
          {t.progress > 0 && <div className="gantt-fill" style={{ width: `${t.progress}%` }} />}
          {resizable && <div className="gantt-handle left" onPointerDown={startDrag(t, 'left')} />}
          {resizable && <div className="gantt-handle right" onPointerDown={startDrag(t, 'right')} />}
          {!hasDates && width <= 14 && (
            <div style={{ position: 'absolute', top: -2, left: '50%', width: 8, height: 8, marginLeft: -4, transform: 'rotate(45deg)', background: 'inherit', borderRadius: 2 }} />
          )}
        </div>
      </Tooltip>
    );
  };

  const renderTrack = (children?: React.ReactNode) => (
    <div className="gantt-track" style={{ width: range.days * px }}>
      {dayList.map((d) => (
        <div
          key={d.format('YYYY-MM-DD')}
          className={`gantt-cell${d.day() === 0 || d.day() === 6 ? ' weekend' : ''}`}
        />
      ))}
      {children}
    </div>
  );

  const totalWidth = NAME_W + range.days * px;

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="page-toolbar">
        <Radio.Group
          optionType="button"
          value={scale}
          onChange={(e) => setScale(e.target.value as Scale)}
          options={[
            { value: 'day', label: '按日' },
            { value: 'week', label: '按周' },
            { value: 'month', label: '按月' },
          ]}
        />
        <span className="t-meta">
          <span className="legend-dot" style={{ background: BAR_COLORS.todo }} />待办
          <span className="legend-dot" style={{ background: BAR_COLORS.in_progress, marginLeft: 8 }} />进行中
          <span className="legend-dot" style={{ background: BAR_COLORS.done, marginLeft: 8 }} />已完成
          <span className="legend-dot" style={{ background: BAR_COLORS.paused, marginLeft: 8 }} />挂起
          <span style={{ marginLeft: 8 }}>▊红色边框 = 已逾期</span>
        </span>
        <span className="spacer" />
        <span className="t-meta">左右拖动条调整日期，拖动两端改起止，点击卡片编辑</span>
      </div>

      <div className="gantt-scroll" ref={scrollRef}>
        <div style={{ width: totalWidth }}>
          <div className="gantt-head-row" style={{ width: totalWidth }}>
            <div className="gantt-name gantt-corner" style={{ width: NAME_W }}>
              任务（{dated.length}）
            </div>
            <div className="gantt-head-days" style={{ width: range.days * px }}>
              {dayList.map((d, i) => {
                const weekend = d.day() === 0 || d.day() === 6;
                const isToday = d.isSame(dayjs(), 'day');
                let label: string = String(d.date());
                if (scale === 'month') label = d.date() === 1 || i === 0 ? d.format('M月') : '';
                else if (scale === 'day') label = `${d.date()}\n周${'日一二三四五六'[d.day()]}`;
                else if (d.date() === 1 || i === 0) label = d.format('M/D');
                return (
                  <div
                    key={d.format('YYYY-MM-DD')}
                    className={`gantt-head-day${weekend ? ' weekend' : ''}${isToday ? ' today' : ''}`}
                    style={{ whiteSpace: scale === 'day' ? 'pre' : 'nowrap' }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          </div>

          {groups.map(([project, list]) => (
            <React.Fragment key={project}>
              <div className="gantt-row group-row">
                <div className="gantt-name" style={{ width: NAME_W }}>
                  <Button
                    type="text"
                    size="small"
                    icon={collapsed.has(project) ? <CaretRightOutlined /> : <CaretDownOutlined />}
                    onClick={() => toggleGroup(project)}
                  />
                  {project}
                  <Tag style={{ marginRight: 0 }}>{list.length}</Tag>
                </div>
                {renderTrack()}
              </div>
              {!collapsed.has(project) &&
                list.map((t) => (
                  <div className="gantt-row" key={t.id}>
                    <div className="gantt-name" style={{ width: NAME_W }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: BAR_COLORS[t.status], flexShrink: 0 }} />
                      <Tooltip title={t.title}>
                        <span className="g-title">{t.title}</span>
                      </Tooltip>
                    </div>
                    {renderTrack(renderBar(t))}
                  </div>
                ))}
            </React.Fragment>
          ))}

          {unscheduled.length > 0 && (
            <>
              <div className="gantt-row group-row">
                <div className="gantt-name" style={{ width: NAME_W }}>
                  未排期
                  <Tag style={{ marginRight: 0 }}>{unscheduled.length}</Tag>
                </div>
                {renderTrack()}
              </div>
              {unscheduled.map((t) => (
                <div className="gantt-row" key={t.id}>
                  <div className="gantt-name" style={{ width: NAME_W }}>
                    <span className="g-title" style={{ color: 'var(--text-sub)' }}>{t.title}</span>
                  </div>
                  {renderTrack(
                    <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 8, fontSize: 12, color: 'var(--text-sub)' }}>
                      未设置日期，点击左侧编辑安排
                    </span>,
                  )}
                </div>
              ))}
            </>
          )}

          {tasks.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 40 }} />}
        </div>
      </div>

      <TaskFormModal
        open={modal.open}
        initial={modal.initial}
        projects={Array.from(new Set(tasks.map((t) => t.project).filter(Boolean)))}
        onClose={() => setModal({ open: false, initial: null })}
        onSaved={() => void reload()}
      />
    </div>
  );
}
