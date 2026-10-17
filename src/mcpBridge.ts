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
    connect(url);
  }, 1500);
}

function connect(url: string) {
  if (stopped || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  try {
    socket = new WebSocket(url);
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

  socket.addEventListener('close', () => {
    socket = null;
    scheduleReconnect(url);
  });

  socket.addEventListener('error', () => {
    socket?.close();
  });
}

export function startMcpBridge(url = DEFAULT_URL) {
  if (!enabled()) return () => {};
  stopped = false;
  connect(url);
  return () => {
    stopped = true;
    if (retryTimer != null) window.clearTimeout(retryTimer);
    retryTimer = null;
    socket?.close();
    socket = null;
  };
}
