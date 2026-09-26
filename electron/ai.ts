import { safeStorage } from 'electron';
import { all, kvGet, kvSet, lastInsertId, run } from './db';
import * as tasks from './tasks';
import * as pomodoro from './pomodoro';
import * as notes from './notes';
import dayjs from 'dayjs';
import type { AiEvent } from '../shared/types';

export interface AiConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: {
    id: string;
    type: 'tool';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  name: string;
  args: string;
}

let activeAbort: AbortController | null = null;

/**
 * 单次 AI 请求的兜底超时（毫秒）。
 * 必须有：postChat 里的 fetch 本身**不带超时**，服务商一旦接了连接却不返回
 * （限流排队、网关挂住、模型卡住），这条 await 会永远不返回，
 * 于是调用方（报告生成）永远不落库、UI 永远停在 loading。
 * 交互式对话给得宽裕一些，报告这类后台任务用更短的独立超时。
 */
const DEFAULT_AI_TIMEOUT_MS = 180_000;

// ---------- 配置 ----------

export function getAiConfig(): AiConfig {
  const raw = kvGet('aiConfig');
  const cfg: AiConfig = { baseURL: '', apiKey: '', model: '' };
  if (!raw) return cfg;
  try {
    const saved = JSON.parse(raw) as { baseURL?: string; keyEnc?: string; keyPlain?: string; model?: string };
    cfg.baseURL = saved.baseURL ?? '';
    cfg.model = saved.model ?? '';
    if (saved.keyEnc && safeStorage.isEncryptionAvailable()) {
      cfg.apiKey = safeStorage.decryptString(Buffer.from(saved.keyEnc, 'base64'));
    } else if (saved.keyPlain) {
      cfg.apiKey = saved.keyPlain;
    }
  } catch {
    // 配置损坏时返回空配置
  }
  return cfg;
}

export function setAiConfig(input: { baseURL: string; model: string; apiKey?: string }): AiConfig {
  const prev = getAiConfig();
  const next: AiConfig = {
    baseURL: (input.baseURL ?? prev.baseURL).trim().replace(/\/+$/, ''),
    model: (input.model ?? prev.model).trim(),
    apiKey: input.apiKey && input.apiKey.trim() ? input.apiKey.trim() : prev.apiKey,
  };
  const payload: Record<string, string> = { baseURL: next.baseURL, model: next.model };
  if (next.apiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      payload.keyEnc = safeStorage.encryptString(next.apiKey).toString('base64');
    } else {
      payload.keyPlain = next.apiKey;
    }
  }
  kvSet('aiConfig', JSON.stringify(payload));
  return next;
}

export function getAiConfigPublic() {
  const cfg = getAiConfig();
  return {
    baseURL: cfg.baseURL,
    model: cfg.model,
    hasKey: Boolean(cfg.apiKey),
    keyMask: cfg.apiKey ? `${cfg.apiKey.slice(0, 3)}****${cfg.apiKey.slice(-4)}` : '',
  };
}

export function isConfigured(): boolean {
  const cfg = getAiConfig();
  return Boolean(cfg.baseURL && cfg.model && cfg.apiKey);
}

export async function testConnection(input: { baseURL: string; model: string; apiKey?: string }): Promise<string> {
  const merged = { ...getAiConfig(), ...input };
  const baseURL = (merged.baseURL || '').trim().replace(/\/+$/, '');
  if (!baseURL || !merged.model) throw new Error('请先填写接口地址和模型');
  const res = await postChat(
    { ...merged, baseURL },
    { model: merged.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 4, stream: false },
    {},
  );
  return '连接成功';
}

// ---------- 对话 ----------

function endpoint(cfg: AiConfig, path: string): string {
  const base = cfg.baseURL.replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}${path}` : `${base}/v1${path}`;
}

function friendlyHttpError(status: number, body: string): string {
  const brief = body.replace(/\s+/g, ' ').slice(0, 200);
  if (status === 401) return `认证失败（401）：API Key 无效或未授权。${brief}`;
  if (status === 403) return `无权限（403）：Key 可能没有该模型的访问权限。${brief}`;
  if (status === 404) return `接口不存在（404）：请检查 BaseURL 和模型名。${brief}`;
  if (status === 429) return `触发限流（429）：超出服务商每分钟请求/Token 配额，多次自动重试后仍失败，请稍后再试或检查套餐限额。${brief}`;
  if (status >= 500) return `服务商暂时故障（${status}）。${brief}`;
  return `AI 接口返回 HTTP ${status}：${brief}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        const err = new Error('已停止');
        err.name = 'AbortError';
        reject(err);
      },
      { once: true },
    );
  });
}

