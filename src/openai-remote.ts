#!/usr/bin/env node

import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { OSCClient } from "./osc-client.js";

const OSC_HOST = process.env.OSC_HOST || "192.168.0.1";
const OSC_PORT = parseInt(process.env.OSC_PORT || "10023", 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8787", 10);

const osc = new OSCClient(OSC_HOST, OSC_PORT);

const TOOLS: Tool[] = [
  {
    name: "x32_get_channel_name",
    description: "Read the configured name of an X32 channel.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "number", minimum: 1, maximum: 32 },
      },
      required: ["channel"],
    },
  },
  {
    name: "x32_mute_main",
    description: "Mute or unmute the main LR mix.",
    inputSchema: {
      type: "object",
      properties: {
        mute: { type: "boolean" },
      },
      required: ["mute"],
    },
  },
  {
    name: "x32_set_main_fader",
    description: "Set the main LR fader level from 0.0 to 1.0.",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["level"],
    },
  },
  {
    name: "x32_get_main_fader",
    description: "Read the current main LR fader level from 0.0 to 1.0.",
    inputSchema: {
        type: "object",
        properties: {},
    },
  },
];

function makeText(data: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data),
      },
    ],
  };
}

function createMcpServer() {
  const server = new Server(
    { name: "x32-openai-remote", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments as any;

    switch (name) {
      case "x32_get_channel_name": {
        const value = await osc.getChannelName(args.channel);
        return makeText({ ok: true, channel: args.channel, name: value });
      }

      case "x32_mute_main": {
        await osc.muteMain(args.mute);
        return makeText({ ok: true, mute: args.mute });
      }

      case "x32_set_main_fader": {
        await osc.setMainFader(args.level);
        return makeText({ ok: true, level: args.level });
      }

        case "x32_get_main_fader": {
        const value = await osc.getMainFader();

        return makeText({
            ok: true,
            level: value,
        });
        }      

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}

const app = express();
app.use(cors());
app.use(express.json());

const transports: Record<string, StreamableHTTPServerTransport> = {};

app.get("/health", (_req, res) => {
  res.json({ ok: true, oscHost: OSC_HOST, oscPort: OSC_PORT });
});

app.all("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let transport: StreamableHTTPServerTransport | undefined =
    sessionId ? transports[sessionId] : undefined;

  if (!transport) {
    if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
        },
      });

      transport.onclose = () => {
        if (transport?.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        error: "Bad Request: missing or invalid MCP session",
      });
      return;
    }
  }

  await transport.handleRequest(req, res, req.body);
});

async function main() {
  await osc.connect();

  app.listen(HTTP_PORT, () => {
    console.error(`X32 OpenAI MCP running`);
    console.error(`Local: http://127.0.0.1:${HTTP_PORT}/mcp`);
    console.error(`Health: http://127.0.0.1:${HTTP_PORT}/health`);
    console.error(`OSC: ${OSC_HOST}:${OSC_PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});