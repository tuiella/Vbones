#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.VBONES_MCP_PORT || 3210);
const TIMEOUT_MS = Number(process.env.VBONES_MCP_TIMEOUT || 15000);
const clients = new Set();
const pending = new Map();
let seq = 0;

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg?.type !== 'response' || !msg.id) return;
    const wait = pending.get(msg.id);
    if (!wait) return;
    pending.delete(msg.id);
    clearTimeout(wait.timer);
    msg.ok ? wait.resolve(msg.result) : wait.reject(new Error(msg.error || 'Vbones command failed'));
  });
  ws.on('close', () => clients.delete(ws));
});

wss.on('error', (error) => {
  console.error(`Vbones MCP bridge error: ${error.message}`);
});

function browser() {
  const open = [...clients].find((ws) => ws.readyState === 1);
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
      reject(new Error(`Timed out waiting for Vbones: ${method}`));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
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
      description: 'Read the complete current Vbones rig, layers, clips, poses and playback state.',
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
        const imported = [];
        for (const path of paths || []) {
          const data = await readFile(path);
          imported.push(
            await callBrowser('importImage', {
              fileName: basename(path),
              mimeType: mimeFor(path),
              dataBase64: data.toString('base64'),
            }),
          );
        }
        for (const image of images || []) {
          imported.push(await callBrowser('importImage', image));
        }
        return result(imported.flat());
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
      description: 'Set or clear a layer parent while preserving current world placement.',
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
        'Set a normalized 0..1 pivot/anchor inside a layer image. Example: head neck anchor x=.5,y=.9; arm shoulder x=.5,y=.1.',
      inputSchema: z.object({
        layer: z.string(),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
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
        'Change layer position, rotation, scale, opacity or visibility. Relative mode adds position/rotation and multiplies scale.',
      inputSchema: z.object({
        layer: z.string(),
        mode: z.enum(['absolute', 'relative']).optional(),
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
        frame: z.number().int().min(0),
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
        frame: z.number().min(0).optional(),
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
  };

  return server;
}

console.error(`Vbones MCP browser bridge: ws://127.0.0.1:${PORT}`);
void serveStdio(buildServer);
