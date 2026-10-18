#!/usr/bin/env node
import { open, stat } from 'node:fs/promises';
import { unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.VBONES_MCP_PORT || 3210);
const TIMEOUT_MS = Number(process.env.VBONES_MCP_TIMEOUT || 15000);
const MAX_FRAME = 3600; // keep in sync with src/anim.ts
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXT = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif']);
const pending = new Map();
let seq = 0;
let active = null; // the single browser tab that receives commands (newest wins)

// ---- bridge authentication ----
// 1) Origin must be a local page (blocks any website open in the user's browser).
// 2) A random per-run token, written to .vbones-mcp-token and served only by the Vbones dev server
//    (vite.config.ts) to same-origin pages, must be presented in the connection URL.
//    The file also carries the port, so the browser follows VBONES_MCP_PORT.
const TOKEN = randomBytes(24).toString('hex');
const TOKEN_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.vbones-mcp-token');
const extraOrigins = (process.env.VBONES_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
let ownsTokenFile = false;
function writeToken() {
  try {
    writeFileSync(TOKEN_FILE, JSON.stringify({ token: TOKEN, port: PORT }), { mode: 0o600 });
    ownsTokenFile = true;
  } catch (error) {
    console.error(`Vbones MCP: cannot write token file ${TOKEN_FILE}: ${error.message}`);
  }
}
const removeToken = () => {
  if (!ownsTokenFile) return; // never delete the file of another, running bridge
  try {
    unlinkSync(TOKEN_FILE);
  } catch {}
};
process.on('exit', removeToken);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));

function originAllowed(origin) {
  if (!origin) return false;
  if (extraOrigins.includes(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
  } catch {
    return false;
  }
}

function tokenOk(url) {
  try {
    const t = new URL(url, 'http://x').searchParams.get('token') || '';
    const a = Buffer.from(t), b = Buffer.from(TOKEN);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: PORT,
  maxPayload: 64 * 1024 * 1024,
  verifyClient: ({ origin, req }, done) => {
    if (!originAllowed(origin)) {
      console.error(`Vbones MCP: rejected connection from origin ${origin || '(none)'}`);
      return done(false, 403, 'Origin not allowed');
    }
    if (!tokenOk(req.url)) {
      console.error('Vbones MCP: rejected connection with missing/invalid token');
      return done(false, 401, 'Invalid token');
    }
    done(true);
  },
});
wss.on('connection', (ws) => {
  if (active && active.readyState === 1) active.close(4000, 'Replaced by a newer Vbones tab');
  active = ws;
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg?.type !== 'response' || !msg.id) return;
    const wait = pending.get(msg.id);
    if (!wait || wait.ws !== ws) return; // only the tab we asked may answer
    pending.delete(msg.id);
    clearTimeout(wait.timer);
    msg.ok ? wait.resolve(msg.result) : wait.reject(new Error(msg.error || 'Vbones command failed'));
  });
  ws.on('close', () => {
    if (active === ws) active = null;
    for (const [id, wait] of pending) {
      if (wait.ws !== ws) continue;
      clearTimeout(wait.timer);
      pending.delete(id);
      wait.reject(new Error('Vbones tab disconnected'));
    }
  });
});

// written only once we really listen, so a second server that fails to bind can't clobber the first one's token
wss.on('listening', writeToken);

wss.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    // Without a listener every tool would fail with "not connected"; fail loudly instead.
    console.error(
      `Vbones MCP: port ${PORT} is already used (probably by another Vbones MCP server). ` +
        'Only one MCP client can drive Vbones at a time with the same port; stop the other one or set VBONES_MCP_PORT.',
    );
    process.exit(1);
  }
  console.error(`Vbones MCP bridge error: ${error.message}`);
});

function browser() {
  const open = active && active.readyState === 1 ? active : null;
  if (!open) {
    throw new Error(
      `Vbones browser is not connected. Run "npm run dev" and open http://localhost:5173 (bridge port ${PORT}).`,
    );
  }
  return open;
}

