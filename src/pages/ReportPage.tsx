import React, { useCallback, useEffect, useRef, useState } from 'react';
import { App, Button, Card, Radio, Segmented, Space, Table, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, DownloadOutlined, FileTextOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { marked } from 'marked';
import type { Report, ReportKind } from '../../shared/types';
import { errMsg } from '../utils';

interface RangePreview {
  start: string;
  end: string;
  days: number;
  title: string;
}

/** 兜底看门狗：主进程的 AI 调用已有 90 秒超时，这里再兜一层，保证按钮不会永久卡住 */
const WATCHDOG_MS = 180_000;
const WATCHDOG = Symbol('watchdog');

function renderMd(text: string): string {
  try {
    return marked.parse(text, { async: false }) as string;
  } catch {
    return text;
  }
}

export default function ReportPage() {
  const { message } = App.useApp();
  const [kind, setKind] = useState<ReportKind>('weekly');
  const [which, setWhich] = useState<'current' | 'previous'>('current');
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [reports, setReports] = useState<Report[]>([]);
  const [current, setCurrent] = useState<Report | null>(null);
  const [range, setRange] = useState<RangePreview | null>(null);
  const [ai, setAi] = useState<{ model: string; ready: boolean } | null>(null);
  const runningRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setReports(await window.api.reportList());
    } catch (e) {
      message.error(errMsg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 把「AI 到底能不能用」显示出来：否则 AI 没配好时报告会静默退化成纯统计，
  // 用户会以为「生成的报告怎么没有总结」。
  useEffect(() => {
    let alive = true;
    void window.api
      .aiGetConfig()
      .then((c) => {
        if (alive) setAi({ model: c.model, ready: c.hasKey && Boolean(c.baseURL && c.model) });
      })
      .catch(() => {
        if (alive) setAi(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 切「周报/月报/年报」或「本期/上期」时，立刻把将要生成的区间显示出来。
  // 否则点了 tab 页面上什么都不变，看着就像「点了没反应」。
  useEffect(() => {
    let alive = true;
    void window.api
      .reportPreviewRange(kind, which)
      .then((r) => {
        if (alive) setRange(r);
      })
      .catch(() => {
        if (alive) setRange(null);
      });
    return () => {
      alive = false;
    };
  }, [kind, which]);

  // 生成中的秒表：让用户看得见「还在跑」
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [generating]);

  const generate = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setGenerating(true);
    setElapsed(0);
    try {
      const r = await Promise.race([
        window.api.reportGenerate(kind, which),
        new Promise<typeof WATCHDOG>((res) => setTimeout(() => res(WATCHDOG), WATCHDOG_MS)),
      ]);
      if (r === WATCHDOG) {
        throw new Error(
          `生成超过 ${WATCHDOG_MS / 1000} 秒仍未返回，已放弃等待。请检查网络或 AI 接口；若列表里稍后出现了新报告，说明它其实跑完了。`,
        );
      }
      setCurrent(r);
      await load();
      message.success(`已生成并保存《${r.title}》`);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      runningRef.current = false;
      setGenerating(false);
      setElapsed(0);
    }
  };

  const copy = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.content);
      message.success('已复制到剪贴板');
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const exportMd = async () => {
    if (!current) return;
    try {
      const r = await window.api.reportExport(current.id);
      if (r) message.success(`已导出：${r.filePath}`);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const del = async (id: number) => {
    try {
      await window.api.reportDelete(id);
      if (current?.id === id) setCurrent(null);
      await load();
      message.success('已删除');
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <div className="page">
      <div className="page-toolbar">
        <Segmented
          value={kind}
          onChange={(v) => setKind(v as ReportKind)}
          options={[
            { value: 'weekly', label: '周报' },
            { value: 'monthly', label: '月报' },
            { value: 'yearly', label: '年报' },
          ]}
        />
        <Radio.Group
          optionType="button"
          value={which}
          onChange={(e) => setWhich(e.target.value)}
          options={[
            { value: 'current', label: '本期' },
            { value: 'previous', label: '上期' },
          ]}
        />
        <Button
          className="report-generate"
          type="primary"
          icon={<FileTextOutlined />}
          loading={generating}
          onClick={() => void generate()}
        >
          {generating ? `生成中… ${elapsed}s` : '生成报告'}
        </Button>
      </div>

      <div className="report-hint">
        {generating ? (
          <>
            正在生成《{range?.title ?? '…'}》… 已用 {elapsed} 秒
            {elapsed >= 20 && '（AI 叙述较慢，最多等 90 秒，超时会自动改用纯统计数据，报告一样会保存）'}
          </>
        ) : (
          <>
            将要生成 <b>{range?.title ?? '…'}</b>
            {range && (
              <>
                {' '}
                · 区间 {range.start} ~ {range.end}（{range.days} 天）
              </>
            )}{' '}
            · 数据来自任务与番茄钟 ·{' '}
            <span className={ai && !ai.ready ? 'report-ai-off' : undefined}>
              AI 总结：{ai === null ? '未知' : ai.ready ? `已启用（${ai.model}）` : '未启用'}
            </span>
            {ai && !ai.ready && '（到「设置 → AI 配置」补上接口与 Key，报告就会自动带总结；现在出的是纯统计数据）'}
          </>
        )}
      </div>

      <div className="report-layout">
        <Card size="small" title="历史报告" className="report-list">
          <Table
            rowKey="id"
            size="small"
            dataSource={reports}
            pagination={false}
            locale={{ emptyText: '还没有报告' }}
            onRow={(r) => ({ onClick: () => setCurrent(r), style: { cursor: 'pointer' } })}
            rowClassName={(r) => (current?.id === r.id ? 'ant-table-row-selected' : '')}
            columns={[
              { title: '报告', dataIndex: 'title', ellipsis: true },
              {
                title: '生成时间',
                dataIndex: 'created_at',
                width: 110,
                render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
              },
              {
                title: '',
                width: 60,
                render: (_, r) => (
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      void del(r.id);
                    }}
                  />
                ),
              },
            ]}
          />
        </Card>

        <Card
          size="small"
          className="report-view"
          title={current ? current.title : '报告预览'}
          extra={
            current && (
              <Space>
                <Button size="small" icon={<CopyOutlined />} onClick={() => void copy()}>
                  复制
                </Button>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => void exportMd()}>
                  导出
                </Button>
              </Space>
            )
          }
        >
          {current ? (
            <div className="report-md" dangerouslySetInnerHTML={{ __html: renderMd(current.content) }} />
          ) : (
            <Typography.Text type="secondary">
              点「生成报告」会按上面的选择产出 <b>{range?.title ?? '…'}</b>
              {range && `（${range.start} ~ ${range.end}）`}
              ：读取区间内的任务完成、项目分布、逾期与专注数据；配置 AI 后自动撰写总结，纯统计模式也能出数。
              生成完成后会自动出现在左侧「历史报告」里。
            </Typography.Text>
          )}
        </Card>
      </div>
    </div>
  );
}
