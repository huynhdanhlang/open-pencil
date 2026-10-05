# Native Codex snapshot helper

The trusted launcher owns helper restrictions and child process cleanup. It preserves the existing Codex login and applies the captured reusable model/effort. Config preflight and ACP sessions use the same home-directory scope. No inherited MCP, shell, local-image, recursive-agent, or patch tools are available; permission requests are always denied.

`pinned-models.json` is the unchanged model catalog from OpenAI Codex **rust-v0.159.3**, the exact installed CLI dependency:
https://github.com/openai/codex/blob/rust-v0.159.3/codex-rs/models-manager/models.json

It is distributed under OpenAI Codex's Apache-2.0 license. The launcher copies it to a private temporary file and removes only `apply_patch_tool_type` and `shell_type` declarations. Model IDs, instructions, reasoning capabilities, limits and provider behavior remain unchanged. This is a tool restriction, not a model substitution. Unsupported model IDs fail explicitly. Catalog and adapter/CLI pins must be reviewed together before an upgrade. Temporary catalogs are removed on process exit.
