---
name: assistant
description: "Retired. Only use when the user explicitly types the bitfab assistant command by name; it tells them the assistant has been retired. Never use it for requests about traces, datasets, labels, replays, experiments, or improving a traced function: handle those directly with the Bitfab MCP tools"
---

# Bitfab Assistant (retired)

## Retired

1. Do not start any work. Tell the user the following, then stop:

   > The Bitfab Assistant (`$bitfab:assistant`) has been retired. You no longer need a special command: just tell your agent what you want, and it will use the Bitfab tools to do it. For example:
   >
   > - "Find the failing traces for generate-email from the last day and tell me why they failed"
   > - "Draft assertions for the last three traces in my bugs dataset"
   > - "Replay my regression dataset against this prompt change and tell me what got better or worse"
   > - "Compare the baseline experiment with the two prompt-variant experiments"
   >
   > To instrument new code or set up replay, use `$bitfab:setup`.

   If the user passed arguments along with the command, offer to do that request directly now, without the assistant.
