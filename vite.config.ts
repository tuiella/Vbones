import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// mcp/server.mjs writes a random token here; only pages served by this dev server can read it
// (other origins are blocked by the browser's same-origin policy), and the bridge requires it.
const TOKEN_FILE = fileURLToPath(new URL('./.vbones-mcp-token', import.meta.url));

function mcpToken(): Plugin {
  const handler = (req: any, res: any, next: () => void) => {
    if (req.url?.split('?')[0] !== '/__vbones_mcp_token') return next();
    let token = '';
    try {
      token = readFileSync(TOKEN_FILE, 'utf8').trim();
    } catch {
      // MCP server not running
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain');
    if (!token) {
      res.statusCode = 404;
      res.end('');
      return;
    }
    res.end(token);
  };
  return {
    name: 'vbones-mcp-token',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), mcpToken()],
  base: './',
});
