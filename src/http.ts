#!/usr/bin/env node

import cors from "cors";
import express from "express";
import os from "os";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    configureOscRuntime,
    configureSpeakerMapConfig,
    connectOscDevice,
    createOscMcpServer,
    getOscMixerStatus,
    getOscResourceSummaries,
    getOscRuntimeConfig,
    getSpeakerMapConfig,
    getOscToolSummaries,
} from "./index.js";

const HTTP_HOST = process.env.HTTP_HOST || "0.0.0.0";
const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8787", 10);
const HTTP_PUBLIC_HOST = process.env.HTTP_PUBLIC_HOST;
const HTTP_SCHEME = "http";
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";

function normalizeUnsupportedModernProtocol(req: express.Request): boolean {
    const protocolVersion = req.header("mcp-protocol-version");
    if (protocolVersion !== MODERN_PROTOCOL_VERSION) return false;

    // Keep the stable v1 SDK behavior for existing 2025-era clients such as
    // LiveStageAssistant. Rewriting only the unsupported modern probe allows
    // 2026-capable clients to fall back cleanly instead of tripping the v1
    // transport's protocol-version validator.
    req.headers["mcp-protocol-version"] = LEGACY_PROTOCOL_VERSION;
    return true;
}

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

function renderMcpAdminPage(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>XMSeries MCP</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #5e6a75;
      --border: #d7dde3;
      --accent: #137c72;
      --accent-strong: #0d5f57;
      --danger: #a13232;
      --ok: #176b3a;
      --code: #101820;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101316;
        --panel: #171c21;
        --text: #edf1f4;
        --muted: #a8b2bc;
        --border: #303942;
        --accent: #36b7a9;
        --accent-strong: #59d1c4;
        --danger: #ff8a8a;
        --ok: #75d69a;
        --code: #0b0f12;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1060px, calc(100vw - 32px));
      margin: 32px auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 0;
    }
    p { margin: 0; color: var(--muted); }
    .endpoint {
      padding: 7px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--muted);
      white-space: nowrap;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(300px, 420px) 1fr;
      gap: 20px;
      align-items: start;
    }
    .subsection {
      margin-top: 18px;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 17px;
      font-weight: 650;
      letter-spacing: 0;
    }
    form {
      display: grid;
      gap: 18px;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 12px;
    }
    legend {
      padding: 0;
      margin-bottom: 8px;
      font-weight: 650;
      color: var(--muted);
    }
    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
    }
    input, select, textarea {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      background: transparent;
      color: var(--text);
      font: inherit;
    }
    textarea {
      min-height: 128px;
      resize: vertical;
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 13px;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    button {
      min-height: 38px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      padding: 8px 14px;
      background: var(--accent);
      color: #fff;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }
    button.secondary {
      background: transparent;
      color: var(--accent-strong);
    }
    button:disabled {
      opacity: .62;
      cursor: wait;
    }
    .message {
      min-height: 21px;
      color: var(--muted);
    }
    .message.ok { color: var(--ok); }
    .message.error { color: var(--danger); }
    .status-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .pill {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px 9px;
      color: var(--muted);
      font-size: 13px;
    }
    .pill.online { color: var(--ok); border-color: color-mix(in srgb, var(--ok), var(--border)); }
    .pill.offline { color: var(--danger); border-color: color-mix(in srgb, var(--danger), var(--border)); }
    pre {
      min-height: 420px;
      margin: 0;
      overflow: auto;
      padding: 14px;
      border-radius: 6px;
      background: var(--code);
      color: #edf1f4;
      font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .agent-config {
      min-height: 128px;
    }
    .tools-list {
      display: grid;
      gap: 10px;
      max-height: 520px;
      overflow: auto;
      padding-right: 4px;
    }
    .resources-list {
      display: grid;
      gap: 10px;
    }
    .tool-item {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      background: color-mix(in srgb, var(--panel), var(--bg) 34%);
    }
    .tool-name, .resource-name {
      margin-bottom: 4px;
      color: var(--accent-strong);
      font: 700 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
    }
    .resource-uri {
      margin-bottom: 5px;
      color: var(--text);
      font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
    }
    .tool-desc, .resource-desc {
      color: var(--muted);
      font-size: 13px;
    }
    @media (max-width: 820px) {
      main { width: min(100vw - 20px, 640px); margin: 18px auto; }
      header, .grid { display: grid; grid-template-columns: 1fr; }
      .endpoint { white-space: normal; }
      .pair { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>XMSeries MCP</h1>
        <p>Runtime mixer connection and MCP HTTP endpoint.</p>
      </div>
      <div class="endpoint">MCP endpoint: <strong id="mcp-endpoint">/mcp</strong></div>
    </header>
    <div class="grid">
      <section>
        <h2>Mixer Configuration</h2>
        <form id="config-form">
          <fieldset>
            <legend>Connection</legend>
            <label>Host
              <input id="host" name="host" autocomplete="off" required>
            </label>
            <div class="pair">
              <label>Port
                <input id="port" name="port" type="number" min="1" max="65535" required>
              </label>
              <label>Protocol
                <select id="protocol" name="protocol">
                  <option value="OSCX32M32">X32/M32</option>
                  <option value="OSCXR">XR</option>
                </select>
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Limits</legend>
            <div class="pair">
              <label>Channels
                <input id="channelCount" name="channelCount" type="number" min="1" required>
              </label>
              <label>Buses
                <input id="busCount" name="busCount" type="number" min="1" required>
              </label>
            </div>
            <div class="pair">
              <label>FX
                <input id="fxCount" name="fxCount" type="number" min="1" required>
              </label>
              <label>DCA
                <input id="dcaCount" name="dcaCount" type="number" min="1" required>
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Speaker mapping</legend>
            <label>XMS_SPEAKER_MAP
              <textarea id="speakerMap" name="speakerMap" spellcheck="false" placeholder='{"laurent":{"bus":"Laurent","channel":"Guitar-loran"}}'></textarea>
            </label>
            <p title="Example: {&quot;thomas&quot;:{&quot;bus&quot;:&quot;Thomas&quot;,&quot;channel&quot;:&quot;Talk Thomas&quot;}}">Maps recognized voice speakers to mixer bus/channel names. Used by first-person requests such as "mon retour".</p>
          </fieldset>
          <div class="actions">
            <button id="update-button" type="submit">Update</button>
            <button class="secondary" id="refresh-button" type="button">Refresh</button>
          </div>
          <div id="message" class="message" role="status"></div>
        </form>
      </section>
      <section>
        <div class="status-head">
          <h2>Status</h2>
          <span id="online-pill" class="pill">Unknown</span>
        </div>
        <pre id="status">Loading...</pre>
      </section>
    </div>
    <section class="subsection">
      <h2>Agent HTTP Config</h2>
      <pre id="agent-config" class="agent-config">Loading...</pre>
    </section>
    <section class="subsection">
      <div class="status-head">
        <h2>Resources</h2>
        <span id="resource-count" class="pill">0</span>
      </div>
      <div id="resources-list" class="resources-list"></div>
    </section>
    <section class="subsection">
      <div class="status-head">
        <h2>Tools</h2>
        <span id="tool-count" class="pill">0</span>
      </div>
      <div id="tools-list" class="tools-list"></div>
    </section>
  </main>
  <script>
    const form = document.getElementById("config-form");
    const message = document.getElementById("message");
    const statusEl = document.getElementById("status");
    const agentConfigEl = document.getElementById("agent-config");
    const resourcesListEl = document.getElementById("resources-list");
    const resourceCountEl = document.getElementById("resource-count");
    const toolsListEl = document.getElementById("tools-list");
    const toolCountEl = document.getElementById("tool-count");
    const pill = document.getElementById("online-pill");
    const updateButton = document.getElementById("update-button");
    const endpointEl = document.getElementById("mcp-endpoint");
    const fields = ["host", "port", "protocol", "channelCount", "busCount", "fxCount", "dcaCount"];
    const currentPath = window.location.pathname;
    const mcpBase = currentPath.endsWith("/") ? currentPath.slice(0, -1) : currentPath;

    function mcpRelative(path = "") {
      return mcpBase + path;
    }

    endpointEl.textContent = mcpBase;

    function setMessage(text, kind) {
      message.textContent = text || "";
      message.className = "message" + (kind ? " " + kind : "");
    }

    function numberValue(id) {
      return Number(document.getElementById(id).value);
    }

    function payloadFromForm() {
      let speakerMap = {};
      const speakerMapText = document.getElementById("speakerMap").value.trim();
      if (speakerMapText) {
        speakerMap = JSON.parse(speakerMapText);
        if (!speakerMap || Array.isArray(speakerMap) || typeof speakerMap !== "object") {
          throw new Error("XMS_SPEAKER_MAP must be a JSON object.");
        }
      }
      return {
        host: document.getElementById("host").value.trim(),
        port: numberValue("port"),
        protocol: document.getElementById("protocol").value,
        channelCount: numberValue("channelCount"),
        busCount: numberValue("busCount"),
        fxCount: numberValue("fxCount"),
        dcaCount: numberValue("dcaCount"),
        speakerMap
      };
    }

    function fillForm(config) {
      document.getElementById("host").value = config.host ?? "";
      document.getElementById("port").value = config.port ?? "";
      document.getElementById("protocol").value = config.protocol ?? "OSCX32M32";
      document.getElementById("channelCount").value = config.channelCount ?? "";
      document.getElementById("busCount").value = config.busCount ?? "";
      document.getElementById("fxCount").value = config.fxCount ?? "";
      document.getElementById("dcaCount").value = config.dcaCount ?? "";
    }

    function fillSpeakerMap(map) {
      document.getElementById("speakerMap").value = JSON.stringify(map || {}, null, 2);
    }

    function setBusy(busy) {
      updateButton.disabled = busy;
      for (const id of fields) {
        document.getElementById(id).disabled = busy;
      }
    }

    function renderStatus(data) {
      statusEl.textContent = JSON.stringify(data, null, 2);
      const connected = Boolean(data?.mixer?.connected);
      pill.textContent = connected ? "Connected" : "Disconnected";
      pill.className = "pill " + (connected ? "online" : "offline");
    }

    function renderAgentConfig() {
      const config = {
        mcpServers: {
          mixer: {
            type: "streamable-http",
            url: window.location.origin + mcpBase
          }
        }
      };
      agentConfigEl.textContent = JSON.stringify(config, null, 2);
    }

    function renderTools(tools) {
      toolCountEl.textContent = String(tools.length);
      toolsListEl.textContent = "";
      for (const tool of tools) {
        const item = document.createElement("div");
        item.className = "tool-item";

        const name = document.createElement("div");
        name.className = "tool-name";
        name.textContent = tool.name;

        const desc = document.createElement("div");
        desc.className = "tool-desc";
        desc.textContent = tool.description || "";

        item.append(name, desc);
        toolsListEl.append(item);
      }
    }

    function renderResources(resources) {
      resourceCountEl.textContent = String(resources.length);
      resourcesListEl.textContent = "";
      for (const resource of resources) {
        const item = document.createElement("div");
        item.className = "tool-item";

        const name = document.createElement("div");
        name.className = "resource-name";
        name.textContent = resource.title || resource.name || "Resource";

        const uri = document.createElement("div");
        uri.className = "resource-uri";
        uri.textContent = resource.uri;

        const desc = document.createElement("div");
        desc.className = "resource-desc";
        desc.textContent = [resource.description, resource.mimeType].filter(Boolean).join(" · ");

        item.append(name, uri, desc);
        resourcesListEl.append(item);
      }
    }

    async function loadStatus() {
      const response = await fetch(mcpRelative("/status"), { headers: { accept: "application/json" } });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to read mixer status");
      }
      fillForm(data.runtimeConfig);
      fillSpeakerMap(data.speakerMap || {});
      renderStatus(data);
      return data;
    }

    async function loadTools() {
      const response = await fetch(mcpRelative("/tools"), { headers: { accept: "application/json" } });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to read tool list");
      }
      renderTools(data.tools || []);
    }

    async function loadResources() {
      const response = await fetch(mcpRelative("/resources"), { headers: { accept: "application/json" } });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to read resource list");
      }
      renderResources(data.resources || []);
    }

    document.getElementById("refresh-button").addEventListener("click", async () => {
      setMessage("Refreshing...");
      try {
        await loadStatus();
        setMessage("Status refreshed.", "ok");
      } catch (error) {
        setMessage(error.message || String(error), "error");
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setBusy(true);
      setMessage("Updating mixer runtime...");
      try {
        const response = await fetch(mcpRelative("/config"), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payloadFromForm())
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Unable to update mixer config");
        }
        fillForm(data.status.runtimeConfig);
        fillSpeakerMap(data.status.speakerMap || {});
        renderStatus(data.status);
        setMessage(data.update.reconnect ? "Configuration updated and reconnected." : "Configuration updated.", "ok");
      } catch (error) {
        setMessage(error.message || String(error), "error");
      } finally {
        setBusy(false);
      }
    });

    renderAgentConfig();
    Promise.all([loadStatus(), loadResources(), loadTools()]).then(() => {
      setMessage("Ready.", "ok");
    }).catch((error) => {
      statusEl.textContent = error.message || String(error);
      pill.textContent = "Error";
      pill.className = "pill offline";
      setMessage(error.message || String(error), "error");
    });
  </script>
</body>
</html>`;
}

export async function startHttpServer(): Promise<void> {
    await connectOscDevice();

    const app = express();
    app.use(cors());
    app.use(express.json());

    app.use((req, res, next) => {
        if (isAuthorized(req)) {
            next();
            return;
        }

        res.status(401).json({ error: "Unauthorized" });
    });

    app.get("/health", (_req, res) => {
        const oscConfig = getOscRuntimeConfig();
        res.json({
            ok: true,
            scheme: HTTP_SCHEME,
            transport: "streamable-http",
            sessionMode: "stateless",
            oscHost: oscConfig.host,
            oscPort: oscConfig.port,
            oscProtocol: oscConfig.protocol,
            oscChannelCount: oscConfig.channelCount,
            oscBusCount: oscConfig.busCount,
            oscFxCount: oscConfig.fxCount,
            oscDcaCount: oscConfig.dcaCount,
            authRequired: Boolean(MCP_AUTH_TOKEN),
        });
    });

    app.get("/mcp", (req, res, next) => {
        const accept = req.header("accept") || "";
        const wantsHtml = accept.includes("text/html") || accept.includes("*/*") || accept === "";
        if (!wantsHtml) {
            next();
            return;
        }

        res.type("html").send(renderMcpAdminPage());
    });

    app.get("/mcp/status", async (_req, res) => {
        try {
            const status = await getOscMixerStatus();
            res.json({ ...status, speakerMap: getSpeakerMapConfig() });
        } catch (error) {
            res.status(500).json({
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    app.get("/mcp/resources", (_req, res) => {
        res.json({ resources: getOscResourceSummaries() });
    });

    app.get("/mcp/tools", (_req, res) => {
        res.json({ tools: getOscToolSummaries() });
    });

    app.post("/mcp/config", async (req, res) => {
        try {
            const update = await configureOscRuntime(req.body || {});
            const speakerMapUpdate =
                Object.prototype.hasOwnProperty.call(req.body || {}, "speakerMap")
                    ? configureSpeakerMapConfig((req.body || {}).speakerMap)
                    : undefined;
            const status = await getOscMixerStatus();
            res.json({ update, speakerMapUpdate, status: { ...status, speakerMap: getSpeakerMapConfig() } });
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    app.all("/mcp", async (req, res) => {
        const downgradedModernProbe = normalizeUnsupportedModernProtocol(req);
        if (downgradedModernProbe) {
            console.error("MCP 2026-07-28 request detected; using legacy 2025 compatibility for client fallback");
        }

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        const server = createOscMcpServer();
        await server.connect(transport);

        try {
            await transport.handleRequest(req, res, req.body);
        } finally {
            await transport.close();
        }
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
                    assistantOptions: {
                        promptName: "xmseries_mixer_assistant",
                        resourceUri: "agent://prompt/system",
                    },
                },
            },
        };

        console.error("OSC MCP HTTP server running");
        console.error(`MCP: ${HTTP_SCHEME}://${HTTP_HOST}:${HTTP_PORT}/mcp`);
        console.error(`Health: ${HTTP_SCHEME}://${HTTP_HOST}:${HTTP_PORT}/health`);
        console.error(`Agent MCP URL: ${mcpUrl}`);
        console.error(`Agent health URL: ${healthUrl}`);
        console.error("Streamable HTTP sessions: stateless (no Mcp-Session-Id)");
        const oscConfig = getOscRuntimeConfig();
        console.error(`OSC: ${oscConfig.host}:${oscConfig.port} (${oscConfig.protocol})`);
        console.error(`OSC limits: ${oscConfig.channelCount} channel(s), ${oscConfig.busCount} bus(es), ${oscConfig.fxCount} FX slot/return(s), ${oscConfig.dcaCount} DCA group(s)`);
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