function callBrowser(method, params = {}) {
  const ws = browser();
  const id = `mcp-${Date.now()}-${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // ask the tab to drop the command if it has not committed yet
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'cancel', id }));
      reject(
        new Error(
          `Timed out waiting for Vbones: ${method}. The command was cancelled, but it may already have been applied — ` +
            'call vbones_get_state to check before retrying.',
        ),
      );
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer, ws });
    ws.send(JSON.stringify({ type: 'command', id, method, params }));
  });
}

function mimeFor(path) {
  switch (extname(path).toLowerCase()) {
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
}

/** Read a local file only if it really is an image of a supported type. */
async function readImageFile(path) {
  const ext = extname(path).toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error(`${basename(path)}: only .png .webp .jpg .jpeg .gif files can be imported`);
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${basename(path)}: not a file`);
  if (info.size > MAX_IMAGE_BYTES) throw new Error(`${basename(path)}: larger than 20MB`);
  const fh = await open(path, 'r');
  try {
    const data = await fh.readFile();
    const b = data;
    const isImage =
      (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
      (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
      (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) ||
      (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP');
    if (!isImage) throw new Error(`${basename(path)}: file content is not a PNG/JPEG/GIF/WebP image`);
    return data;
  } finally {
    await fh.close();
  }
}

function result(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function fail(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  };
}

function buildServer() {
  const server = new McpServer({ name: 'vbones-mcp', version: '0.2.0' });

  server.registerTool(
    'vbones_get_state',
    {
      description:
        'Read the current Vbones rig, layers, clips, poses and playback state. Each layer has "transform" (setup pose) and "displayed" (what is on screen now).',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return result(await callBrowser('getState'));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_get_layers',
    {
      description: 'List Vbones layers with semantic roles, hierarchy, transforms, pivots and image sizes.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return result(await callBrowser('getLayers'));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_import_images',
    {
      description:
        'Import character part images into Vbones. Prefer local file paths. Base64 image data is also supported for hosts that can provide it.',
      inputSchema: z.object({
        paths: z.array(z.string()).optional().describe('Local PNG/WebP/JPEG/GIF paths accessible to the MCP process.'),
        images: z
          .array(
            z.object({
              fileName: z.string(),
              mimeType: z.string().optional(),
              dataBase64: z.string(),
            }),
          )
          .optional()
          .describe('Inline image data. Do not use unless the MCP host can supply the bytes.'),
      }),
    },
    async ({ paths, images }) => {
      try {
        if ((!paths || !paths.length) && (!images || !images.length)) {
          throw new Error('Provide at least one path or inline image.');
        }
        const batch = [];
        const failed = [];
        for (const path of paths || []) {
          try {
            const data = await readImageFile(path);
            batch.push({ fileName: basename(path), mimeType: mimeFor(path), dataBase64: data.toString('base64') });
          } catch (error) {
            failed.push(error.code === 'ENOENT' ? `${basename(path)}: file not found` : error.message);
          }
        }
        batch.push(...(images || []));
        if (!batch.length) throw new Error(`Nothing to import. ${failed.join('; ')}`);
        // send everything in ONE command so draw order, auto-parenting and @variants match drag & drop
        const out = await callBrowser('importImages', { images: batch });
        out.failed = [...failed, ...(out.failed || [])];
        return result(out);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_auto_rig',
    {
      description:
        'Auto-parent imported character layers using Vbones filename and semantic-role heuristics. Omit layers to rig every unparented layer.',
      inputSchema: z.object({
        layers: z.array(z.string()).optional().describe('Optional layer IDs or names.'),
      }),
    },
    async (args) => {
      try {
        return result(await callBrowser('autoRig', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_rig_layer',
    {
      description: 'Assign a semantic role and/or parent to one layer while preserving its current world placement.',
      inputSchema: z.object({
        layer: z.string(),
        role: z.enum(['none', 'head', 'body', 'arm', 'leg', 'accessory']).optional(),
        parent: z.string().nullable().optional(),
      }),
    },
    async (args) => {
      try {
        return result(await callBrowser('rigLayer', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_set_parent',
    {
      description: 'Set or clear a layer parent while preserving current world placement. Fails on cycles.',
      inputSchema: z.object({
        layer: z.string(),
        parent: z.string().nullable(),
      }),
    },
    async (args) => {
      try {
        return result(await callBrowser('setParent', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_set_pivot',
    {
      description: 'Set a layer pivot in image-local pixel coordinates without moving its visible image or children.',
      inputSchema: z.object({
        layer: z.string(),
        x: z.number(),
        y: z.number(),
      }),
    },
    async (args) => {
      try {
        return result(await callBrowser('setPivot', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_set_anchor',
    {
      description:
        'Set a normalized 0..1 pivot/anchor. By default (space="opaque") 0..1 spans the visible, non-transparent part of the image, so it works for full-canvas exports. Example: head neck x=.5,y=.95; arm shoulder x=.5,y=.1. Use space="image" for the whole image rectangle.',
      inputSchema: z.object({
        layer: z.string(),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        space: z.enum(['opaque', 'image']).optional(),
      }),
    },
    async (args) => {
      try {
        return result(await callBrowser('setAnchor', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_set_transform',
    {
      description:
        'Change layer position, rotation, scale, opacity or visibility. Relative mode adds position/rotation and multiplies scale. target="auto" (default) writes a keyframe at the current frame when Animate mode is on, otherwise edits the setup pose; force with "setup" or "key".',
      inputSchema: z.object({
        layer: z.string(),
        mode: z.enum(['absolute', 'relative']).optional(),
        target: z.enum(['auto', 'setup', 'key']).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        rotation: z.number().optional(),
        scaleX: z.number().optional(),
        scaleY: z.number().optional(),
        opacity: z.number().min(0).max(1).optional(),
        visible: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        return result(await callBrowser('setTransform', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_create_pose',
    {
      description: 'Capture the currently displayed character as a named pose.',
      inputSchema: z.object({ name: z.string().optional() }),
    },
    async (args) => {
      try {
        return result(await callBrowser('createPose', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_apply_pose',
    {
      description: 'Apply a pose by pose ID or pose name.',
      inputSchema: z.object({ pose: z.string() }),
    },
    async (args) => {
      try {
        return result(await callBrowser('applyPose', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_create_basic_animation',
    {
      description:
        'Generate an editable SD animation preset using Hold → Burst → Overshoot → Settle motion.',
      inputSchema: z.object({
        preset: z.enum(['Idle', 'Squash', 'Stretch', 'Attack', 'Hit', 'Bounce']),
        play: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        return result(await callBrowser('createBasicAnimation', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_add_keyframe',
    {
      description: 'Create or update a transform keyframe for one layer. Optionally creates/selects a named clip.',
      inputSchema: z.object({
        layer: z.string(),
        frame: z.number().int().min(0).max(MAX_FRAME),
        clipName: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        rotation: z.number().optional(),
        scaleX: z.number().optional(),
        scaleY: z.number().optional(),
        opacity: z.number().min(0).max(1).optional(),
        variant: z.number().int().min(0).optional(),
        ease: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack']).optional(),
      }),
    },
    async (args) => {
      try {
        return result(await callBrowser('addKeyframe', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'vbones_playback',
    {
      description: 'Play, stop, or seek the active Vbones animation clip.',
      inputSchema: z.object({
        action: z.enum(['play', 'stop', 'seek']),
        frame: z.number().min(0).max(MAX_FRAME).optional(),
      }),
    },
    async (args) => {
      try {
        return result(await callBrowser('playback', args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.server.onclose = () => {
    for (const wait of pending.values()) {
      clearTimeout(wait.timer);
      wait.reject(new Error('MCP connection closed'));
    }
    pending.clear();
    wss.close();
    removeToken();
  };

  return server;
}

console.error(`Vbones MCP browser bridge: ws://127.0.0.1:${PORT}`);
void serveStdio(buildServer);
