#!/bin/bash

set -e

export OPENAI_API_KEY="$OPENAI_API_KEY"

curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d @- <<'JSON'
{
  "model": "gpt-5.1",
  "input": "Lis le nom du canal 3 de la X32.",
  "tools": [
    {
      "type": "mcp",
      "server_label": "x32",
      "server_url": "https://vixen-freemason-coconut.ngrok-free.dev/mcp",
      "allowed_tools": [
        "x32_get_channel_name",
        "x32_get_main_fader",
        "x32_set_channel_bus_send_level",
        "x32_set_channel_bus_send_on",
        "x32_mute_main",
        "x32_set_main_fader"
      ],
      "require_approval": "never"
    }
  ]
}
JSON