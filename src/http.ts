#!/usr/bin/env node

import cors from "cors";
import express from "express";
import { randomUUID } from "crypto";
import os from "os";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
    connectOscDevice,
    createOscMcpServer,
    OSC_BUS_COUNT,
    OSC_CHANNEL_COUNT,
    OSC_HOST,
    OSC_PORT,
    OSC_PROTOCOL,
} from "./index.js";

const HTTP_HOST = process.env.HTTP_HOST || "0.0.0.0";
const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8787", 10);
const HTTP_PUBLIC_HOST = process.env.HTTP_PUBLIC_HOST;
const HTTP_SCHEME = "http";
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

function getConnectableHost(): string {
    if (HTTP_PUBLIC_HOST) {
        return HTTP_PUBLIC_HOST;
    }

    if (HTTP_HOST && HTTP_HOST !== "0.0.0.0" && HTTP_HOST !== "::") {
        return HTTP_HOST;
    }

    const interfaces = os.networkInterfaces();
    for (const addresses of Object.values(interfaces)) {
        for (const address of addresses || []) {
            if (address.family === "IPv4" && !address.internal) {
                return address.address;
            }
        }
    }

    return "127.0.0.1";
}

function isAuthorized(req: express.Request): boolean {
    if (!MCP_AUTH_TOKEN) return true;

    const authorization = req.header("authorization");
    const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const headerToken = req.header("x-mcp-auth-token");

    return bearerToken === MCP_AUTH_TOKEN || headerToken === MCP_AUTH_TOKEN;
}

export async function startHttpServer(): Promise<void> {
    await connectOscDevice();

    const app = express();
    app.use(cors());
    app.use(express.json());

    const transports: Record<string, StreamableHTTPServerTransport> = {};

    app.use((req, res, next) => {
        if (isAuthorized(req)) {
            next();
            return;
        }

        res.status(401).json({ error: "Unauthorized" });
    });

    app.get("/health", (_req, res) => {
        res.json({
            ok: true,
            scheme: HTTP_SCHEME,
            transport: "streamable-http",
            oscHost: OSC_HOST,
            oscPort: OSC_PORT,
            oscProtocol: OSC_PROTOCOL,
            authRequired: Boolean(MCP_AUTH_TOKEN),
        });
    });

    app.all("/mcp", async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let transport = sessionId ? transports[sessionId] : undefined;

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

                const server = createOscMcpServer();
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

    app.listen(HTTP_PORT, HTTP_HOST, () => {
        const connectableHost = getConnectableHost();
        const mcpUrl = `${HTTP_SCHEME}://${connectableHost}:${HTTP_PORT}/mcp`;
        const healthUrl = `${HTTP_SCHEME}://${connectableHost}:${HTTP_PORT}/health`;
        const agentConfig = {
            mcpServers: {
                mixer: {
                    type: "streamable-http",
                    url: mcpUrl,
                    headers: MCP_AUTH_TOKEN ? { Authorization: `Bearer ${MCP_AUTH_TOKEN}` } : undefined,
                    assistantPrompt: {
                        promptName: "xmseries_mixer_assistant",
                        resourceUri: "xmseries://prompt/system",
                        tool: "osc_get_agent_prompt",
                    },
                },
            },
        };

        console.error("OSC MCP HTTP server running");
        console.error(`MCP: ${HTTP_SCHEME}://${HTTP_HOST}:${HTTP_PORT}/mcp`);
        console.error(`Health: ${HTTP_SCHEME}://${HTTP_HOST}:${HTTP_PORT}/health`);
        console.error(`Agent MCP URL: ${mcpUrl}`);
        console.error(`Agent health URL: ${healthUrl}`);
        console.error(`OSC: ${OSC_HOST}:${OSC_PORT} (${OSC_PROTOCOL})`);
        console.error(`OSC limits: ${OSC_CHANNEL_COUNT} channel(s), ${OSC_BUS_COUNT} bus(es)`);
        if (MCP_AUTH_TOKEN) {
            console.error("HTTP auth: bearer token required");
        } else {
            console.error("HTTP auth: disabled");
        }
        console.error("Agent HTTP MCP config:");
        console.error(JSON.stringify(agentConfig, null, 2));
    });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    startHttpServer().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
