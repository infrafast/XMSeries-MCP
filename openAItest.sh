#!/bin/bash

set -euo pipefail

OPENAI_MODEL="${OPENAI_MODEL:-gpt-5.1}"
MCP_SERVER_URL="${MCP_SERVER_URL:-https://vixen-freemason-coconut.ngrok-free.dev/mcp}"
CONSOLE_PROTOCOL="${CONSOLE_PROTOCOL:-OSCXR}"
CONSOLE_HOST="${CONSOLE_HOST:-192.168.0.16}"
CONSOLE_PORT="${CONSOLE_PORT:-10024}"

curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d @- <<JSON
{
  "model": "${OPENAI_MODEL}",
  "input": "Connecte-toi à la console ${CONSOLE_PROTOCOL} sur ${CONSOLE_HOST}:${CONSOLE_PORT} puis lis le volume du main LR.",
  "tools": [
    {
      "type": "mcp",
      "server_label": "x32",
      "server_url": "${MCP_SERVER_URL}",
      "allowed_tools": [
        "x32_get_channel_name",
        "x32_get_main_fader",
        "x32_mute_main",
        "x32_set_main_fader"
      ],
      "require_approval": "never"
    }
  ]
}
JSON
