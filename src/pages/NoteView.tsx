import React, { useEffect, useRef, useState } from 'react';
import type { Note } from '../../shared/types';
import { errMsg } from '../utils';

const COLORS: { key: string; label: string }[] = [
  { key: 'yellow', label: '黄' },
  { key: 'green', label: '绿' },
  { key: 'blue', label: '蓝' },
  { key: 'pink', label: '粉' },
];

export default function NoteView() {
  const id = Number((window.location.hash.match(/#\/note\/(\d+)/) ?? [])[1]);
  const [note, setNote] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    if (!Number.isFinite(id)) return;
    void window.api
      .notesGet(id)
      .then((n) => {
        setNote(n);
        setContent(n.content);
      })
      .catch(() => {
        // 便签可能已被删除，关闭窗口
        window.close();
      });
  }, [id]);

  const onContentChange = (v: string) => {
    setContent(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void window.api.notesUpdate(id, { content: v }).catch((e) => void errMsg(e));
    }, 400);
  };

  const changeColor = (color: string) => {
    if (!note) return;
    setNote({ ...note, color });
    void window.api.notesUpdate(id, { color }).catch((e) => void errMsg(e));
  };

  if (!Number.isFinite(id)) return null;

  return (
    <div className={`note-root note-${note?.color ?? 'yellow'}`}>
      <div className="note-head">
        <span className="note-drag">便签 #{id}</span>
        <span className="note-head-btns">
          {COLORS.map((c) => (
            <button
              key={c.key}
              className={`note-color-dot dot-${c.key}${note?.color === c.key ? ' active' : ''}`}
              title={c.label}
              onClick={() => changeColor(c.key)}
            />
          ))}
          <button className="note-close" title="隐藏（不删除）" onClick={() => window.close()}>
            ×
          </button>
        </span>
      </div>
      <textarea
        className="note-body"
        placeholder="写点什么…"
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
      />
    </div>
  );
}
