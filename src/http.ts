#!/usr/bin/env node

import cors from "cors";
import express from "express";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { connectOscDevice, createOscMcpServer, OSC_HOST, OSC_PORT, OSC_PROTOCOL } from "./index.js";

const HTTP_HOST = process.env.HTTP_HOST || "0.0.0.0";
const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8787", 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

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
        console.error("OSC MCP HTTP server running");
        console.error(`MCP: http://${HTTP_HOST}:${HTTP_PORT}/mcp`);
        console.error(`Health: http://${HTTP_HOST}:${HTTP_PORT}/health`);
        console.error(`OSC: ${OSC_HOST}:${OSC_PORT} (${OSC_PROTOCOL})`);
        if (MCP_AUTH_TOKEN) {
            console.error("HTTP auth: bearer token required");
        } else {
            console.error("HTTP auth: disabled");
        }
    });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    startHttpServer().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
