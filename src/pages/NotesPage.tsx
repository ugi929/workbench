import React, { useEffect, useRef, useState } from 'react';
import { App, Button, Empty, Input, Popconfirm } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Note } from '../../shared/types';
import { errMsg } from '../utils';

const COLORS: { key: string; label: string; bg: string; border: string; dot: string }[] = [
  { key: 'yellow', label: '黄', bg: '#fff9b1', border: '#f0e36a', dot: '#fff3a0' },
  { key: 'green', label: '绿', bg: '#d3f2ce', border: '#a8e0a0', dot: '#b7e8ae' },
  { key: 'blue', label: '蓝', bg: '#cde4ff', border: '#9cc8f5', dot: '#b8d8ff' },
  { key: 'pink', label: '粉', bg: '#ffd9e3', border: '#f7aec3', dot: '#ffc2d4' },
];

function NoteCard({ note, onChanged, onDeleted }: { note: Note; onChanged: () => void; onDeleted: () => void }) {
  const { message } = App.useApp();
  const [content, setContent] = useState(note.content);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const colorMeta = COLORS.find((c) => c.key === note.color) ?? COLORS[0];

  // 外部（便签窗口）保存的内容同步进来：仅当本地没有未保存修改时
  useEffect(() => {
    if (!dirty.current) setContent(note.content);
  }, [note.content]);

  const onContentChange = (v: string) => {
    setContent(v);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await window.api.notesUpdate(note.id, { content: v });
        dirty.current = false;
        onChanged();
      } catch (e) {
        message.error(errMsg(e));
      }
    }, 500);
  };

  const changeColor = async (color: string) => {
    try {
      await window.api.notesUpdate(note.id, { color });
      onChanged();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const del = async () => {
    try {
      await window.api.notesDelete(note.id);
      message.success('便签已删除');
      onDeleted();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <div className="mnote-card" style={{ background: colorMeta.bg, borderColor: colorMeta.border }}>
      <div className="mnote-head">
        <span className="mnote-id">便签 #{note.id}</span>
        <span className="mnote-dots">
          {COLORS.map((c) => (
            <button
              key={c.key}
              title={c.label}
              className={`note-color-dot dot-${c.key}${note.color === c.key ? ' active' : ''}`}
              style={{ background: c.dot }}
              onClick={() => void changeColor(c.key)}
            />
          ))}
        </span>
      </div>
      <textarea
        className="mnote-body"
        placeholder="写点什么…（自动保存）"
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
      />
      <div className="mnote-meta">
        <span>创建 {dayjs(note.created_at).format('MM-DD HH:mm')}</span>
        <span>更新 {dayjs(note.updated_at).format('MM-DD HH:mm')}</span>
      </div>
      <div className="mnote-actions">
        <Button type="link" size="small" onClick={() => void window.api.notesOpen(note.id)}>
          打开便签窗口
        </Button>
        <Popconfirm title="删除后无法恢复，确定？" onConfirm={() => void del()}>
          <Button type="link" size="small" danger>
            删除
          </Button>
        </Popconfirm>
      </div>
    </div>
  );
}

export default function NotesPage() {
  const { message } = App.useApp();
  const [notes, setNotes] = useState<Note[]>([]);
  const [keyword, setKeyword] = useState('');

  const load = React.useCallback(async () => {
    try {
      const list = await window.api.notesList();
      setNotes(list.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    } catch (e) {
      message.error(errMsg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const create = async () => {
    try {
      await window.api.notesCreate({});
      await load();
      message.success('已新建便签（窗口已钉到桌面）');
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const toggleAll = async () => {
    await window.api.notesToggleAll();
  };

  const kw = keyword.trim().toLowerCase();
  const filtered = kw ? notes.filter((n) => n.content.toLowerCase().includes(kw)) : notes;

  return (
    <div className="page">
      <div className="page-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索便签内容"
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <span className="t-meta">共 {notes.length} 张 · 卡片内可直接编辑，自动保存并同步到桌面便签</span>
        <span className="spacer" />
        <Button icon={<PlusOutlined />} type="primary" onClick={() => void create()}>
          新建便签
        </Button>
        <Button onClick={() => void toggleAll()}>显示 / 隐藏全部</Button>
      </div>

      {filtered.length === 0 ? (
        <Empty
          description={kw ? '没有匹配的便签' : '还没有便签，点「新建便签」或按 Alt+N 创建'}
          style={{ marginTop: 80 }}
        />
      ) : (
        <div className="notes-grid">
          {filtered.map((n) => (
            <NoteCard key={n.id} note={n} onChanged={() => void load()} onDeleted={() => void load()} />
          ))}
        </div>
      )}
    </div>
  );
}
