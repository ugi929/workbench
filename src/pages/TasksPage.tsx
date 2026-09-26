import React, { useMemo, useState } from 'react';
import {
  App,
  Button,
  Dropdown,
  Input,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DownOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  FileAddOutlined,
  PlusOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { Task, TaskStatus } from '../../shared/types';
import { LEVEL_META, STATUS_META, STATUS_OPTIONS, errMsg, isOverdue } from '../utils';
import TaskFormModal from '../components/TaskFormModal';
import ImportModal from '../components/ImportModal';

interface Props {
  tasks: Task[];
  loading: boolean;
  reload: () => Promise<void>;
}

const NEXT_ACTIONS: Record<TaskStatus, { key: TaskStatus; label: string }[]> = {
  todo: [
    { key: 'in_progress', label: '开始处理' },
    { key: 'done', label: '标记完成' },
    { key: 'cancelled', label: '取消任务' },
  ],
  in_progress: [
    { key: 'done', label: '标记完成' },
    { key: 'paused', label: '挂起' },
    { key: 'cancelled', label: '取消任务' },
  ],
  paused: [
    { key: 'in_progress', label: '继续处理' },
    { key: 'done', label: '标记完成' },
    { key: 'cancelled', label: '取消任务' },
  ],
  done: [{ key: 'todo', label: '重新打开' }],
  cancelled: [{ key: 'todo', label: '重新打开' }],
};

export default function TasksPage({ tasks, loading, reload }: Props) {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | undefined>();
  const [projectFilter, setProjectFilter] = useState<string | undefined>();
  const [editing, setEditing] = useState<Task | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const projects = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.project).filter(Boolean))),
    [tasks],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (projectFilter && t.project !== projectFilter) return false;
      if (kw) {
        const hay = `${t.title}\n${t.description}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [tasks, keyword, statusFilter, projectFilter]);

  const overdueCount = filtered.filter((t) => isOverdue(t)).length;

  const changeStatus = async (id: number, status: TaskStatus) => {
    try {
      await window.api.setStatus(id, status);
      message.success('已更新');
      await reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const del = async (id: number) => {
    try {
      await window.api.deleteTask(id);
      message.success('已删除');
      await reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const doExport = async () => {
    try {
      const r = await window.api.exportTasks();
      if (r) message.success(`已导出 ${r.count} 条任务`);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const doTemplate = async () => {
    try {
      const r = await window.api.saveTemplate();
      if (r) message.success('模板已保存');
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const columns: ColumnsType<Task> = [
    {
      title: '任务',
      key: 'title',
      render: (_, t) => (
        <div>
          <Tooltip title={t.description || undefined}>
            <span style={{ fontWeight: 500 }}>{t.title}</span>
          </Tooltip>
          {(t.project || t.tags.length > 0) && (
            <div className="t-meta" style={{ marginTop: 2 }}>
              {t.project && <Tag style={{ marginRight: 0 }}>{t.project}</Tag>}
              {t.tags.map((tag) => (
                <Tag key={tag} color="blue" style={{ marginRight: 0 }}>
                  {tag}
                </Tag>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: TaskStatus) => <Tag color={STATUS_META[s].color}>{STATUS_META[s].label}</Tag>,
    },
    {
      title: '重要度',
      dataIndex: 'importance',
      width: 80,
      render: (l: Task['importance']) => <Tag color={LEVEL_META[l].color}>{LEVEL_META[l].label}</Tag>,
    },
    {
      title: '紧急度',
      dataIndex: 'urgency',
      width: 80,
      render: (l: Task['urgency']) => <Tag color={LEVEL_META[l].color}>{LEVEL_META[l].label}</Tag>,
    },
    {
      title: '截止日期',
      dataIndex: 'due_date',
      width: 130,
      sorter: (a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''),
      render: (_, t) =>
        t.due_date ? (
          <span style={isOverdue(t) ? { color: '#cf1322', fontWeight: 600 } : undefined}>
            {t.due_date}
            {isOverdue(t) && ' 已逾期'}
          </span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>-</span>
        ),
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 110,
      render: (p: number) => <Progress percent={p} size="small" />,
    },
    {
      title: '操作',
      key: 'actions',
      width: 230,
      render: (_, t) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditing(t);
              setFormOpen(true);
            }}
          >
            编辑
          </Button>
          <Dropdown
            menu={{
              items: NEXT_ACTIONS[t.status].map((a) => ({ key: a.key, label: a.label })),
              onClick: ({ key }) => void changeStatus(t.id, key as TaskStatus),
            }}
          >
            <Button type="link" size="small">
              状态 <DownOutlined />
            </Button>
          </Dropdown>
          <Popconfirm title="确定删除该任务？" onConfirm={() => void del(t.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索任务名称 / 描述"
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 120 }}
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <Select
          allowClear
          placeholder="项目"
          style={{ width: 140 }}
          options={projects.map((p) => ({ value: p, label: p }))}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <span className="spacer" />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          新建任务
        </Button>
        <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
          导入
        </Button>
        <Button icon={<ExportOutlined />} onClick={() => void doExport()}>
          导出
        </Button>
        <Button icon={<FileAddOutlined />} onClick={() => void doTemplate()}>
          下载模板
        </Button>
      </div>

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        pagination={{ pageSize: 15, showTotal: (n) => `共 ${n} 条` }}
      />
      <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
        当前筛选 {filtered.length} 条{overdueCount > 0 && `，其中逾期 ${overdueCount} 条`}
      </div>

      <TaskFormModal
        open={formOpen}
        initial={editing}
        projects={projects}
        onClose={() => setFormOpen(false)}
        onSaved={() => void reload()}
      />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => void reload()} />
    </div>
  );
}