// POST /chat/completions，对 429/5xx/网络抖动自动重试（指数退避 + Retry-After）
async function postChat(
  cfg: AiConfig,
  body: unknown,
  opts: { signal?: AbortSignal; onInfo?: (m: string) => void },
): Promise<Response> {
  const delays = [1500, 3000, 6000];
  const maxAttempt = delays.length;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(endpoint(cfg, '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (err) {
      if (opts.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) throw err;
      if (attempt >= maxAttempt) throw new Error(`网络请求失败：${err instanceof Error ? err.message : String(err)}`);
      opts.onInfo?.(`网络请求失败，${delays[attempt] / 1000} 秒后自动重试（第 ${attempt + 1}/${maxAttempt} 次）…`);
      await sleep(delays[attempt], opts.signal);
      continue;
    }
    if (res.ok) return res;
    const bodyText = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxAttempt) throw new Error(friendlyHttpError(res.status, bodyText));
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 60 ? retryAfter * 1000 : delays[attempt];
    opts.onInfo?.(
      `触发限流（${res.status}），${Math.round(wait / 1000)} 秒后自动重试（第 ${attempt + 1}/${maxAttempt} 次）…`,
    );
    await sleep(wait, opts.signal);
  }
}

interface ChatStreamOpts {
  messages: ChatMessage[];
  tools?: unknown[];
  /** 本次请求的超时（毫秒），默认 DEFAULT_AI_TIMEOUT_MS */
  timeoutMs?: number;
  /**
   * 独立请求：不占用全局 activeAbort。
   * 对话页的「停止」按钮（stopAgent）只会中断它自己发起的请求，
   * 后台任务（如报告生成）用 standalone，既不会被误伤，也不会互相覆盖。
   */
  standalone?: boolean;
}

async function chatStream(
  opts: ChatStreamOpts,
  onDelta?: (t: string) => void,
  onInfo?: (m: string) => void,
): Promise<ChatMessage> {
  const ac = new AbortController();
  if (!opts.standalone) activeAbort = ac;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);
  try {
    return await chatStreamInner(opts, ac.signal, onDelta, onInfo);
  } catch (err) {
    // 超时是靠 abort 打断 fetch/读流实现的，报错会是 AbortError，
    // 这里统一翻译成看得懂的原因（否则调用方只能看到 "This operation was aborted"）。
    if (timedOut) {
      throw new Error(`AI 请求超时：${Math.round(timeoutMs / 1000)} 秒内没有返回，已放弃等待`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (activeAbort === ac) activeAbort = null;
  }
}

async function chatStreamInner(
  opts: { messages: ChatMessage[]; tools?: unknown[] },
  signal: AbortSignal,
  onDelta?: (t: string) => void,
  onInfo?: (m: string) => void,
): Promise<ChatMessage> {
  const cfg = getAiConfig();
  if (!cfg.baseURL || !cfg.model) throw new Error('请先在设置中配置 AI 接口');
  const res = await postChat(
    cfg,
    {
      model: cfg.model,
      messages: opts.messages,
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      stream: true,
    },
    { signal, onInfo },
  );

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI 接口返回 HTTP ${res.status}：${body.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  const toolCalls: (ToolCall | null)[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const j = JSON.parse(data) as {
          choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        };
        const delta = j.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          onDelta?.(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) toolCalls[idx] = { id: '', name: '', args: '' };
            const slot = toolCalls[idx]!;
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
        }
      } catch {
        // 非 JSON 行（注释/心跳）忽略
      }
    }
  }
  return {
    role: 'assistant',
    content,
    tool_calls: toolCalls
      .filter((t): t is ToolCall => Boolean(t && t.name))
      .map((t) => ({
        id: t.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        type: 'tool' as const,
        function: { name: t.name, arguments: t.args || '{}' },
      })),
  };
}

