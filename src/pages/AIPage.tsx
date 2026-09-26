import React, { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Input, Tooltip } from 'antd';
import { ClearOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { marked } from 'marked';
import { errMsg } from '../utils';

interface VMsg {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  streaming?: boolean;
}

const QUICK_PROMPTS = [
  '列出我今天的待办任务',
  '新建任务：明天下午写周报，很重要',
  '帮我看看现在有没有逾期任务',
  '总结一下我这周的工作状态',
];

interface Props {
  onTasksChanged?: () => void;
}

function renderMd(text: string): string {
  try {
    return marked.parse(text, { async: false }) as string;
  } catch {
    return text;
  }
}

export default function AIPage({ onTasksChanged }: Props) {
  const { message } = App.useApp();
  const [msgs, setMsgs] = useState<VMsg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [configured, setConfigured] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void window.api.aiMessages().then((list) => {
      setMsgs(list.map((m) => ({ id: String(m.id), role: m.role as VMsg['role'], content: m.content })));
    });
    void window.api.aiGetConfig().then((c) => {
      setConfigured(Boolean(c.hasKey && c.baseURL && c.model));
    });
  }, []);

  useEffect(() => {
    const off = window.api.onAIEvent((evt) => {
      if (evt.type === 'delta') {
        setMsgs((ms) => {
          const last = ms[ms.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            return [...ms.slice(0, -1), { ...last, content: last.content + evt.text }];
          }
          return ms;
        });
      } else if (evt.type === 'tool') {
        setMsgs((ms) => [...ms, { id: `t${Date.now()}${Math.random()}`, role: 'tool', content: evt.summary }]);
        // AI 改动了数据（建任务/改状态/写便签），刷新全局任务缓存
        if (!/查询|统计|解析失败/.test(evt.summary)) onTasksChanged?.();
      } else if (evt.type === 'error') {
        message.error(evt.message);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs]);

  const send = async (text0?: string) => {
    const text = (text0 ?? input).trim();
    if (!text || running) return;
    if (!configured) {
      message.warning('请先到「设置 → AI 配置」填写接口地址、Key 和模型');
      return;
    }
    setInput('');
    setRunning(true);
    const aid = `a${Date.now()}`;
    setMsgs((ms) => [
      ...ms,
      { id: `u${Date.now()}`, role: 'user', content: text },
      { id: aid, role: 'assistant', content: '', streaming: true },
    ]);
    try {
      const final = await window.api.aiSend(text);
      setMsgs((ms) => ms.map((m) => (m.id === aid ? { ...m, content: final || m.content, streaming: false } : m)));
      onTasksChanged?.();
    } catch (e) {
      setMsgs((ms) => ms.map((m) => (m.id === aid ? { ...m, content: `⚠️ ${errMsg(e)}`, streaming: false } : m)));
    } finally {
      setRunning(false);
    }
  };

  const clearAll = async () => {
    await window.api.aiClear();
    setMsgs([]);
    message.success('对话已清空');
  };

  return (
    <div className="page ai-page">
      <div className="page-toolbar">
        <span className="t-meta">AI 可以直接帮你：查任务、建任务、改状态/日期、看统计、写便签</span>
        <span className="spacer" />
        <Button icon={<ClearOutlined />} onClick={() => void clearAll()} disabled={running}>
          清空对话
        </Button>
      </div>

      {!configured && (
        <Alert
          type="warning"
          showIcon
          message="还没有配置 AI"
          description="到「设置 → AI 配置」填写 OpenAI 兼容接口（支持 DeepSeek / 通义千问 / Kimi / OpenAI / 本地 Ollama），保存后回来就能对话。"
          style={{ marginBottom: 12 }}
        />
      )}

      <div className="ai-msgs" ref={listRef}>
        {msgs.length === 0 && (
          <div className="ai-welcome">
            <p className="ai-welcome-title">🤖 你好，我是工作台助手</p>
            <p className="t-meta">试试这些：</p>
            <div className="ai-chips">
              {QUICK_PROMPTS.map((p) => (
                <button key={p} className="ai-chip" onClick={() => void send(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="ai-row ai-row-user">
                <div className="ai-bubble ai-bubble-user">{m.content}</div>
              </div>
            );
          }
          if (m.role === 'tool') {
            return (
              <div key={m.id} className="ai-tool">
                🛠 {m.content}
              </div>
            );
          }
          return (
            <div key={m.id} className="ai-row">
              <div className="ai-bubble ai-bubble-assistant">
                {m.content ? (
                  <div className="ai-md" dangerouslySetInnerHTML={{ __html: renderMd(m.content) }} />
                ) : (
                  <span className="t-meta">思考中…</span>
                )}
                {m.streaming && m.content && <span className="ai-cursor">▍</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ai-input">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入需求，Enter 发送（Shift+Enter 换行）"
          autoSize={{ minRows: 1, maxRows: 5 }}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={running}
        />
        {running ? (
          <Tooltip title="停止生成">
            <Button danger icon={<StopOutlined />} onClick={() => void window.api.aiStop()}>
              停止
            </Button>
          </Tooltip>
        ) : (
          <Button type="primary" icon={<SendOutlined />} onClick={() => void send()} disabled={!input.trim()}>
            发送
          </Button>
        )}
      </div>
    </div>
  );
}
