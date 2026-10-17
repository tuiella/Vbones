import { executeMcpCommand } from './commands';
import { status } from './store';

const DEFAULT_URL = 'ws://127.0.0.1:3210';
let socket: WebSocket | null = null;
let stopped = false;
let retryTimer: number | null = null;

function enabled() {
  const q = new URLSearchParams(location.search);
  return q.get('mcp') === '1' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

function scheduleReconnect(url: string) {
  if (stopped || retryTimer != null) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void connect(url);
  }, 1500);
}

const TOKEN_PATH = '/__vbones_mcp_token';
let connecting = false;

/** The token is written by mcp/server.mjs and served only by our own dev server (same-origin). */
async function fetchToken(): Promise<string | null> {
  try {
    const r = await fetch(TOKEN_PATH, { cache: 'no-store' });
    if (!r.ok) return null;
    const t = (await r.text()).trim();
    return /^[a-f0-9]{32,128}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

async function connect(url: string) {
  if (stopped || connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  connecting = true;
  const token = await fetchToken();
  connecting = false;
  if (stopped) return;
  if (!token) {
    scheduleReconnect(url);
    return;
  }
  try {
    socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
  } catch {
    scheduleReconnect(url);
    return;
  }

  socket.addEventListener('open', () => {
    status('MCP bridge connected');
    socket?.send(JSON.stringify({ type: 'hello', app: 'Vbones', protocol: 1 }));
  });

  socket.addEventListener('message', async (event) => {
    let req: any;
    try {
      req = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!req || req.type !== 'command' || !req.id || !req.method) return;
    try {
      const result = await executeMcpCommand(String(req.method), req.params ?? {});
      socket?.send(JSON.stringify({ type: 'response', id: req.id, ok: true, result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      socket?.send(JSON.stringify({ type: 'response', id: req.id, ok: false, error: message }));
    }
  });

  socket.addEventListener('close', (ev) => {
    socket = null;
    if (ev.code === 4000) {
      // another Vbones tab took over the bridge; stay quiet instead of fighting for it
      status('MCP bridge: 다른 Vbones 탭이 연결되어 이 탭은 연결 해제됨 (새로고침하면 다시 연결)');
      return;
    }
    scheduleReconnect(url);
  });

  socket.addEventListener('error', () => {
    socket?.close();
  });
}

export function startMcpBridge(url = DEFAULT_URL) {
  if (!enabled()) return () => {};
  stopped = false;
  void connect(url);
  return () => {
    stopped = true;
    if (retryTimer != null) window.clearTimeout(retryTimer);
    retryTimer = null;
    socket?.close();
    socket = null;
  };
}
