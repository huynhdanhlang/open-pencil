# @open-pencil/mcp

Model Context Protocol server for [OpenPencil](https://openpencil.dev). It lets MCP clients such as Claude Code, Cursor, and Windsurf inspect and edit designs through the running app, reusing the same tool definitions as the built-in AI chat.

```sh
npm install -g @open-pencil/mcp
openpencil-mcp        # stdio transport for MCP clients
openpencil-mcp-http   # Streamable HTTP transport for browser extensions and scripts
```

On macOS and Linux, local clients prefer a private Unix domain socket; Windows and unavailable sockets fall back to localhost TCP. File access is limited to the effective MCP root.

## Optional native Codex review helper

This fork exposes `agent_dispatch`, `agent_status` and `agent_cancel` through the same authenticated MCP/RPC boundary. Dispatch requires a verified pinned Linux native helper launcher and the configured Codex Design model. Other providers and unverified/browser runtimes fail explicitly.

Dispatch an exact `document_id` / `page_id` / `node_ids` with a unique `request_id` and prompt. One helper analyzes a bounded immutable design snapshot (200 nodes / 64 KiB), using existing login and configured model/reasoning; the main agent alone applies edits. Status returns durable requested/actual identity, hash, result/error and lifecycle receipts. Use `previous_task_id` in a new dispatch to correct completed advice; cancel a running task before redirecting. Restart interrupts unfinished tasks without repeating inference. Retention is 100 receipts / 24 hours, deadline 180 seconds.

See [agent workflow](../../skills/open-pencil/references/agent-tasks.md) and [runner ownership/pins](../../tools/release/agents/README.md). Discover current schemas rather than assuming availability; tool switches do not replace the native helper restriction.

- Setup and client configuration: https://openpencil.dev/programmable/mcp-server
- Source and issues: https://github.com/open-pencil/open-pencil

MIT License.