// ---------- 工具 ----------

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: '查询任务列表。scope=today 今天截止、overdue 已逾期、week 本周截止、all 全部；可用 keyword 过滤标题',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['today', 'overdue', 'week', 'all'] },
          keyword: { type: 'string' },
        },
        required: ['scope'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description:
        '创建任务。日期字段只接受 YYYY-MM-DD（系统不单独存时间）；若用户提到具体时间（如"10点"），把时间附在标题末尾（例：标题「与供应商开会 10:00」）',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          importance: { type: 'string', enum: ['high', 'medium', 'low'] },
          urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
          start_date: { type: 'string' },
          due_date: { type: 'string' },
          project: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: '更新任务：修改状态（todo/in_progress/done/cancelled/paused）、日期、进度等。先用 list_tasks 查 id',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'cancelled', 'paused'] },
          title: { type: 'string' },
          due_date: { type: 'string' },
          start_date: { type: 'string' },
          progress: { type: 'integer' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stats',
      description: '获取工作统计：今日/本周完成任务数、逾期数、专注分钟数',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: '新建一张桌面便签',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string' } },
        required: ['content'],
      },
    },
  },
];

async function executeTool(name: string, args: Record<string, unknown>, send: (e: AiEvent) => void): Promise<unknown> {
  let result: unknown;
  let summary = '';
  switch (name) {
    case 'list_tasks': {
      const scope = String(args.scope ?? 'all');
      const keyword = String(args.keyword ?? '').trim();
      let list = tasks.listTasks();
      const today = dayjs().format('YYYY-MM-DD');
      const weekEnd = dayjs().endOf('week').format('YYYY-MM-DD');
      if (scope === 'today') list = list.filter((t) => t.due_date === today);
      else if (scope === 'overdue') list = list.filter((t) => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled');
      else if (scope === 'week') list = list.filter((t) => t.due_date && t.due_date >= today && t.due_date <= weekEnd);
      if (keyword) list = list.filter((t) => t.title.includes(keyword));
      result = list.slice(0, 30).map((t) => ({ id: t.id, title: t.title, status: t.status, due: t.due_date, project: t.project }));
      summary = `查询任务（${scope}${keyword ? ` · ${keyword}` : ''}）→ ${Array.isArray(result) ? result.length : 0} 条`;
      break;
    }
    case 'create_task': {
      if (!String(args.title ?? '').trim()) {
        return { error: '缺少 title 参数，请重试并提供任务名称' };
      }
      const t = tasks.createTask({
        title: String(args.title ?? '未命名任务'),
        description: args.description ? String(args.description) : '',
        importance: (args.importance as 'high' | 'medium' | 'low') ?? 'medium',
        urgency: (args.urgency as 'high' | 'medium' | 'low') ?? 'medium',
        start_date: args.start_date ? String(args.start_date) : null,
        due_date: args.due_date ? String(args.due_date) : null,
        project: args.project ? String(args.project) : '',
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
      });
      result = { ok: true, id: t.id, title: t.title, due: t.due_date };
      summary = `已创建任务「${t.title}」${t.due_date ? `（截止 ${t.due_date}）` : ''}`;
      break;
    }
    case 'update_task': {
      const patch: Record<string, unknown> = {};
      for (const k of ['status', 'title', 'due_date', 'start_date', 'progress'] as const) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      const t = tasks.updateTask(Number(args.id), patch);
      result = { ok: true, id: t.id, title: t.title, status: t.status, due: t.due_date };
      summary = `已更新任务「${t.title}」`;
      break;
    }
    case 'get_stats': {
      const s = tasks.dashboardStats();
      const p = pomodoro.stats();
      result = {
        doneThisWeek: s.doneThisWeek,
        overdue: s.overdue.length,
        todayDue: s.todayDue.length,
        focusMinutesToday: s.focusMinutesToday,
        focusMinutesThisWeek: p.weekMinutes,
      };
      summary = '查询了工作统计';
      break;
    }
    case 'add_note': {
      const n = notes.createNote({ content: String(args.content ?? '') });
      notes.openNote(n.id);
      result = { ok: true, id: n.id };
      summary = '已新建桌面便签';
      break;
    }
    default:
      result = { error: `未知工具 ${name}` };
      summary = `调用了未知工具 ${name}`;
  }
  send({ type: 'tool', name, summary });
  return result;
}

// ---------- 消息存取与 Agent 循环 ----------

function saveMessage(role: 'user' | 'assistant', content: string): void {
  run('INSERT INTO ai_messages (role, content, created_at) VALUES (?, ?, ?)', [
    role,
    content,
    dayjs().format('YYYY-MM-DD HH:mm:ss'),
  ]);
}

export function listMessages(limit = 50): { id: number; role: string; content: string; created_at: string }[] {
  return all<{ id: number; role: string; content: string; created_at: string }>(
    'SELECT id, role, content, created_at FROM ai_messages ORDER BY id DESC LIMIT ?',
    [limit],
  ).reverse();
}

export function clearMessages(): void {
  run('DELETE FROM ai_messages');
}

function systemPrompt(): string {
  return [
    '你是「工作台」应用内的效率助手，用中文回答，风格简洁。',
    `今天是 ${dayjs().format('YYYY年M月D日 dddd')}。`,
    '用户可以让你：查询/创建/更新任务、查询统计、新建桌面便签。创建或改期任务时，把"明天/下周三/本周末"等相对日期换算成 YYYY-MM-DD 再调用工具；把"重要/紧急"映射为重要度/紧急度（高/中/低）。',
    '执行完工具后，用一句话汇报结果；不要编造数据。',
  ].join('\n');
}

export async function runAgent(userText: string, send: (e: AiEvent) => void): Promise<string> {
  if (!isConfigured()) throw new Error('请先在设置中配置 AI 接口（BaseURL / Key / 模型）');
  const history: ChatMessage[] = listMessages(20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  const msgs: ChatMessage[] = [
    { role: 'system', content: systemPrompt() },
    ...history,
    { role: 'user', content: userText },
  ];
  let finalText = '';
  for (let round = 0; round < 6; round++) {
    const resp = await chatStream(
      { messages: msgs, tools: TOOLS },
      (t) => send({ type: 'delta', text: t }),
      (m) => send({ type: 'tool', name: 'retry', summary: m }),
    );
    if (resp.tool_calls?.length) {
      msgs.push(resp);
      for (const tc of resp.tool_calls) {
        let args: Record<string, unknown> = {};
        let parseError = false;
        try {
          args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          parseError = true;
        }
        let result: unknown;
        if (parseError) {
          result = { error: '工具参数不是合法 JSON，请修正后重新调用' };
          send({ type: 'tool', name: tc.function.name, summary: '参数解析失败，已要求模型重试' });
        } else {
          result = await executeTool(tc.function.name, args, send);
        }
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 4000) });
      }
      continue;
    }
    finalText = resp.content || '(模型没有返回内容)';
    break;
  }
  saveMessage('user', userText);
  saveMessage('assistant', finalText);
  return finalText;
}

