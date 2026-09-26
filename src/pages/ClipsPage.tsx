import React, { useEffect, useState } from 'react';
import { App, Button, Empty, Input, Popconfirm, Switch, Tag, Tooltip } from 'antd';
import { ClearOutlined, FileImageOutlined, PushpinFilled, PushpinOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Clip } from '../../shared/types';
import { errMsg } from '../utils';

function ClipThumb({ clip }: { clip: Clip }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    void window.api.clipsImageData(clip.id).then(setSrc);
  }, [clip.id]);
  if (!src) return <FileImageOutlined style={{ fontSize: 26, opacity: 0.5 }} />;
  return <img src={src} alt="clip" style={{ maxHeight: 44, maxWidth: 72, borderRadius: 4, objectFit: 'cover' }} />;
}

export default function ClipsPage() {
  const { message } = App.useApp();
  const [clips, setClips] = useState<Clip[]>([]);
  const [keyword, setKeyword] = useState('');
  const [watch, setWatch] = useState(true);

  const load = React.useCallback(async (kw = '') => {
    try {
      setClips(await window.api.clipsList(kw));
    } catch (e) {
      message.error(errMsg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void window.api.clipsWatchStatus().then(setWatch);
    void load();
    const t = setInterval(() => void load(keyword), 3000);
    return () => clearInterval(t);
  }, [load, keyword]);

  const copy = async (c: Clip) => {
    try {
      await window.api.clipsCopy(c.id);
      message.success('已复制到剪贴板');
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const pin = async (c: Clip) => {
    await window.api.clipsPin(c.id, c.pinned ? 0 : 1);
    await load(keyword);
  };

  const del = async (id: number) => {
    await window.api.clipsDelete(id);
    await load(keyword);
  };

  const toggleWatch = async (v: boolean) => {
    await window.api.clipsSetWatch(v);
    setWatch(v);
    message.success(v ? '已开启自动记录' : '已暂停自动记录（不再保存新的剪贴板内容）');
  };

  return (
    <div className="page">
      <div className="page-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索剪贴板文本"
          style={{ width: 260 }}
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            void load(e.target.value);
          }}
        />
        <span className="t-meta">复制过的文本和图片会自动记录在本机，可在任意设备面板中一键回贴</span>
        <span className="spacer" />
        <span className="t-meta">自动记录</span>
        <Switch checked={watch} onChange={(v) => void toggleWatch(v)} />
        <Popconfirm title="清空全部历史（含置顶）？" onConfirm={() => void window.api.clipsClear().then(() => load(keyword))}>
          <Button icon={<ClearOutlined />} danger>
            清空
          </Button>
        </Popconfirm>
      </div>

      {clips.length === 0 && (
        <Empty description="还没有记录：复制任意文本或截图试试（自动记录开启时）" style={{ marginTop: 80 }} />
      )}

      <div className="clip-list">
        {clips.map((c) => (
          <div key={c.id} className="clip-item" onDoubleClick={() => void copy(c)}>
            <span className="clip-type">{c.type === 'image' ? <ClipThumb clip={c} /> : <Tag>文本</Tag>}</span>
            <div className="clip-content">
              {c.type === 'image' ? c.content : c.content.length > 300 ? `${c.content.slice(0, 300)}…` : c.content}
            </div>
            <span className="clip-time">{dayjs(c.created_at).format('MM-DD HH:mm')}</span>
            <span className="clip-actions">
              <Tooltip title={c.pinned ? '取消置顶' : '置顶'}>
                <Button
                  type="text"
                  size="small"
                  icon={c.pinned ? <PushpinFilled style={{ color: '#faad14' }} /> : <PushpinOutlined />}
                  onClick={() => void pin(c)}
                />
              </Tooltip>
              <Button type="link" size="small" onClick={() => void copy(c)}>
                复制
              </Button>
              <Popconfirm title="删除这条记录？" onConfirm={() => void del(c.id)}>
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
