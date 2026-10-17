#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg?.type !== 'response' || !msg.id) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'Vbones command failed'));
  });
  ws.on('close', () => clients.delete(ws));
});

function browser() {
  const open = [...clients].find((ws) => ws.readyState === 1);
  if (!open) throw new Error(`Vbones browser is not connected. Run npm run dev and open http://localhost:5173 (bridge port ${PORT}).`);
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
    case '.webp': return 'image/webp';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    default: return 'image/png';
  }
}

const tools = [
  { name: 'vbones_get_state', description: 'Read the complete current Vbones rig, layers, clips, poses and playback state.', inputSchema: { type: 'object', properties: {} } },
  { name: 'vbones_get_layers', description: 'List Vbones layers with roles, hierarchy, transforms, pivots and image sizes.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'vbones_import_images',
    description: 'Import one or more local PNG/WebP/JPEG/GIF files into Vbones. Filename conventions can auto-detect body roles, pivots and variants.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Absolute or working-directory-relative image file paths accessible to this MCP server.' }
      },
      required: ['paths']
    }
  },
  {
    name: 'vbones_auto_rig',
    description: 'Auto-parent imported character layers using Vbones filename/role heuristics.',
    inputSchema: { type: 'object', properties: { layers: { type: 'array', items: { type: 'string' }, description: 'Optional layer IDs or names. Omit to rig all unparented layers.' } } }
  },
  {
    name: 'vbones_rig_layer',
    description: 'Assign a semantic role and/or parent to one layer while preserving its world placement.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string' },
        role: { type: 'string', enum: ['none', 'head', 'body', 'arm', 'leg', 'accessory'] },
        parent: { type: ['string', 'null'] }
      },
      required: ['layer']
    }
  },
  {
    name: 'vbones_set_parent',
    description: 'Set or clear a layer parent while preserving current world placement.',
    inputSchema: { type: 'object', properties: { layer: { type: 'string' }, parent: { type: ['string', 'null'] } }, required: ['layer', 'parent'] }
  },
  {
    name: 'vbones_set_pivot',
    description: 'Set a layer pivot in image-local pixel coordinates without moving its visible image or children.',
    inputSchema: { type: 'object', properties: { layer: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['layer', 'x', 'y'] }
  },
  {
    name: 'vbones_set_anchor',
    description: 'Set a normalized 0..1 anchor/pivot inside the current layer image. Examples: head neck anchor near x=.5,y=.9; upper arm shoulder near x=.5,y=.1.',
    inputSchema: { type: 'object', properties: { layer: { type: 'string' }, x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } }, required: ['layer', 'x', 'y'] }
  },
  {
    name: 'vbones_set_transform',
    description: 'Change layer position, rotation, scale, opacity or visibility. Relative mode adds position/rotation and multiplies scale.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string' },
        mode: { type: 'string', enum: ['absolute', 'relative'] },
        x: { type: 'number' }, y: { type: 'number' }, rotation: { type: 'number' },
        scaleX: { type: 'number' }, scaleY: { type: 'number' },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        visible: { type: 'boolean' }
      },
      required: ['layer']
    }
  },
  {
    name: 'vbones_create_pose',
    description: 'Capture the currently displayed character as a named pose.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } }
  },
  {
    name: 'vbones_apply_pose',
    description: 'Apply a pose by ID or name.',
    inputSchema: { type: 'object', properties: { pose: { type: 'string' } }, required: ['pose'] }
  },
  {
    name: 'vbones_create_basic_animation',
    description: 'Generate an editable SD animation preset using Hold → Burst → Overshoot → Settle motion.',
    inputSchema: { type: 'object', properties: { preset: { type: 'string', enum: ['Idle', 'Squash', 'Stretch', 'Attack', 'Hit', 'Bounce'] }, play: { type: 'boolean' } }, required: ['preset'] }
  },
  {
    name: 'vbones_add_keyframe',
    description: 'Create or update a transform keyframe for one layer. Optionally creates/selects a named clip.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string' }, frame: { type: 'integer', minimum: 0 }, clipName: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' }, rotation: { type: 'number' },
        scaleX: { type: 'number' }, scaleY: { type: 'number' }, opacity: { type: 'number', minimum: 0, maximum: 1 },
        variant: { type: 'integer', minimum: 0 },
        ease: { type: 'string', enum: ['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack'] }
      },
      required: ['layer', 'frame']
    }
  },
  {
    name: 'vbones_playback',
    description: 'Play, stop, or seek the active animation clip.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'stop', 'seek'] }, frame: { type: 'number', minimum: 0 } }, required: ['action'] }
  }
];

const server = new Server({ name: 'vbones-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};
  try {
    let result;
    if (name === 'vbones_get_state') result = await callBrowser('getState');
    else if (name === 'vbones_get_layers') result = await callBrowser('getLayers');
    else if (name === 'vbones_import_images') {
      const imported = [];
      for (const path of args.paths || []) {
        const data = await readFile(path);
        imported.push(await callBrowser('importImage', {
          fileName: basename(path),
          mimeType: mimeFor(path),
          dataBase64: data.toString('base64')
        }));
      }
      result = imported.flat();
    } else if (name === 'vbones_auto_rig') result = await callBrowser('autoRig', args);
    else if (name === 'vbones_rig_layer') result = await callBrowser('rigLayer', args);
    else if (name === 'vbones_set_parent') result = await callBrowser('setParent', args);
    else if (name === 'vbones_set_pivot') result = await callBrowser('setPivot', args);
    else if (name === 'vbones_set_anchor') result = await callBrowser('setAnchor', args);
    else if (name === 'vbones_set_transform') result = await callBrowser('setTransform', args);
    else if (name === 'vbones_create_pose') result = await callBrowser('createPose', args);
    else if (name === 'vbones_apply_pose') result = await callBrowser('applyPose', args);
    else if (name === 'vbones_create_basic_animation') result = await callBrowser('createBasicAnimation', args);
    else if (name === 'vbones_add_keyframe') result = await callBrowser('addKeyframe', args);
    else if (name === 'vbones_playback') result = await callBrowser('playback', args);
    else throw new Error(`Unknown tool: ${name}`);

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
  }
});

process.stderr.write(`Vbones MCP bridge listening on ws://127.0.0.1:${PORT}\n`);
const transport = new StdioServerTransport();
await server.connect(transport);
