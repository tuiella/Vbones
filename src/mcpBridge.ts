import { executeMcpCommand } from './commands';
import { status, whenIdle } from './store';

const DEFAULT_PORT = 3210;
let socket: WebSocket | null = null;
let stopped = false;
let retryTimer: number | null = null;

function enabled() {
  const q = new URLSearchParams(location.search);
  return q.get('mcp') === '1' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

function scheduleReconnect() {
  if (stopped || retryTimer != null) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void connect();
  }, 1500);
}

const TOKEN_PATH = '/__vbones_mcp_token';
let connecting = false;

/**
 * mcp/server.mjs writes {token, port} once its bridge is listening; only our own dev server serves it
 * (same-origin), so the browser always connects to the port the server actually uses.
 */
async function fetchBridgeInfo(): Promise<{ token: string; port: number } | null> {
  try {
    const r = await fetch(TOKEN_PATH, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = JSON.parse(await r.text());
    const token = String(j?.token ?? '');
    const port = Number(j?.port ?? DEFAULT_PORT);
    if (!/^[a-f0-9]{32,128}$/.test(token) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { token, port };
  } catch {
    return null;
  }
}

// Commands run one at a time, in arrival order, so e.g. autoRig never sees the doc before an import commits.
let queue: Promise<void> = Promise.resolve();
const cancelled = new Set<string>();

async function run(ws: WebSocket, req: any) {
  const id = String(req.id);
  const reply = (msg: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'response', id, ...msg }));
  };
  try {
    // don't commit into the middle of a user drag (it shares the gesture's undo step and gets overwritten)
    await whenIdle();
    if (cancelled.has(id)) throw new Error('Cancelled: the MCP request timed out before it ran');
    const result = await executeMcpCommand(String(req.method), req.params ?? {}, { cancelled: () => cancelled.has(id) });
    reply({ ok: true, result });
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    cancelled.delete(id);
  }
}

async function connect() {
  if (stopped || connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  connecting = true;
  const info = await fetchBridgeInfo();
  connecting = false;
  if (stopped) return;
  if (!info) {
    scheduleReconnect();
    return;
  }
  let ws: WebSocket;
  try {
    ws = socket = new WebSocket(`ws://127.0.0.1:${info.port}?token=${encodeURIComponent(info.token)}`);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    status('MCP bridge connected');
    ws.send(JSON.stringify({ type: 'hello', app: 'Vbones', protocol: 2 }));
  });

  ws.addEventListener('message', (event) => {
    let req: any;
    try {
      req = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (req?.type === 'cancel' && req.id) {
      cancelled.add(String(req.id));
      return;
    }
    if (!req || req.type !== 'command' || !req.id || !req.method) return;
    queue = queue.then(() => run(ws, req));
  });

  ws.addEventListener('close', (ev) => {
    if (socket === ws) socket = null;
    if (ev.code === 4000) {
      // another Vbones tab took over the bridge; stay quiet instead of fighting for it
      status('MCP bridge: 다른 Vbones 탭이 연결되어 이 탭은 연결 해제됨 (새로고침하면 다시 연결)');
      return;
    }
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

export function startMcpBridge() {
  if (!enabled()) return () => {};
  stopped = false;
  void connect();
  return () => {
    stopped = true;
    if (retryTimer != null) window.clearTimeout(retryTimer);
    retryTimer = null;
    socket?.close();
    socket = null;
  };
}
