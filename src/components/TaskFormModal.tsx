import React, { useEffect } from 'react';
import {
  App,
  AutoComplete,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Slider,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import type { Task, TaskInput, TaskStatus, Level } from '../../shared/types';
import { STATUS_OPTIONS, errMsg } from '../utils';

interface Props {
  open: boolean;
  initial?: Task | null;
  defaults?: Partial<TaskInput>;
  projects: string[];
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  title: string;
  description?: string;
  status: TaskStatus;
  importance: Level;
  urgency: Level;
  project?: string;
  tags?: string[];
  start_date?: Dayjs | null;
  due_date?: Dayjs | null;
  progress?: number;
  estimated_pomos?: number;
}

const STATUS_VALUES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: '待办' },
  { value: 'in_progress', label: '进行中' },
  { value: 'paused', label: '挂起' },
  { value: 'done', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
];

const LEVEL_OPTIONS = (['high', 'medium', 'low'] as Level[]).map((v) => ({
  value: v,
  label: { high: '高', medium: '中', low: '低' }[v],
}));

export default function TaskFormModal({ open, initial, defaults, projects, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (initial) {
      form.setFieldsValue({
        title: initial.title,
        description: initial.description,
        status: initial.status,
        importance: initial.importance,
        urgency: initial.urgency,
        project: initial.project,
        tags: initial.tags,
        start_date: initial.start_date ? dayjs(initial.start_date) : null,
        due_date: initial.due_date ? dayjs(initial.due_date) : null,
        progress: initial.progress,
        estimated_pomos: initial.estimated_pomos,
      });
    } else {
      form.setFieldsValue({
        status: 'todo',
        importance: defaults?.importance ?? 'medium',
        urgency: defaults?.urgency ?? 'medium',
        progress: 0,
        estimated_pomos: 0,
        tags: [],
        ...(defaults?.due_date ? { due_date: dayjs(defaults.due_date) } : {}),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const handleOk = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const payload: TaskInput = {
      title: values.title.trim(),
      description: values.description ?? '',
      status: values.status,
      importance: values.importance,
      urgency: values.urgency,
      project: values.project ?? '',
      tags: values.tags ?? [],
      start_date: values.start_date ? values.start_date.format('YYYY-MM-DD') : null,
      due_date: values.due_date ? values.due_date.format('YYYY-MM-DD') : null,
      progress: values.progress ?? 0,
      estimated_pomos: values.estimated_pomos ?? 0,
    };
    try {
      if (initial) await window.api.updateTask(initial.id, payload);
      else await window.api.createTask(payload);
      message.success('已保存');
      onSaved();
      onClose();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <Modal
      title={initial ? '编辑任务' : '新建任务'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      width={640}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item
          name="title"
          label="任务名称"
          rules={[{ required: true, message: '请输入任务名称' }]}
        >
          <Input placeholder="要做什么？" maxLength={200} />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea placeholder="补充说明（可选）" autoSize={{ minRows: 2, maxRows: 6 }} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="status" label="状态" rules={[{ required: true }]}>
              <Select options={STATUS_VALUES} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="importance" label="重要度" rules={[{ required: true }]}>
              <Select options={LEVEL_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="urgency" label="紧急度" rules={[{ required: true }]}>
              <Select options={LEVEL_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="project" label="项目">
              <AutoComplete
                options={projects.map((p) => ({ value: p }))}
                placeholder="所属项目（可选）"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="tags" label="标签">
              <Select mode="tags" tokenSeparators={[',', '，', '、']} placeholder="回车添加标签" open={false} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="start_date" label="开始日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="due_date"
              label="截止日期"
              dependencies={['start_date']}
              rules={[
                ({ getFieldValue }) => ({
                  validator: (_, v: Dayjs | null | undefined) => {
                    const s = getFieldValue('start_date') as Dayjs | undefined;
                    if (v && s && v.isBefore(s, 'day')) return Promise.reject('截止日期不能早于开始日期');
                    return Promise.resolve();
                  },
                }),
              ]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="estimated_pomos" label="预估番茄数">
              <InputNumber min={0} max={9999} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="progress" label="进度">
              <Slider min={0} max={100} step={5} marks={{ 0: '0', 50: '50', 100: '100' }} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
