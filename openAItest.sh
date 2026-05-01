#!/bin/bash

curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d @- <<'JSON'
{
  "model": "gpt-5.1",
  "input": "Lis le volume du main LR.",
  "tools": [
    {
      "type": "mcp",
      "server_label": "x32",
      "server_url": "https://vixen-freemason-coconut.ngrok-free.dev/mcp",
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