/**
 * 单轮纯文本生成：**不带工具、不带聊天历史、不写 ai_messages**。
 *
 * 报告这类「把给定数据写成一篇 Markdown」的任务必须用它，而不是 runAgent：
 *   ① runAgent 会把「任务助手」的人设 + 最近 20 条聊天记录一起喂进去，
 *      模型很容易答非所问 —— 实测库里就有：用户问「可以写月报吗」，
 *      助手回答「我目前不能直接写月报，我的能力只限于查询/创建/更新任务」；
 *   ② runAgent 是 6 轮工具循环，报告并不需要工具，白白叠加网络往返（慢、易挂）；
 *   ③ runAgent 会把提示词和生成结果写回 ai_messages，报告提示词（一大段 JSON）
 *      因此沉淀进聊天历史，下一轮对话/下一份报告的上下文越来越大 —— 恶性累积。
 */
export async function writeMarkdown(
  prompt: string,
  opts?: { timeoutMs?: number; system?: string },
): Promise<string> {
  if (!isConfigured()) throw new Error('请先在设置中配置 AI 接口（BaseURL / Key / 模型）');
  const messages: ChatMessage[] = [];
  if (opts?.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: prompt });
  const resp = await chatStream({ messages, timeoutMs: opts?.timeoutMs, standalone: true });
  const text = (resp.content ?? '').trim();
  if (!text) throw new Error('AI 没有返回内容');
  return text;
}

export function stopAgent(): void {
  activeAbort?.abort();
}

export function lastMessageId(): number {
  return lastInsertId();
}
