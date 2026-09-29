import React, { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  ColorPicker,
  Input,
  InputNumber,
  Popconfirm,
  Radio,
  Row,
  Slider,
  Space,
  Switch,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FolderOutlined, LinkOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type {
  BackupInfo,
  HotkeyMap,
  PomodoroConfig,
  ThemeMode,
  WidgetStyle,
} from '../../shared/types';
import { errMsg } from '../utils';
import {
  DEFAULT_WIDGET_STYLE,
  WIDGET_BG_PRESETS,
  hexToRgb,
  isBrightBg,
  parseWidgetStyle,
} from '../widgetStyle';

interface Props {
  themeMode: ThemeMode;
  onThemeChange: (dark: boolean) => void;
  onSaved: () => void;
}

const DEFAULT_CONFIG: PomodoroConfig = { focus: 25, short: 5, long: 15, rounds: 4 };

const HOTKEY_ROWS: { key: keyof HotkeyMap; label: string }[] = [
  { key: 'main', label: '显示 / 隐藏主窗口' },
  { key: 'search', label: '快速搜索面板' },
  { key: 'widget', label: '显示 / 隐藏桌面小组件' },
  { key: 'pomodoro', label: '显示 / 隐藏番茄钟小组件' },
  { key: 'note', label: '新建便签' },
  { key: 'launch', label: '快速打开启动项（小组件）' },
];

function HotkeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <Input
      style={{ width: 150, textAlign: 'center', fontFamily: 'monospace' }}
      readOnly
      value={editing ? '按下组合键…' : value}
      onFocus={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        e.preventDefault();
        const key = e.key;
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return;
        const parts: string[] = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        let main: string | null = null;
        if (/^[a-zA-Z0-9]$/.test(key)) main = key.toUpperCase();
        else if (/^F([1-9]|1[0-2])$/.test(key)) main = key;
        if (!main) return;
        parts.push(main);
        onChange(parts.join('+'));
        setEditing(false);
        (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export default function SettingsPage({ themeMode, onThemeChange, onSaved }: Props) {
  const { message } = App.useApp();
  const [config, setConfig] = useState<PomodoroConfig>(DEFAULT_CONFIG);
  const [backupDir, setBackupDir] = useState('');
  const [backupAuto, setBackupAuto] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [hotkeys, setHotkeys] = useState<HotkeyMap>({
    main: 'Alt+Space',
    widget: 'Alt+W',
    note: 'Alt+N',
    search: 'Alt+Q',
    launch: 'Alt+L',
    pomodoro: 'Alt+P',
  });
  const [ai, setAi] = useState<{ baseURL: string; model: string; apiKey: string }>({
    baseURL: '',
    model: '',
    apiKey: '',
  });
  const [aiKeyMask, setAiKeyMask] = useState('');
  const [testing, setTesting] = useState(false);
  const [edgeDock, setEdgeDock] = useState(true);
  const [notesAutoOpen, setNotesAutoOpen] = useState(false);
  const [widgetStyle, setWidgetStyle] = useState<WidgetStyle>(DEFAULT_WIDGET_STYLE);
  // onChangeComplete 里要拿到拖动结束时的最新值，用 ref 避开闭包过期
  const widgetStyleRef = React.useRef(widgetStyle);

  /** 改外观：persist=false 时只更新界面（拖动中），松手再落盘，避免连续写库 */
  const saveWidgetStyle = (patch: Partial<WidgetStyle>, persist: boolean) => {
    const next = { ...widgetStyleRef.current, ...patch };
    widgetStyleRef.current = next;
    setWidgetStyle(next);
    if (!persist) return;
    void window.api.setSetting('widgetBgColor', next.bgColor);
    void window.api.setSetting('widgetBgOpacity', String(Math.round(next.bgOpacity)));
  };

  const loadBackups = React.useCallback(async () => {
    try {
      setBackups(await window.api.backupList());
    } catch (e) {
      message.error(errMsg(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      if (s.pomodoro) {
        try {
          const parsed = JSON.parse(s.pomodoro) as PomodoroConfig;
          if (parsed.focus > 0) setConfig({ ...DEFAULT_CONFIG, ...parsed });
        } catch {
          // 忽略损坏配置
        }
      }
      if (s.backupDir) setBackupDir(s.backupDir);
      setBackupAuto(s.backupAuto === '1');
      setEdgeDock(s.edgeDock !== '0');
      setNotesAutoOpen(s.notesAutoOpen === '1');
      const ws = parseWidgetStyle(s);
      widgetStyleRef.current = ws;
      setWidgetStyle(ws);
    });
    void window.api.hotkeysGet().then(setHotkeys);
    void window.api.aiGetConfig().then((c) => {
      setAi((a) => ({ ...a, baseURL: c.baseURL, model: c.model }));
      setAiKeyMask(c.keyMask);
    });
    void loadBackups();
  }, [loadBackups]);

  const saveHotkeys = async () => {
    try {
      const r = await window.api.hotkeysSet(hotkeys);
      if (r.failed.length) message.warning(`这些热键注册失败（可能被其他软件占用）：${r.failed.join('、')}`);
      else message.success('全局热键已生效');
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const savePomodoro = async () => {
    setSaving(true);
    try {
      await window.api.setSetting('pomodoro', JSON.stringify(config));
      message.success('番茄钟参数已保存');
      onSaved();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const saveBackup = async (dir: string, auto: boolean) => {
    try {
      await window.api.setSetting('backupDir', dir);
      await window.api.setSetting('backupAuto', auto ? '1' : '0');
      message.success('备份设置已保存');
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const doBackupNow = async () => {
    try {
      await window.api.setSetting('backupDir', backupDir);
      await window.api.setSetting('backupAuto', backupAuto ? '1' : '0');
      const r = await window.api.backupNow();
      message.success(`已备份：${r.name}`);
      await loadBackups();
    } catch (e) {
      message.error('备份失败：' + errMsg(e));
    }
  };

  const doRestore = async (name: string) => {
    try {
      await window.api.backupRestore(name);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const columns: ColumnsType<BackupInfo> = [
    { title: '备份文件', dataIndex: 'name', ellipsis: true },
    {
      title: '大小',
      width: 90,
      render: (_, r) => `${(r.size / 1024).toFixed(1)} KB`,
    },
    {
      title: '时间',
      dataIndex: 'mtime',
      width: 150,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      width: 90,
      render: (_, r) => (
        <Popconfirm
          title="用此备份恢复当前数据？"
          description="恢复后应用将自动重启"
          onConfirm={() => void doRestore(r.name)}
        >
          <Button type="link" size="small">
            恢复
          </Button>
        </Popconfirm>
      ),
    },
  ];

  // 小组件外观预览用的配色（与 src/widgetStyle.ts 里 applyWidgetStyle 的规则保持一致）
  const [wR, wG, wB] = hexToRgb(widgetStyle.bgColor);
  const wBright = isBrightBg(widgetStyle.bgColor);
  const wAlpha = widgetStyle.bgOpacity / 100;
  const wFaint = wAlpha < 0.45;
  const prevFg = wBright ? '#2a2e36' : '#e8eaed';
  const prevDim = wBright ? 'rgba(0,0,0,0.48)' : 'rgba(255,255,255,0.58)';
  const prevLine = wBright ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';
  const prevBorder = wFaint
    ? wBright
      ? 'rgba(0,0,0,0.30)'
      : 'rgba(255,255,255,0.28)'
    : wBright
      ? 'rgba(0,0,0,0.12)'
      : 'rgba(255,255,255,0.08)';

  return (
    <div className="page">
      <div className="settings-col">
        <Card size="small" title="外观与窗口">
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Space>
              <span>界面主题</span>
              <Radio.Group
                optionType="button"
                value={themeMode}
                onChange={(e) => onThemeChange(e.target.value === 'dark')}
                options={[
                  { value: 'light', label: '☀️ 浅色' },
                  { value: 'dark', label: '🌙 深色' },
                ]}
              />
            </Space>
            <Space>
              <span>贴边自动折叠</span>
              <Switch
                checked={edgeDock}
                onChange={(v) => {
                  setEdgeDock(v);
                  void window.api.setSetting('edgeDock', v ? '1' : '0');
                  onSaved();
                }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                主窗口拖到屏幕左/右/上边缘松手后自动收起，只留一条窄边，鼠标移上去即展开
              </Typography.Text>
            </Space>
            <Space>
              <span>启动时自动打开便签</span>
              <Switch
                checked={notesAutoOpen}
                onChange={(v) => {
                  setNotesAutoOpen(v);
                  void window.api.setSetting('notesAutoOpen', v ? '1' : '0');
                  message.success(v ? '下次启动会弹出全部便签' : '下次启动不再自动弹出便签');
                }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                关闭时不占内存；需要时用托盘菜单「便签」或 Alt+N 随时打开
              </Typography.Text>
            </Space>
          </Space>
        </Card>

        <Card size="small" title="桌面小组件">
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Space wrap>
              <span>背景颜色</span>
              <span className="wsp-swatches">
                {WIDGET_BG_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`wsp-swatch${widgetStyle.bgColor === p.value ? ' is-on' : ''}`}
                    style={{ background: p.value }}
                    title={`${p.label} ${p.value}`}
                    onClick={() => saveWidgetStyle({ bgColor: p.value }, true)}
                  />
                ))}
              </span>
              <ColorPicker
                value={widgetStyle.bgColor}
                format="hex"
                disabledAlpha
                size="small"
                onChangeComplete={(c) => saveWidgetStyle({ bgColor: c.toHexString() }, true)}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {widgetStyle.bgColor}
              </Typography.Text>
            </Space>

            <Space>
              <span>背景不透明度</span>
              <Slider
                style={{ width: 190 }}
                min={0}
                max={100}
                value={widgetStyle.bgOpacity}
                onChange={(v) => saveWidgetStyle({ bgOpacity: v }, false)}
                onChangeComplete={(v) => saveWidgetStyle({ bgOpacity: v }, true)}
                tooltip={{ formatter: (v) => `${v}%` }}
              />
              <Typography.Text style={{ width: 42 }}>{widgetStyle.bgOpacity}%</Typography.Text>
            </Space>

            <Space align="start" size={12}>
              <div className="wsp-preview">
                <div
                  className="wsp-preview-card"
                  style={{
                    background: `rgba(${wR}, ${wG}, ${wB}, ${wAlpha})`,
                    color: prevFg,
                    borderColor: prevBorder,
                  }}
                >
                  <div className="wsp-preview-head" style={{ borderColor: prevLine }}>
                    <span>快捷启动</span>
                    <span style={{ color: prevDim }}>设置 / 关闭</span>
                  </div>
                  <div className="wsp-preview-body">
                    <span className="wsp-preview-icon" style={{ background: '#4c6ef5' }}>
                      <LinkOutlined />
                    </span>
                    <span className="wsp-preview-icon" style={{ background: '#faad14' }}>
                      <FolderOutlined />
                    </span>
                  </div>
                  <div
                    className="wsp-preview-foot"
                    style={{ borderColor: prevLine, color: prevDim }}
                  >
                    <span>共 3 个启动项</span>
                    <span>点击即打开</span>
                  </div>
                </div>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12, maxWidth: 330 }}>
                同时作用于「启动项小组件（Alt+L）」和「任务小组件（Alt+W）」，改完即时生效、不用重开窗口。
                文字与描边颜色会按背景亮度
                <Typography.Text strong style={{ fontSize: 12 }}>
                  自动切换深浅
                </Typography.Text>
                ，选浅色背景也不会看不清。
              </Typography.Text>
            </Space>
          </Space>
        </Card>

        <Card size="small" title="AI 配置（OpenAI 兼容接口）">
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Space wrap>
              <span className="t-meta">快速填入：</span>
              {(
                [
                  { label: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
                  { label: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
                  { label: 'Kimi', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
                  { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
                  { label: '本地 Ollama', baseURL: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
                ] as const
              ).map((p) => (
                <Button
                  key={p.label}
                  size="small"
                  onClick={() => {
                    setAi({ ...ai, baseURL: p.baseURL, model: p.model });
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </Space>
            <Row gutter={12}>
              <Col span={10}>
                <Typography.Text type="secondary">接口地址（BaseURL）</Typography.Text>
                <Input
                  placeholder="https://api.deepseek.com"
                  value={ai.baseURL}
                  onChange={(e) => setAi({ ...ai, baseURL: e.target.value })}
                />
              </Col>
              <Col span={7}>
                <Typography.Text type="secondary">模型</Typography.Text>
                <Input
                  placeholder="deepseek-chat"
                  value={ai.model}
                  onChange={(e) => setAi({ ...ai, model: e.target.value })}
                />
              </Col>
              <Col span={7}>
                <Typography.Text type="secondary">
                  API Key{aiKeyMask ? `（已保存 ${aiKeyMask}）` : ''}
                </Typography.Text>
                <Input.Password
                  placeholder={aiKeyMask ? '留空则保持不变' : 'sk-...'}
                  value={ai.apiKey}
                  onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
                  autoComplete="new-password"
                />
              </Col>
            </Row>
            <Space>
              <Button
                type="primary"
                onClick={() =>
                  void window.api
                    .aiSetConfig({
                      baseURL: ai.baseURL,
                      model: ai.model,
                      ...(ai.apiKey.trim() ? { apiKey: ai.apiKey.trim() } : {}),
                    })
                    .then((c) => {
                      setAiKeyMask(c.keyMask);
                      setAi({ baseURL: c.baseURL, model: c.model, apiKey: '' });
                      message.success('AI 配置已保存（Key 使用系统凭据加密存储）');
                    })
                    .catch((e) => message.error(errMsg(e)))
                }
              >
                保存配置
              </Button>
              <Button
                loading={testing}
                onClick={() =>
                  void window.api
                    .aiTest({
                      baseURL: ai.baseURL,
                      model: ai.model,
                      ...(ai.apiKey.trim() ? { apiKey: ai.apiKey.trim() } : {}),
                    })
                    .then((r) => message.success(r))
                    .catch((e) => message.error(errMsg(e)))
                }
              >
                测试连接
              </Button>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Key 只保存在本机（Windows 凭据加密），对话时由应用直连你填的接口。配置后 AI
              可以帮你查/建/改任务、看统计、写便签，并自动撰写报告总结。
            </Typography.Text>
          </Space>
        </Card>

        <Card size="small" title="全局热键">
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            {HOTKEY_ROWS.map((row) => (
              <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 180 }}>{row.label}</span>
                <HotkeyInput value={hotkeys[row.key]} onChange={(v) => setHotkeys((h) => ({ ...h, [row.key]: v }))} />
              </div>
            ))}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              点击输入框后直接按下组合键（需含 Alt/Ctrl/Shift），支持字母、数字和 F1-F12。全局热键在任何界面都会生效。
            </Typography.Text>
            <Button type="primary" onClick={() => void saveHotkeys()}>
              保存热键
            </Button>
          </Space>
        </Card>

        <Card size="small" title="番茄钟参数">
          <Row gutter={12}>
            <Col span={6}>
              <Typography.Text type="secondary">专注时长（分钟）</Typography.Text>
              <InputNumber
                min={1}
                max={120}
                style={{ width: '100%' }}
                value={config.focus}
                onChange={(v) => setConfig((c) => ({ ...c, focus: v ?? 25 }))}
              />
            </Col>
            <Col span={6}>
              <Typography.Text type="secondary">短休息（分钟）</Typography.Text>
              <InputNumber
                min={1}
                max={30}
                style={{ width: '100%' }}
                value={config.short}
                onChange={(v) => setConfig((c) => ({ ...c, short: v ?? 5 }))}
              />
            </Col>
            <Col span={6}>
              <Typography.Text type="secondary">长休息（分钟）</Typography.Text>
              <InputNumber
                min={5}
                max={60}
                style={{ width: '100%' }}
                value={config.long}
                onChange={(v) => setConfig((c) => ({ ...c, long: v ?? 15 }))}
              />
            </Col>
            <Col span={6}>
              <Typography.Text type="secondary">几轮后长休息</Typography.Text>
              <InputNumber
                min={2}
                max={10}
                style={{ width: '100%' }}
                value={config.rounds}
                onChange={(v) => setConfig((c) => ({ ...c, rounds: v ?? 4 }))}
              />
            </Col>
          </Row>
          <div style={{ marginTop: 12 }}>
            <Button type="primary" loading={saving} onClick={() => void savePomodoro()}>
              保存参数
            </Button>
          </div>
        </Card>

        <Card size="small" title="数据备份（可指向 NAS 共享目录）">
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              备份目录可以填本机路径，也可以填映射好的 NAS 网络盘（如 Z:\Backups）或 UNC 路径（如 \\NAS\share\workbench）。
              数据库文件每次变更都会自动落盘，「立即备份」会额外生成一份带时间戳的快照，自动保留最近 10 份。
            </Typography.Text>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="备份目录，留空则使用数据目录下的 backups 文件夹"
                value={backupDir}
                onChange={(e) => setBackupDir(e.target.value)}
              />
              <Button onClick={() => void saveBackup(backupDir, backupAuto)}>保存目录</Button>
            </Space.Compact>
            <Space>
              <span>
                每天自动备份 <Switch checked={backupAuto} onChange={(v) => { setBackupAuto(v); void saveBackup(backupDir, v); }} />
              </span>
              <Button type="primary" onClick={() => void doBackupNow()}>
                立即备份
              </Button>
              <Button onClick={() => void window.api.backupOpenDir()}>打开备份目录</Button>
            </Space>
            <Table
              rowKey="name"
              size="small"
              columns={columns}
              dataSource={backups}
              pagination={false}
              locale={{ emptyText: '还没有备份' }}
            />
          </Space>
        </Card>
      </div>
    </div>
  );
}
