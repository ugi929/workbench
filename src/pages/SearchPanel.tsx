import React, { useEffect, useState } from 'react';
import type { Clip, LaunchItem, Note, Task } from '../../shared/types';
import { ACTIVE_STATUSES, errMsg } from '../utils';

interface SearchItem {
  key: string;
  kind: 'task' | 'note' | 'launch' | 'clip' | 'command';
  title: string;
  sub: string;
  run: () => Promise<void>;
}

const KIND_LABEL: Record<SearchItem['kind'], string> = {
  command: '命令',
  task: '任务',
  note: '便签',
  launch: '启动',
  clip: '剪贴板',
};

export default function SearchPanel() {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [items, setItems] = useState<SearchItem[]>([]);

  const hide = () => window.close();

  const build = React.useCallback(async () => {
    const query = q.trim().toLowerCase();
    const out: SearchItem[] = [];
    try {
      const [tasks, notes, launches, clips] = await Promise.all([
        window.api.listTasks(),
        window.api.notesList(),
        window.api.launchList(),
        window.api.clipsList(),
      ]);
      const rest = q.trim().replace(/^(新建任务|新建|任务)[：:]?/, '').trim();
      if (/^(新建任务|新建|任务)[：:]/.test(q.trim()) && rest) {
        out.push({
          key: 'cmd',
          kind: 'command',
          title: `新建任务「${rest}」`,
          sub: '回车立即创建',
          run: async () => {
            await window.api.createTask({ title: rest });
            void window.api.notify('已创建任务', rest);
          },
        });
      }
      const match = (s: string) => !query || s.toLowerCase().includes(query);
      for (const t of tasks.filter((t) => match(t.title) && ACTIVE_STATUSES.includes(t.status)).slice(0, 5)) {
        out.push({
          key: `t${t.id}`,
          kind: 'task',
          title: t.title,
          sub: `任务 · ${t.status === 'done' ? '' : ''}${t.due_date ? `截止 ${t.due_date}` : '无截止'}`,
          run: async () => {
            await window.api.showMain('tasks');
          },
        });
      }
      for (const n of (notes as Note[]).filter((n) => match(n.content)).slice(0, 4)) {
        out.push({
          key: `n${n.id}`,
          kind: 'note',
          title: n.content.split('\n')[0] || '空白便签',
          sub: '便签 · 打开窗口',
          run: async () => {
            await window.api.notesOpen(n.id);
          },
        });
      }
      for (const l of (launches as LaunchItem[]).filter((l) => match(l.name) || match(l.target)).slice(0, 4)) {
        out.push({
          key: `l${l.id}`,
          kind: 'launch',
          title: l.name,
          sub: `启动 · ${l.target}`,
          run: async () => {
            const err = await window.api.launchOpen(l.id);
            if (err) void window.api.notify('打开失败', err);
          },
        });
      }
      for (const c of (clips as Clip[]).filter((c) => c.type === 'text' && match(c.content)).slice(0, 4)) {
        out.push({
          key: `c${c.id}`,
          kind: 'clip',
          title: c.content.slice(0, 60),
          sub: '剪贴板 · 复制回剪贴板',
          run: async () => {
            await window.api.clipsCopy(c.id);
          },
        });
      }
    } catch (e) {
      void errMsg(e);
    }
    setItems(out.slice(0, 12));
    setSel(0);
  }, [q]);

  useEffect(() => {
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    setQ('');
    void build();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void build();
  }, [build]);

  useEffect(() => {
    const onFocus = () => {
      setQ('');
      void build();
      (document.querySelector('.search-input input') as HTMLInputElement | null)?.focus();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [build]);

  const runItem = async (idx: number) => {
    const item = items[idx];
    if (!item) return;
    try {
      await item.run();
    } catch (e) {
      void window.api.notify('执行失败', errMsg(e));
    }
    hide();
  };

  return (
    <div className="search-root">
      <div className="search-box">
        <input
          className="search-input"
          autoFocus
          placeholder="搜索任务 / 便签 / 启动项 / 剪贴板，或输入「新建任务：xxx」"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(items.length - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              void runItem(sel);
            } else if (e.key === 'Escape') {
              hide();
            }
          }}
        />
        <div className="search-list">
          {items.length === 0 && <div className="search-empty">没有匹配结果</div>}
          {items.map((it, idx) => (
            <div
              key={it.key}
              className={`search-item${idx === sel ? ' active' : ''}`}
              onMouseEnter={() => setSel(idx)}
              onClick={() => void runItem(idx)}
            >
              <span className={`search-kind kind-${it.kind}`}>{KIND_LABEL[it.kind]}</span>
              <span className="search-item-title">{it.title}</span>
              <span className="search-item-sub">{it.sub}</span>
            </div>
          ))}
        </div>
        <div className="search-foot">↑↓ 选择 · Enter 执行 · Esc 关闭</div>
      </div>
    </div>
  );
}
