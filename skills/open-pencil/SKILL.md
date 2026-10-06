---
name: open-pencil
description: Work with Figma .fig design files and the running OpenPencil editor — inspect structure, query nodes, analyze design tokens, export PNG/SVG/PDF/JSX, and modify designs programmatically. Use when asked to open, inspect, export, analyze, or edit .fig files, or to control the running OpenPencil app.
---

# OpenPencil

OpenPencil provides a CLI and MCP server for `.fig` design files and the running OpenPencil editor.

Use two modes:

- **App mode** — connect to the running OpenPencil editor by omitting the file argument.
- **Headless mode** — work with `.fig` files directly by passing a file path.

```bash
# App mode — operates on the document open in the editor
openpencil tree

# Headless mode — operates on a .fig file
openpencil tree design.fig
```

Use `openpencil --help`, per-command help, and the connected MCP server’s tool schemas to check the installed version’s capabilities. See the [CLI reference](https://openpencil.dev/reference/cli) and [MCP guide](https://openpencil.dev/programmable/mcp-server) for current documentation.

Reuse the configured local installation and discover its live schemas first. Preserve authentication, filesystem scope, model assignments and disabled scripting. Never reinstall/upgrade, enable `eval`, or widen the root merely to bypass a missing capability. Report the exact limitation. Prefer MCP for supported operations; use the installed CLI only when it targets the same artifact under the same permissions.

For visual prototypes/references, use Image Gen when that is the user's workflow; translate the accepted direction into editable OpenPencil components, tokens, layouts and typography. Generated images are references, not editable design or runtime acceptance.

## Requirements

```bash
# CLI
bun add -g @open-pencil/cli

# MCP server used by the desktop app and external MCP clients
bun add -g @open-pencil/mcp
```

The desktop app starts `openpencil-mcp-http` automatically in production Tauri builds when `@open-pencil/mcp` is installed globally and exposes automation on:

- HTTP/RPC: `http://127.0.0.1:7600`
- WebSocket bridge: `ws://127.0.0.1:7601`
- MCP Streamable HTTP: `http://127.0.0.1:7600/mcp`

## CLI Commands

```bash
openpencil --help
```

Common commands:

- `info` — document overview: pages, node counts, fonts
- `tree` — print hierarchy with types and sizes
- `pages` — list pages
- `node` — detailed node properties by ID
- `selection` — current selection from the running app
- `find` — find nodes by name/type
- `query` — XPath selectors for node search
- `variables` — list variables and collections
- `tokens` — variables as a CSS custom-property stylesheet or Tailwind v4 theme
- `export` — export PNG/JPG/WEBP/SVG/PDF/JSX/.fig
- `convert` — convert between supported document formats
- `analyze` — colors, typography, spacing, repeated clusters
- `lint` — consistency, structure, and accessibility checks
- `formats` — supported document/export formats
- `eval` — execute JavaScript with the Figma Plugin API
- `tool` — list, describe, and call any MCP tool from the shell, in app or headless mode
- `documents` — list, open, create, save, close, and activate documents in the running app
- `undo` / `redo` — step back through your own (automation) changes in the running app
- `settings` — read and change editor settings in the running app

### Inspect

```bash
openpencil info design.fig
openpencil tree design.fig
openpencil tree --page "Components" --depth 3  # app mode
openpencil pages design.fig
openpencil node design.fig --id 1:23
openpencil node --id 1:23  # app mode
openpencil selection --json
openpencil variables design.fig
openpencil variables --collection "Colors" --type COLOR
openpencil tokens design.fig --format tailwind > theme.css
```

### Search and XPath query

```bash
openpencil find design.fig --name "Button"
openpencil find --type FRAME                          # app mode
openpencil find design.fig --type TEXT --page "Home"
openpencil find design.fig --name "Card" --type COMPONENT --limit 50

openpencil query design.fig "//FRAME"
openpencil query design.fig "//FRAME[@width < 300]"
openpencil query design.fig "//TEXT[contains(@name, 'Button')]"
openpencil query design.fig "//COMPONENT[@stackMode]"
openpencil query design.fig "//COMPONENT//FRAME//TEXT"
openpencil query "//FRAME[@width > 1000]"             # app mode
```

Common node types: `FRAME`, `TEXT`, `RECTANGLE`, `ELLIPSE`, `VECTOR`, `GROUP`, `COMPONENT`, `COMPONENT_SET`, `INSTANCE`, `SECTION`, `LINE`, `STAR`, `POLYGON`, `SLICE`, `BOOLEAN_OPERATION`.

### Export and convert

```bash
openpencil export design.fig -o hero.png
openpencil export -o hero.png                         # app mode
openpencil export design.fig --node 1:23 -s 2 -o button@2x.png
openpencil export design.fig -f jpg -q 85 -o preview.jpg
openpencil export design.fig -f svg --node 1:23 -o icon.svg
openpencil export design.fig -f pdf -o page.pdf
openpencil export design.fig -f fig -o roundtrip.fig
openpencil export design.fig -f jsx -o component.jsx
openpencil export design.fig -f jsx --style tailwind -o component.tsx
openpencil export design.pen -f storybook -o src/stories --watch  # stories + design images per component, re-exported on save
openpencil export 'src/**/*.pen' -f storybook --beside  # stories next to each design file
openpencil export design.fig --thumbnail --width 1920 --height 1080
openpencil export --page "Components" -o components.png

openpencil convert design.fig -o design.pen
openpencil formats
```

### Analyze and lint

```bash
openpencil analyze colors design.fig
openpencil analyze colors --similar --threshold 10     # app mode
openpencil analyze typography design.fig --group-by size
openpencil analyze spacing design.fig --grid 8
openpencil analyze clusters design.fig --min-count 3
openpencil lint design.fig
openpencil lint design.fig --json
openpencil lint design.fig --fix -o fixed.fig     # bind matching color variables, round to whole pixels
```

In MCP and AI chat, `lint` lists findings with their `fix` and `suggestions`; `lint_fix` applies the safe fixes, and the first suggestion of each finding with `suggestions: true`.

### Eval (Figma Plugin API)

Execute JavaScript against the document using a Figma Plugin API-compatible runtime:

```bash
openpencil eval design.fig -c 'figma.currentPage.findAll(n => n.type === "TEXT").length'

# App mode — modifies the live document in the editor
openpencil eval -c '
  const buttons = figma.currentPage.findAll(n => n.name === "Button");
  buttons.forEach(b => { b.cornerRadius = 8 });
  buttons.length + " buttons updated"
'

# Modify and save to the same file
openpencil eval design.fig -w -c '
  const texts = figma.currentPage.findAll(n => n.type === "TEXT");
  texts.forEach(t => { t.fontSize = 16 });
'

# Save to a different file
openpencil eval design.fig -o modified.fig -c '...'

# Read code from stdin
echo 'figma.currentPage.children.map(n => n.name)' | openpencil eval design.fig --stdin
```

### Diff

Compare nodes and documents, and apply patches:

```bash
openpencil diff create design.fig --from 1:23 --to 1:87       # JSX attribute patch
openpencil diff jsx design.fig --from 1:23 --to 1:87          # JSX structure
openpencil diff show 1:24 design.fig --attributes 'rounded={8}' > fix.diff
openpencil diff apply fix.diff design.fig --dry-run           # fails on stale values
openpencil diff apply fix.diff design.fig --write
openpencil diff visual design.fig --from 1:23 --to 1:87 -o diff.png
openpencil diff files before.fig after.fig                    # exit 1 when different
```

### Control the running app

```bash
openpencil documents list --json                       # tab IDs, paths, pages
openpencil documents open designs/landing.fig          # new tab; --json returns target.documentId
openpencil documents new --path designs/draft.fig
openpencil documents activate tab-123 --page-id 0:4    # bring a tab to the front
openpencil documents save --document-id tab-123
openpencil documents close --document-id tab-123 --save   # or --discard; fails on unsaved changes otherwise
openpencil undo --document-id tab-123                  # also: redo
openpencil settings get --json
openpencil settings set editing.snapping.pixelGrid false
```

`tool` exposes every MCP tool, so the CLI is never limited to its dedicated commands:

```bash
openpencil tool list
openpencil tool describe set_fill                      # JSON Schema for the arguments
openpencil tool call set_fill --document-id tab-123 --args '{"id":"0:5","color":"#2563eb"}'
openpencil tool call create_page design.fig --args '{"name":"Icons"}' --write   # headless
```

Every command that reports structured data supports `--json` when appropriate.

## MCP Server

### Stdio MCP clients

Use Bun by default:

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "bunx",
      "args": ["openpencil-mcp"]
    }
  }
}
```

If `@open-pencil/mcp` is installed globally, direct binaries also work:

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

### HTTP / Streamable HTTP

```bash
export PORT=7600
export OPENPENCIL_MCP_ROOT=/path/to/files     # explicitly limit filesystem access

