# Optional native design review helper

Use when a substantial independent review/analysis will help the main agent. The helper returns advice from a selected design snapshot; the main agent owns all canvas edits and acceptance. Do simple edits directly.

## Discover and scope

1. Discover live schemas for `agent_dispatch`, `agent_status`, `agent_cancel`. Check the native MCP server’s fresh `tools/list`: a Codex session may retain an older catalog after installation. The CLI `tool describe` lists Core tools and does not establish whether native helper dispatch is available. Missing live tools mean this installation/client has no dispatch yet. Report that limitation and continue the main task yourself where possible; reconnect after an authorized installation if needed. Never invent dispatch, enable eval, change authentication/root, or silently substitute a provider.
2. Call `list_documents`; resolve the intended file and exact document/page IDs. Query only relevant nodes. Preserve unrelated tabs and unsaved work.
3. Choose coherent node roots: total expanded subtree at most **200 nodes**, serialized context **64 KiB**, prompt **8 KiB UTF-8**. Split a large review into useful bounded slices. The native app captures immutable JSX plus SHA256; it does not send the whole document, filesystem, chat history or credentials.

## Dispatch and integrate

```json
{
  "request_id": "review-unique-id",
  "document_id": "tab-123",
  "page_id": "0:4",
  "node_ids": ["0:42"],
  "prompt": "Review hierarchy and keyboard usability. Return prioritized concrete advice."
}
```

- Call `agent_dispatch` with a new stable request ID. Exact retry replays the same receipt; the same ID with different content fails. At most one helper may be active; do useful independent main work while it runs.
- Poll `agent_status { "task_id": "..." }` at reasonable bounded intervals, backing off while unchanged. Deadline is **180 seconds**. Status can be queued, running, completed, failed, cancelled or interrupted.
- Receipts report requested and actual model/reasoning, snapshot hash/IDs, timestamps, result or classified error. Existing Design model assignment must resolve to Codex. The pinned native helper preserves login and applies explicit configured model/effort; unsupported boundaries/models fail clearly.
- A completed result is advisory. Recheck the current selected subtree against the snapshot before adopting it. If the design changed, reassess/review that scope. Apply authorized changes through dedicated tools or bounded batch/render, inspect an exported frame, show it in the editor and save through its canonical owner.

## Correct, cancel and recover

- To correct completed advice, dispatch **a new request** with `previous_task_id`, explicit feedback in `prompt`, and the current exact target/snapshot. The previous receipt stays immutable. This supports main-agent supervision without helper canvas authority.
- To redirect a running helper, `agent_cancel { "task_id": "..." }`, wait for its terminal receipt, then dispatch a new bounded request. Mid-stream messaging is not supported.
- Cancel is idempotent and terminates only the owned helper process. Cancelling completed work leaves its receipt unchanged.
- Restart marks unfinished tasks interrupted; it never repeats inference automatically. Dispatch a new request only if a retry is appropriate. Results retain at most **100 receipts / 24 hours**.
- If status reports storage unavailable, retry status after storage recovers; terminal-write recovery does not repeat inference. Unknown/expired tasks require a fresh request.

## Boundary

The verified Linux native runner disables inherited MCP, shell, local-image, patch and recursive-agent tools; rejects permission requests; and enforces a read-only session. Helper context is snapshot-only. Main Codex can use its normal authorized tools, but never pass raw secrets or grant the helper another writer role. Availability depends on the verified pinned launcher; ordinary ACP/browser/headless execution cannot silently replace it.
