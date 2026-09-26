import React, { useEffect, useState } from 'react';
import { App, Button, Empty, Form, Input, Modal, Popconfirm, Select } from 'antd';
import {
  FolderOutlined,
  LinkOutlined,
  PlusOutlined,
  WindowsOutlined,
} from '@ant-design/icons';
import type { LaunchItem, LaunchType } from '../../shared/types';
import { errMsg } from '../utils';

const TYPE_META: Record<LaunchType, { label: string; icon: React.ReactNode; placeholder: string; color: string }> = {
  folder: {
    label: '文件夹',
    icon: <FolderOutlined />,
    placeholder: '例如：D:\\工作文档',
    color: '#faad14',
  },
  url: {
    label: '网页',
    icon: <LinkOutlined />,
    placeholder: '例如：https://github.com',
    color: '#4c6ef5',
  },
  app: {
    label: '软件',
    icon: <WindowsOutlined />,
    placeholder: '例如：C:\\Program Files\\...\\xxx.exe',
    color: '#52c41a',
  },
};

interface FormValues {
  name: string;
  type: LaunchType;
  target: string;
}

export default function LaunchPage() {
  const { message } = App.useApp();
  const [items, setItems] = useState<LaunchItem[]>([]);
  const [modal, setModal] = useState<{ open: boolean; editing: LaunchItem | null }>({
    open: false,
    editing: null,
  });
  const [form] = Form.useForm<FormValues>();

  const load = React.useCallback(async () => {
    try {
      setItems(await window.api.launchList());
    } catch (e) {
      message.error(errMsg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (item: LaunchItem) => {
    try {
      const err = await window.api.launchOpen(item.id);
      if (err) message.error(`打开失败：${err}`);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const del = async (id: number) => {
    try {
      await window.api.launchDelete(id);
      message.success('已删除');
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const handleOk = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      if (modal.editing) await window.api.launchUpdate(modal.editing.id, values);
      else await window.api.launchCreate(values);
      message.success('已保存');
      setModal({ open: false, editing: null });
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <div className="page">
      <div className="page-toolbar">
        <span className="t-meta">双击卡片或点击「打开」直达；文件夹与软件路径在本机生效</span>
        <span className="spacer" />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({ type: 'url' });
            setModal({ open: true, editing: null });
          }}
        >
          新建启动项
        </Button>
      </div>

      {items.length === 0 && (
        <Empty description="还没有启动项，把常用的文件夹 / 网页 / 软件加进来吧" style={{ marginTop: 80 }} />
      )}

      <div className="launch-grid">
        {items.map((it) => {
          const meta = TYPE_META[it.type] ?? TYPE_META.url;
          return (
            <div key={it.id} className="launch-card" onDoubleClick={() => void open(it)}>
              <div className="launch-icon" style={{ background: meta.color }}>
                {meta.icon}
              </div>
              <div className="launch-info">
                <div className="launch-name">{it.name}</div>
                <div className="launch-target" title={it.target}>
                  {it.target}
                </div>
              </div>
              <div className="launch-actions">
                <Button type="link" size="small" onClick={() => void open(it)}>
                  打开
                </Button>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    form.setFieldsValue({ name: it.name, type: it.type, target: it.target });
                    setModal({ open: true, editing: it });
                  }}
                >
                  编辑
                </Button>
                <Popconfirm title="确定删除该启动项？" onConfirm={() => void del(it.id)}>
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        title={modal.editing ? '编辑启动项' : '新建启动项'}
        open={modal.open}
        onOk={() => void handleOk()}
        onCancel={() => setModal({ open: false, editing: null })}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="显示名称" maxLength={50} />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'url', label: '网页' },
                { value: 'folder', label: '文件夹' },
                { value: 'app', label: '软件' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.type !== b.type}>
            {({ getFieldValue }) => {
              const t = (getFieldValue('type') as LaunchType) ?? 'url';
              return (
                <Form.Item name="target" label="目标" rules={[{ required: true, message: '请输入目标地址' }]}>
                  <Input placeholder={TYPE_META[t].placeholder} />
                </Form.Item>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