openpencil-mcp-http
# or: bunx openpencil-mcp-http
```

Authentication is enabled by default with an automatically generated token. `OPENPENCIL_MCP_AUTH_TOKEN` can supply an explicit non-empty token; an empty value disables authentication. If browser access needs CORS, set `OPENPENCIL_MCP_CORS_ORIGIN` to a trusted origin. Never combine wildcard CORS (`*`) with disabled authentication.

The CLI defaults the filesystem root to the home directory on Windows and the current working directory elsewhere. Set `OPENPENCIL_MCP_ROOT` to an explicit narrow directory rather than relying on that default.

### MCP workflow

1. **Find or open a document** — `list_documents` for open tabs and their IDs; `open_file { path }` within the effective filesystem root, or `new_document {}`. Pass `document_id` and `page_id` explicitly instead of relying on the active tab; `activate_document { document_id }` brings a tab to the front when the user should see it.
2. **Query** — `get_page_tree`, `find_nodes`, `query_nodes`, `get_node`, `list_pages`, `get_current_page`.
3. **Inspect** — `get_jsx`, `diff_jsx`, `diff_create`, `diff_visual`, `describe`, `export_image`, `export_svg`, `export_pdf`.
4. **Modify** — `render`, `batch_update`, `update_node`, `set_fill`, `set_layout`, `create_shape`, `import_svg`, etc.
5. **Navigate** — after creating or editing visible canvas content, call `select_nodes` and `viewport_zoom_to_fit { id }` (or `node_bounds` + `viewport_set`) so the user can see the result in the running editor.
6. **Save/export** — `save_file`, `export_image`, `export_svg`, `export_pdf`, or CLI `export`.
7. **Preserve** — keep the canonical working document open. Close only an owned disposable tab or one the user asked to close. `close_file { document_id, unsaved }` fails on unsaved changes by default; save through the canonical owner when appropriate. Never discard unrelated work.

Use bounded queries for only the needed nodes. Author a coherent frame/subtree in one bounded `render` and group property edits with `batch_update`. Structural calls snapshot the affected page for Undo; long per-layer creation loops amplify CPU and retained history memory. Export only the affected frame, inspect the actual render, show it in the editor, then save through the canonical file owner.

If CanvasKit reports `Aborted` or out-of-bounds memory access, stop design writes, navigation and render exports; changing pages does not recover an aborted WASM runtime. Attempt canonical Save once. The native fork can preserve editable FIG data without generating a new preview; its warning means the file was saved, while rendering needs a native app restart. Confirm Save succeeded and verify the saved content before restarting. `close_file` must succeed with its unsaved guard; a saved file followed by new layout mutations can still leave the tab dirty. Preserve the first runtime diagnostic before restarting. An operation timeout can leave work running, so inspect status before retrying. Preserve authentication and file scope; rescue through arbitrary scripting requires separate explicit authorization.

Native FIG packing runs on a Rust blocking worker; this fork enables four Zstd workers for uncompressed design payloads of at least 8 MiB. Smaller payloads use the measured faster single-thread compression path. Saves remain serialized, and this does not parallelize canvas/layout; use bounded batches to reduce their main-thread work.

For unattended sessions, distinguish missing tools, a disconnected bridge and an unfinished document import. A default `Page 1` with no canonical path does not prove an empty design: inspect `list_documents` and loading/error evidence before any write or Save. Screen-off WebViews may suspend display frames and throttle timers; document loading and renderer startup share a MessageChannel task yield without depending on either. Hidden document preparation finishes after the model is ready without claiming the canvas was painted; inspect a real render after returning to the visible editor. If known nodes exist but raster export fails, inspect renderer readiness before treating the document as empty. The bridge retries unexpected graceful/transient closures, but stops after authentication refusal or replacement by another editor. Activate matching native client and MCP server builds together; a replacement server with changed authentication still needs runtime-owner rebinding. CLI discovery must use the same configured private discovery path as the server; a CLI discovery failure alone does not prove the app stopped. Preserve authentication and filesystem scope, and do not restart or discard work solely because of a timeout.

If the native wrapper is alive but MCP disconnects, inspect its WebKit content process and native journal. A memory-pressure kill can remove the content process and bridge while leaving the wrapper running; large host RAM does not prove the WebView has no memory limit. Preserve the latest canonical disk head and recovery storage before replacing a conclusively dead content process. Coordinate with other design writers before reopening, and never overwrite a newer CLI-saved file with an older recovery copy. An allocation-limit error from raster export means reduce scale or select a smaller frame; it does not mean the design is empty. MCP raster limits include descendant overflow and effects. Cache budgets and a short successful run do not establish multi-hour stability.

The native fork recovers an unexpectedly exited app-managed MCP child through its existing runtime owner, preserving configured authentication, root and disabled tools. Recovery is limited to three restarts in five minutes; an explicit Stop or externally managed server is not restarted. After recovery, resolve fresh discovery, tool schemas and the exact document/page before continuing. Do not replay a failed mutation blindly or treat reconnect as proof of a completed edit. If recovery stops, inspect the reported failure rather than loosening permissions or restarting an unsaved document.

For repeated lag or disconnects, discover the fork's read-only `get_runtime_status` and sample it around the failing operation alongside native process memory. `document.nodes` counts materialized layers; lazy pages may remain unloaded. WASM capacity is shared by CanvasKit renderers and is a high-water mark, not live allocation. Resource counts, cache weights and logical backing pixels do not measure total native/GPU memory. An imported population worker is retained while useful and retired after a real edit or transport failure; `populationWorkerRetained: false` is expected and preserves pending-page recovery, not an empty document. Compare repeated operations and idle reclamation before attributing growth to a cache or increasing a memory budget.

Native FIG Save sends a raw binary payload to Rust to avoid expanding design/image bytes into JSON number arrays. Keep the frontend and native binary matched; an unknown binary-save command means incompatible builds, not permission to change authentication or filesystem scope. The transfer has an explicit 512 MiB limit and preserves the existing serialized Rust archive/compression owner.

### Optional design review helper

For a substantial independent analysis/review, discover `agent_dispatch`, `agent_status` and `agent_cancel`. These are optional native fork capabilities, not universal upstream tools. Read [Agent tasks](references/agent-tasks.md) before dispatching. At most one snapshot-only Codex helper runs; the main agent checks the advice and alone applies canvas changes. Small edits stay with the main agent. Never emulate missing dispatch through `eval` or confuse internal Codex subagents with OpenPencil MCP dispatch.

Use `undo` / `redo { document_id }` to step back your own changes. They refuse when the newest step was made by the user in the editor; never work around that. `get_settings` and `update_settings { settings }` read and change editor preferences such as theme, language, and snapping; they never expose credentials, models, or tool access.

### Browser-native WebMCP (experimental)

WebMCP is off by default. In **Settings → MCP → WebMCP**, choose **Inspect** for read-only tools or **Edit** for scoped changes. These controls are independent of local MCP settings. Supporting browsers expose inspection and undoable existing-layer/property and variable edits directly from the OpenPencil workspace through `document.modelContext`, without an MCP server connection. Discover this browser surface separately: it excludes structural creation/deletion, arbitrary JS/JSX execution, external assets, filesystem operations, and credentials.

Calls capture the active document/page. Cancellation prevents an edit from starting but does not reverse an already committed edit; use editor undo instead. This native fork supports atomic edits in documents with at most 20,000 nodes and variables combined, including app AI/MCP; discover the installed version because upstream or older builds can have a lower limit. Group related property edits in one bounded batch: checkpoint and rollback still inspect the complete graph, so repeated single-layer calls remain expensive on large documents. See the [WebMCP guide](https://openpencil.dev/programmable/mcp-server#webmcp) for scope and browser requirements.

## Tool discovery

Users configure local server tools in **Settings → Tool access** → **Local MCP**, independently from **Built-in AI** tool preferences. Local MCP changes require a server restart and stdio client reconnection; built-in AI changes apply to the next message. ACP and Pi agents use the MCP surface, not the direct-model AI tool selection. Tool switches are not a sandbox: enabled scripting tools can still perform operations whose dedicated tools are disabled.

Discover available tools and their arguments from the connected server or browser; availability varies by version and mode. Each tool's schema and execution/exposure metadata are authoritative. Numeric inputs accept numbers or numeric strings consistently, but reject non-finite values. Do not rely on a fixed tool count or a copied inventory.

> Tool availability can depend on server mode. `open_file`, `save_file`, and disk-writing export paths are scoped to the effective filesystem root; set it explicitly with `OPENPENCIL_MCP_ROOT`.

## Key tools for agents

- **`query_nodes`** — XPath selectors to find specific nodes without fetching the full tree.
- **`get_jsx`** — inspect any node as JSX in the same format accepted by `render`.
- **`diff_jsx` / `diff_create`** — compare two nodes as a JSX line diff or as an appliable patch of JSX attributes; `diff_show` previews setting attributes and `diff_apply` applies a patch only if the nodes still match it.
- **`diff_visual`** — pixel diff between two rendered nodes; use it to confirm an edit changed only the intended region.
- **`describe`** — semantic analysis of role, visual style, layout, and design issues.
- **`batch_update`** — apply multiple node updates efficiently.
- **`export_image` / `export_svg` / `export_pdf`** — visual verification and deliverables.
- **`viewport_zoom_to_fit` / `viewport_set` / `viewport_get`** — keep the live editor focused on the created or edited design.
- **`get_codegen_prompt`** — retrieve OpenPencil's current JSX/codegen guidance.
- **`undo` / `redo`** — revert or reapply your newest change; they refuse to touch the user's edits.
- **`list_documents` / `activate_document`** — discover open tabs and show the one you worked on.
- **`agent_dispatch` / `agent_status` / `agent_cancel`** — optional bounded, read-only Codex design review with durable receipts and feedback through a linked new task.

## JSX Rendering

Read [Design authoring](references/design-authoring.md) before creating or modifying JSX designs. This bundled reference is generated from Core's authoring guidance, tested examples, and renderer metadata—the same reference used by chat and codegen prompts.

Use the `render` tool for JSX strings. Use only the APIs exposed by the installed `eval` environment; native library exports are not automatically scripting globals. The connected server's `get_codegen_prompt` provides its version's codegen and authoring guidance.

## Tips

- Omit the file path to work with the document open in the running OpenPencil editor.
- Start with `list_documents`; resolve the exact document path, page and relevant selection before any edit. Pass `document_id` and `page_id` explicitly where supported, then inspect only the needed subtree.
- Use `tree --depth 2` or `query_nodes` to avoid overwhelming output on large files.
- Export specific nodes with `--node` for faster visual checks.
- Use `export_image` after changes to verify visual quality.
- After creating a visible design, select it and zoom the editor to it: `select_nodes { ids: [id] }` then `viewport_zoom_to_fit { id }`.
- If zoom-to-fit is unavailable in a client, use `node_bounds` to calculate the center and call `viewport_set { x, y, zoom }`.
- Use `analyze colors --similar` to find near-duplicate colors.
- Use `openpencil tool call` for MCP tools without a dedicated CLI command. Scripting requires an already enabled, authorized capability; keep disabled `eval` disabled.
- Use `--json` when piping CLI output to scripts.
- In app mode, `eval` and MCP modifications are reflected live in the editor.
