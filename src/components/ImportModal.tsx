import React, { useState } from 'react';
import { Alert, App, Button, Modal, Radio, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { InboxOutlined } from '@ant-design/icons';
import type { ImportMode, ImportResult, ImportRow, ParseResult } from '../../shared/types';
import { LEVEL_META, STATUS_META, errMsg } from '../utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

type Step = 'choose' | 'preview' | 'done';

const columns: ColumnsType<ImportRow> = [
  { title: '行', dataIndex: 'row', width: 50 },
  { title: '任务名称', key: 'title', render: (_, r) => r.data.title || '-' },
  {
    title: '状态',
    key: 'status',
    width: 80,
    render: (_, r) => (r.data.status ? STATUS_META[r.data.status].label : '-'),
  },
  {
    title: '重要度',
    key: 'importance',
    width: 70,
    render: (_, r) => (r.data.importance ? LEVEL_META[r.data.importance].label : '-'),
  },
  {
    title: '紧急度',
    key: 'urgency',
    width: 70,
    render: (_, r) => (r.data.urgency ? LEVEL_META[r.data.urgency].label : '-'),
  },
  { title: '截止日期', key: 'due', width: 100, render: (_, r) => r.data.due_date ?? '-' },
  { title: '项目', key: 'project', width: 90, render: (_, r) => r.data.project || '-' },
  {
    title: '校验结果',
    key: 'errors',
    render: (_, r) =>
      r.errors.length ? (
        <Typography.Text type="danger">{r.errors.join('；')}</Typography.Text>
      ) : (
        <Typography.Text type="success">通过</Typography.Text>
      ),
  },
];

export default function ImportModal({ open, onClose, onDone }: Props) {
  const { message } = App.useApp();
  const [step, setStep] = useState<Step>('choose');
  const [filePath, setFilePath] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mode, setMode] = useState<ImportMode>('append');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setStep('choose');
    setFilePath('');
    setParsed(null);
    setMode('append');
    setImporting(false);
    setResult(null);
  };

  const close = () => {
    onClose();
    reset();
  };

  const pickFile = async () => {
    try {
      const p = await window.api.pickImportFile();
      if (!p) return;
      setFilePath(p);
      const r = await window.api.parseImport(p);
      setParsed(r);
      setStep('preview');
    } catch (e) {
      message.error('解析失败：' + errMsg(e));
    }
  };

  const startImport = async () => {
    if (!parsed) return;
    setImporting(true);
    try {
      const valid = parsed.rows.filter((r) => r.errors.length === 0);
      const res = await window.api.commitImport(valid, mode);
      setResult(res);
      setStep('done');
      onDone();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      title="导入任务"
      open={open}
      onCancel={close}
      width={780}
      footer={
        step === 'choose' ? (
          <Button onClick={close}>取消</Button>
        ) : step === 'preview' ? (
          <Space>
            <Button onClick={() => setStep('choose')}>上一步</Button>
            <Button danger={mode === 'overwrite'} onClick={() => void startImport()} loading={importing}
              disabled={!parsed || parsed.validCount === 0}>
              开始导入（{parsed?.validCount ?? 0} 条）
            </Button>
          </Space>
        ) : (
          <Button type="primary" onClick={close}>
            完成
          </Button>
        )
      }
    >
      {step === 'choose' && (
        <div
          onClick={() => void pickFile()}
          style={{
            border: '1px dashed #b6c6ff',
            borderRadius: 8,
            padding: '48px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: '#fafbff',
          }}
        >
          <p style={{ fontSize: 40, margin: 0, color: '#4c6ef5' }}>
            <InboxOutlined />
          </p>
          <p style={{ fontSize: 15 }}>点击选择 xlsx / csv 文件</p>
          <p style={{ color: '#8c8c8c', fontSize: 12 }}>
            请使用固定模板（列：任务名称、描述、状态、重要度、紧急度、开始日期、截止日期、项目、标签、预估番茄数、进度）
          </p>
          <p style={{ color: '#8c8c8c', fontSize: 12 }}>还没有模板？在任务列表页点「下载模板」</p>
        </div>
      )}

      {step === 'preview' && parsed && (
        <>
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Typography.Text type="secondary">文件：{filePath}</Typography.Text>
            <Alert
              type={parsed.invalidCount > 0 ? 'warning' : 'success'}
              message={`共解析 ${parsed.rows.length} 行：有效 ${parsed.validCount} 行，无效 ${parsed.invalidCount} 行（无效行将跳过）`}
            />
            <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
              <Radio value="append">追加到现有任务</Radio>
              <Radio value="overwrite">
                清空现有任务后导入 <Tag color="red">危险</Tag>
              </Radio>
            </Radio.Group>
            {mode === 'overwrite' && (
              <Alert type="error" message="将删除当前全部任务，再导入文件中的有效数据，请谨慎选择！" />
            )}
            <Table
              rowKey="row"
              size="small"
              columns={columns}
              dataSource={parsed.rows}
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              rowClassName={(r) => (r.errors.length ? 'row-error' : '')}
              scroll={{ y: 260 }}
            />
          </Space>
        </>
      )}

      {step === 'done' && result && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <p style={{ fontSize: 40, margin: 0 }}>✅</p>
          <p style={{ fontSize: 16, marginTop: 12 }}>
            成功导入 <b>{result.inserted}</b> 条任务
            {result.invalidCount > 0 && `，跳过无效 ${result.invalidCount} 条`}
          </p>
        </div>
      )}
    </Modal>
  );
}
