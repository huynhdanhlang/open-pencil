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

For large JSON/image payloads through CLI `tool call`, use `--args-file=/path/to/payload.json` or pipe JSON to `--args-file=-`; discover the exact command syntax with help. The matched fork also accepts `--args-file -`, while older citty-based builds can misparse the separate dash and lose the arguments. An empty path is an error. Keep payload files private and avoid embedding large base64 data in shell arguments or logs.

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
- `tokens` — variables as a CSS custom-property stylesheet, a Tailwind v4 theme, or W3C design token files (`--format dtcg --out <folder>`)
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
openpencil tokens design.fig --format dtcg --out tokens  # W3C design tokens; import_design_tokens reads them back
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

Next to `figma`, scripts get `openpencil`: what OpenPencil adds to the Figma API, in its style. A main component can behave as a Reka UI control, by its own property and slot names:

```bash
openpencil eval design.fig -w -c '
  const set = figma.currentPage.findOne(n => n.type === "COMPONENT_SET" && n.name === "Switch");
  const thumb = set.findOne(n => n.name === "Thumb");
  const behaviour = openpencil.setBehaviour(set, "switch")
    .bindValue("value", "State")      // On/Off guessed from the variant values
    .bindPart("thumb", thumb);        // the frame becomes a slot
  behaviour.states = "Interaction";
  behaviour.missing                    // [] when the control is complete
'
```

`openpencil.behaviourKinds` lists every kind with its values and parts; `openpencil.getBehaviour(node)` reads one (a variant reads its set's); `openpencil.createSlot(frame)` makes a frame a slot. The `set_behaviour`, `get_behaviour`, and `create_slot` tools do the same over MCP, and design JSX writes controls with Reka's element names (`Switch.Root`, `Switch.Thumb`).

Target the node's owning page for `set_behaviour` and `create_slot`. These tools reject mismatched pages so the edit is captured by Undo; `get_behaviour` can inspect another page without changing it.

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

Use bounded queries for only the needed nodes. Author a coherent frame/subtree in one bounded `render` and group property edits with `batch_update`. Structural calls snapshot the affected page for Undo; long per-layer creation loops amplify CPU and retained history memory. This fork shares unchanged owned fields across history revisions and preserves shared binary payloads in subgraph exports and selected-node projections; it never borrows mutable live data into Undo. Undo/Redo reconcile only changed, created or removed nodes; page scans and history Maps still cost memory and time. Subtree duplication, transfer preflight and transfer Undo preserve shared FIG backing buffers inside each isolated forest copy; source-sized buffers can still be retained once per copy, so use a bounded subtree and verify the copied geometry, bindings and saved-file render. Export only the affected frame, inspect the actual render, show it in the editor, then save through the canonical file owner.

On matched builds, queued Undo/Redo and raster exports reject canceled or expired requests before starting. Replay uses one synchronous byte-comparison cache for shared FIG payloads. A replay already started can still finish after a transport timeout: inspect the exact document's history and affected nodes before repeating Undo/Redo. These changes do not establish a total RAM bound or remove all replay/layout/recovery costs.

Import can remap layer IDs. Resolve the exact page and semantic owner/ancestor again after opening a saved file; never reuse IDs from a prior renderer or headless parse without checking them. Duplicate names need an exact ancestor path or component identity, not the first query result.

For text fidelity, inspect the actual live export and Save/import export at the same scale with faithful font status. Plain saved text reuses a cached paragraph only after proving exact glyph geometry against the loaded font; mismatches, unavailable fonts, decorations, path text and complex/blended paints keep their saved outlines. Do not toggle font sizes, change weights or repeatedly Save to hide a raster discrepancy. Report the exact affected node, font status and images so the renderer owner can investigate. New text must have faithful font status and a stable affected export after font resources settle; a first capture during font changes is not Save/import parity evidence. Investigate a stable mismatch rather than accepting approximate raster similarity.

Authored text measurement and drawing now pin the current complete static font face through the same bounded font scope as Save; supplemental-only and variable-font coverage retains the existing renderer route. Font availability alone does not prove identical face selection or pixels. After editing component child positions or text sizing, inspect existing consumer instances: child `x`/`y` and `textAutoResize` synchronize through the existing override guards, while the root instance keeps its page placement. Verify both live instances and Save/import output before accepting the design.

Node-level `dashPattern` also applies to live strokes unless a stroke defines its own pattern; an explicit empty stroke pattern stays solid. Imported retained HUG dimensions constrain child placement as well as visible frame size, including component consumers. Inspect dashed ornaments and centered groups in the affected live and Save/import exports; do not compensate for an import mismatch with extra layer edits.

Instance placement belongs to its occurrence: omitted positioning imports as AUTO, independently of an ABSOLUTE component master in a variant set. Explicit occurrence and nested placement overrides remain authoritative. For nested media instances, verify the instance and image leaf retain their dimensions, image hash and fill behavior after Save/import; an intact image hash with a zero-width instance is a layout defect, not missing media.

If CanvasKit reports `Aborted` or out-of-bounds memory access, stop design writes, navigation and render exports; changing pages does not recover an aborted WASM runtime. Attempt canonical Save once. The native fork can preserve editable FIG data without generating a new preview; its warning means the file was saved, while rendering needs a native app restart. Confirm Save succeeded and verify the saved content before restarting. `close_file` must succeed with its unsaved guard; a saved file followed by new layout mutations can still leave the tab dirty. Preserve the first runtime diagnostic before restarting. On matched builds, `get_runtime_status.diagnostics` reads the existing shared diagnostics owner without exporting or rendering. It reports enablement, the selected storage backend, the last persistence exception name, and at most five recent WASM failures with scrubbed code frames; it excludes error messages and AI events. A memory backend means disk reports may miss the latest failure, so preserve this receipt before restarting. `indexeddb` identifies a selected backend, not a successful durable write. Respect disabled diagnostics; do not enable it silently. An operation timeout can leave work running, so inspect status before retrying. Preserve authentication and file scope; rescue through arbitrary scripting requires separate explicit authorization.

For memory investigation, sample `get_runtime_status` only against the exact document. In matched builds, `rendererScope: "registered-surfaces"` and `renderers` include scene and overlay surfaces; legacy `renderer` alone may describe only an overlay. Read per-surface `layer`, GPU resource-cache usage/limit, retained caches, history and worker retention alongside host process memory. Deduplicate WASM capacity by `wasmModuleId` on builds that report it; older builds can initialize separate modules during concurrent startup, so their shared-heap label is not proof of shared ownership. Capacity is not live allocation. GPU cache bytes are not total GPU/process memory; `null` means unavailable, not zero. When available, `persistence` reports content revision, dirty state, memory-fallback state, `recoveryMemory` archive count/bytes and recovery build/write counters, pending write bytes and failures. `recoveryMemory` has `shared-recovery-store` scope: count it once across documents. It counts only the memory backend's owned archives; pending write bytes exclude IndexedDB serialization copies. These are owner counters, not a measurement of all retained native memory; `null` means unavailable. Lazy page population and layout must not create a content revision or autosave clean content. Keep monitoring read-only while another agent designs: do not export, switch pages, mutate, Save or restart as part of a sample. For an authorized isolated reproduction, use bounded ownership counters first. Full WebKit heap snapshots can themselves abort large editors while serializing the response: the native Inspector UI uses the same backend and client-side chunking does not prevent that allocation. Analyze an existing snapshot offline before requesting another; do not use full heap capture or start/stop heap tracking on the canonical document. A hung event loop instead needs native all-thread stacks before termination. Correlation is evidence for a bounded reproduction, not proof of a leak or a fix. Preserve the configured memory limit until the allocation cause is measured.

Native FIG packing runs on a Rust blocking worker; this fork enables four Zstd workers for uncompressed design payloads of at least 8 MiB. Smaller payloads use the measured faster single-thread compression path. Saves remain serialized, and this does not parallelize canvas/layout; use bounded batches to reduce their main-thread work.

For unattended sessions, distinguish missing tools, a disconnected bridge and an unfinished document import. A default `Page 1` with no canonical path does not prove an empty design: inspect `list_documents` and loading/error evidence before any write or Save. Screen-off WebViews may suspend display frames and throttle timers; document loading and renderer startup share a MessageChannel task yield without depending on either. Hidden document preparation finishes after the model is ready without claiming the canvas was painted; inspect a real render after returning to the visible editor. If known nodes exist but raster export fails, inspect renderer readiness before treating the document as empty. The bridge retries unexpected graceful/transient closures, but stops after authentication refusal or replacement by another editor. Activate matching native client and MCP server builds together; a replacement server with changed authentication still needs runtime-owner rebinding. CLI discovery must use the same configured private discovery path as the server; a CLI discovery failure alone does not prove the app stopped. Preserve authentication and filesystem scope, and do not restart or discard work solely because of a timeout.

If the native wrapper is alive but MCP disconnects, inspect its WebKit content process and native journal. A memory-pressure kill can remove the content process and bridge while leaving the wrapper running; large host RAM does not prove the WebView has no memory limit. Preserve the latest canonical disk head and recovery storage before replacing a conclusively dead content process. Coordinate with other design writers before reopening, and never overwrite a newer CLI-saved file with an older recovery copy. An allocation-limit error from raster export means reduce scale or select a smaller frame; it does not mean the design is empty. MCP raster limits include descendant overflow and effects. Cache budgets and a short successful run do not establish multi-hour stability.

With recovery enabled, the matched fork persists unsaved content even for writable FIG files with autosave off. Recovery follows content revisions, so page/view changes do not create fresh identical exports. It uses the existing recovery store independently of canonical Save; a debounce or enabled preference alone does not prove the latest draft is durable. Verify a stored draft or successful Save before lifecycle changes. Restoring a draft rebases its old revision counter, and a successful Save cleans the protected draft while preserving newer edits. Recovery cleanup failure is reported separately from a confirmed canonical write. Re-enabling recovery protects subsequent edits; explicitly inspect/persist the current draft rather than assuming older disabled-period edits were saved.

Renderer-independent FIG builds run in a short-lived worker in the browser/native editor; headless CLI uses the existing direct codec. The worker receives an isolated graph plus imported-page checkpoint, preserves unopened/internal page content, transfers only its owned result and terminates on success, failure or timeout. Save, autosave and recovery share a per-document build queue. This bounds overlapping exports and releases the temporary encoding heap; it does not make canvas rendering parallel or remove the WebKit process budget. Verify actual process peaks and durable saved bytes before claiming stability or increasing worker counts.

On matched archive-patch builds, Save of an imported FIG rewrites changed records and preserves unchanged archive bytes. Component edits still include dependent instance records, including required unopened pages; slot-content changes that cannot be patched use the existing full export. New documents and explicit renderer-independent exports retain the isolated full-build worker and binary Rust packing. Save still preserves text/font/thumbnail fidelity and serializes with recovery. This reduces unnecessary encoding, not every operation’s peak memory or canvas work. Inspect a successful disk write and cold reopen rather than assuming a patch or a timeout established persistence.

MCP canvas mutations, view commands, Undo/Redo and raster exports share the document allocation lane with FIG builds. Await each bounded operation; do not bypass this scheduling with scripting or start parallel canvas writers. A queued operation may wait for recovery to finish. On large documents, save at useful bounded milestones, inspect actual native process memory, and close/reopen only after successful Save when memory stays high. Worker termination does not remove WebKit's process memory limit.

Image crop mode is `CROP` in the editor API and `STRETCH` in the FIG archive schema; the matched reader/writer maps these names while retaining the image transform. Save/import and exported pixels remain the fidelity check.

This Linux installation uses an owner-authorized maximum of 20480 MiB for the WebKit web process, set by `OPENPENCIL_WEBKIT_MEMORY_LIMIT_MB` in its Intel app launcher. Verify the current process's startup journal and installation policy; other hosts may use different budgets. The Wry patch applies the limit and kill fraction when constructing WebContext before the web process starts. The limit is a kill policy, not measured allocation or a cure for WASM faults; an `Aborted` or out-of-bounds error below it requires its own stack and owner investigation. Preserve document data and compare close/open cycles and idle reclamation when investigating growth. Do not raise this owner's maximum without explicit authorization. File watcher registration is generation-guarded and disposed with its document so a late registration cannot retain or reload a closed editor.

The native fork recovers an unexpectedly exited app-managed MCP child through its existing runtime owner, preserving configured authentication, root and disabled tools. Recovery is limited to three restarts in five minutes; an explicit Stop or externally managed server is not restarted. After recovery, resolve fresh discovery, tool schemas and the exact document/page before continuing. Do not replay a failed mutation blindly or treat reconnect as proof of a completed edit. If recovery stops, inspect the reported failure rather than loosening permissions or restarting an unsaved document.

For repeated lag or disconnects, discover the fork's read-only `get_runtime_status` and sample it around the failing operation alongside native process memory. `document.nodes` counts materialized layers; lazy pages may remain unloaded. WASM capacity is shared by CanvasKit renderers and is a high-water mark, not live allocation. Resource counts, cache weights and logical backing pixels do not measure total native/GPU memory. On archive-patch builds, retiring page population releases the decoded reader session while its worker can remain to serve archive patching. Closing the document releases that worker; transport failure falls back to the owned host archive. `populationWorkerRetained` describes page-loading availability, not every retained worker or total heap. Archive records are indexed as headers and decoded on demand. Resolve the exact loaded page and checkpoint before attributing an empty query to data loss. Compare repeated operations and idle reclamation before attributing growth to a cache or increasing a memory budget.

When the native menu remains but the editor is black, distinguish the parent process from its WebKit renderer. On matched Linux builds, renderer termination opens a native recovery prompt with its reason; Reload returns to durable files/recovery and cannot save dead RAM. Preserve the canonical file and recovery first; edits after their last durable write may be lost. A prompt from an older termination cannot reload or close a recovered renderer. Keep the configured memory cap, Intel GPU selection, authentication and file scope. Where `openpencil-diagnose` is installed, it discovers the pinned executable under desktop or recovery launch units and reports renderer presence separately from MCP responsiveness; process presence alone does not prove health.

Matched pending-page checks query the live FIG session mapping without constructing whole component checkpoints. This removes repeated checkpoint copies, not dependency loading: Save still loads affected component-use pages when needed for cross-page fidelity. Do not skip those pages, discard Undo or infer an OOM cure from a faster predicate.

Native FIG Save sends a raw binary payload to Rust to avoid expanding design/image bytes into JSON number arrays. Keep the frontend and native binary matched; an unknown binary-save command means incompatible builds, not permission to change authentication or filesystem scope. The transfer has an explicit 512 MiB limit and preserves the existing serialized Rust archive/compression owner.

The matched fork's MCP `render` shares canonical replacement/insertion placement with Core and Preview. `replace_id` preserves the old parent, sibling slot and local coordinates, while creating new node IDs; use property tools when identity must survive. Fragment roots are inserted together and reported through `siblings`. Matched MCP builds forward authored JSX unchanged to the editor, where `designVar`/`defineVars` resolve without a server-side tree copy. Older tree transports retain validated compatibility. Authored objects cannot forge the reserved variable envelope. Inspect `boundVariables`, Undo/Redo and saved-file bindings for the affected subtree. Resolve variable IDs/names against the exact document first. If placement or bindings differ from the request, stop writes and inspect matching editor/server builds before retrying; a successful tool response alone is insufficient.

Component structural Undo captures the source page and its dependent instance/component subtrees across pages, sharing unchanged snapshot copies and binary payloads. It preserves unrelated foreign-page content and exact captured IDs/overrides. Synchronization prunes only source-mapped children proven removed by the authored edit/replay, including an emptied nested frame; unresolved imported links and assigned slot content stay intact. Verify a relevant cross-page instance's local geometry, content and bindings after render, Undo/Redo and save–reopen when changing reusable components; inspect its exported render as well as the source component.

On matched builds with scoped component layout, synchronization recomputes edited definitions, their instances and affected auto-layout ancestors, including the old and new containers of a move. Free-positioned unrelated page trees stay outside that work; structural Undo snapshots and the final render still have their own costs. Resumed FIG Save also reconciles nested source deletions before materializing unopened instance pages. Verify the saved instances and actual exported pixels; an offline successful Save alone does not prove font or geometry fidelity.

Matched renders copy only the visible bytes of invalidated glyph/picture caches into their failure-recovery journal, preserving an isolated rollback without duplicating each borrowed FIG archive backing. This bounds that transient copy amplification; structural history, live scene data and raster caches retain their separate costs. Runtime memory evidence still requires the actual edited document and repeated native operations: a successful render or a small fixture does not prove a multi-hour disconnect is fixed.

Matched lazy-page population freezes the complete worker delta in one clone, preserving shared binary backings across created nodes and changed fields. Per-field mutation-journal copies remain a separate cost; this change does not prove a process-memory bound. Inline SVG with explicit numeric `w`/`h` (or `width`/`height`) now uses that rectangular coordinate box for both the frame and path vectors. Verify actual path geometry and cold export; changing only a vector's height after creation does not repair already-scaled coordinates.

Authored JSX/HTML/PEN uses Core's shared authored-layout owner: measure content-sized text, lay out authored roots and necessary ancestors, then settle wrapping height when width changes. Render placement defers this until replacement/order changes are complete. Independent roots on a free canvas stay outside that reflow; imported FIG geometry keeps its own owner. Do not compensate for unsettled text by adjusting unrelated page layers.

Structural Undo captures compare each exact shared byte-view pair once within a synchronous capture, then discard the comparison cache. Later captures still detect in-place payload changes; concurrently mutable shared memory is never cached. Page/dependent-instance/moved-root history coverage remains intact. This reduces repeated binary scans, not the number of retained snapshot maps or every render cost; use runtime phase timings to identify the remaining bottleneck.

Matched readers preserve declared leading, including AUTO, rather than treating a saved baseline height as an explicit pixel line height. That distinction affects paragraph baselines and the exact saved-glyph matcher. Font digest caching follows the actual immutable loaded face buffer, so replacing bytes under the same family/style updates its identity; hashing failures remain visible and can be retried. A faithful font-status report still does not prove hot/cold pixels match: inspect the affected text at the same scale and compare actual exports.

Matched structured-paint validation resolves `fills[i].color` and `strokes[i].color` design variables before cloning the paint; malformed colors, missing/wrong-type tokens and ambiguous names fail during render instead of surfacing only at FIG Save. Prefer exact variable IDs. Generated bindings follow the effective paint source: arrays precede scalar/style aliases, text color overrides fills, and explicit `bind` remains last. Bound paint alpha belongs to the color token: a conflicting explicit paint opacity is rejected. For an independently translucent background, use a separate background Rectangle with a bound Canvas fill and node `opacity={0.78}`, keeping foreground content outside that layer. Do not apply opacity to the content's parent or assume a successful bind/Save preserved the paint alpha. Verify actual nodes and the saved native export.

Matched builds coalesce the displayed layer tree once per animation frame during structural authoring, with immediate synchronization before selection and after graph/page changes. Use coherent bounded renders and grouped property edits; this reduces UI projection work, but full-page Undo snapshots still cost time and memory. Saving suppresses file-watch reload during disk writes and refreshes the suppression timestamp at completion. External reload prepares and publishes the restored page through the editor's page-switch owner. After a timeout, inspect runtime phase, exact nodes and dirty state before retrying; a completed disk write or render can outlive its caller deadline.

During admitted render construction, matched builds defer scene/overlay painting and structural layer-tree projection on the resolved placement page until the complete subtree exists. Selection flushes the layer tree immediately; graph/page changes reset it and disposal cancels pending work. Font-resolution events use the same construction-aware status refresh, so a batch of font notifications does not rescan the whole page once per notification; actual font resolution remains live. Graph edits, layout and Undo continue through their existing owners. `automationRender.paintDeferrals` and `layerTreeDeferrals` count skipped paint and tree-refresh checks; `paintMs` reports actual surface paint count/total/max milliseconds by step and layer. These measure presentation work, not live memory or all Vue work. Page changes and failure release the paint gate; do not emulate this mechanism by switching tabs or running Eval.

On matched builds with scoped layout-property transactions, dedicated single-node fill/layout/constraint tools use the same bounded property capture as `update_node`, retaining Undo/rollback and the 20,000-affected-node ceiling without copying unrelated pages. Discover schemas: `set_layout_child` supports `align_self`, while `batch_update` does not. Cross-axis `FILL` sets STRETCH for Text/Rectangle as well as containers; primary-axis FILL sets grow. Explicit alignment/grow overrides in the same request take precedence. Complete JSX export preserves cross-axis Fill for AUTO row/column children; verify source, resized instances and saved/imported pixels at the intended widths. Do not widen limits or use Eval to bypass an older editor's transaction error.

Generated nested Frames/Components must resize their painted bounds as well as their leaves. Saved FIG cross-axis Fill can appear as FIXED sizing with STRETCH alignment; inspect both fields with `layout_context`, rather than treating the sizing flag alone as a lost binding. Parent-owned grow/stretch dimensions use computed geometry even when a generated container retains an intrinsic `derivedLayout`; an orthogonal Hug dimension keeps its cache. Verify source, enclosing instances, and an exported PNG after full save/reopen at both large and mobile widths. A correct leaf width or `w="fill"` JSX alone does not establish nested background fidelity. Imported FIG geometry guards remain a separate limit.

Explicitly resizing a loaded auto-layout instance recomputes that instance's layout; initial imported geometry stays preserved until an intentional size edit. Page population retains saved instance-root dimensions and derived child bounds without inventing size-edit markers. Genuine live master edits still propagate per axis; root variable bindings remain active. Resuming a page adopts only children still owned by their archived parent, so a moved/deleted master is not reattached during Save. Check the exact nested children after resize: imported frame/line geometry guards still apply, so this does not establish every nested FIG hierarchy's responsive fidelity.

Existing instance children inherit source grow, self alignment and positioning unless explicitly overridden. These child-flow fields do not replace the root instance's placement in its outer container. Verify an instance that existed before the source edit; creating a fresh instance alone cannot establish synchronization.

When sizing differs from the render, use `get_node` with bounded `depth` and `layout_context: true` on the exact node. The optional context reports actual axis modes, grow/alignment/positioning, parent mode, source edit markers and retained derived geometry for that node only. It is read-only and omitted by default; a successful setter receipt alone is not responsive verification.

Closing a document also detaches its library-catalog binding and releases owned CanvasKit typeface/vector-overlay handles. An initialized AI chat flushes its transcript and releases its transport before editor disposal; a failed transcript or recovery write keeps the tab open and retryable. Other open documents retain their bindings and history. After reopening, resolve a fresh document/page target even when the file path is the same; its new editor identity starts a fresh transport with the persisted transcript, subject to the backend's existing resume policy. A successful close is bounded lifecycle evidence, not proof of total native memory reclamation.

Chat-turn Revert tracks only a fresh direct-model tool run belonging to the same chat and document. ACP/Codex replies do not inherit an earlier direct run's Undo entries; use the dedicated scoped `undo`/`redo` tools for your own MCP changes. Completed or interrupted direct runs release their baseline/entry capture after the turn handoff. Chat references entries weakly: the Undo/Redo manager owns replay data, so evicted entries cannot remain alive solely for old chat replies. Closing a document releases its turn records and rejects late reply retention, while other documents keep their history.

### Optional design review helper

For a substantial independent analysis/review, discover `agent_dispatch`, `agent_status` and `agent_cancel`. These are optional native fork capabilities, not universal upstream tools. Read [Agent tasks](references/agent-tasks.md) before dispatching. At most one snapshot-only Codex helper runs; the main agent checks the advice and alone applies canvas changes. Small edits stay with the main agent. Never emulate missing dispatch through `eval` or confuse internal Codex subagents with OpenPencil MCP dispatch.

Use `undo` / `redo { document_id }` to step back your own changes. They refuse when the newest step was made by the user in the editor; never work around that. `get_settings` and `update_settings { settings }` read and change editor preferences such as theme, language, and snapping; they never expose credentials, models, or tool access.

### Browser-native WebMCP (experimental)

WebMCP is off by default. In **Settings → MCP → WebMCP**, choose **Inspect** for read-only tools or **Edit** for scoped changes. These controls are independent of local MCP settings. Supporting browsers expose inspection and undoable existing-layer/property and variable edits directly from the OpenPencil workspace through `document.modelContext`, without an MCP server connection. Discover this browser surface separately: it excludes structural creation/deletion, arbitrary JS/JSX execution, external assets, filesystem operations, and credentials.

Calls capture the active document/page. Cancellation prevents an edit from starting but does not reverse an already committed edit; use editor undo instead. The matched native fork scopes canonical `update_node` and the dedicated single-node layout/constraint tools described above to the fields and layout nodes they actually change, capped at 20,000 affected nodes; a large materialized document can accept a bounded update. Other atomic property, variable and batch tools retain the 20,000 total nodes-and-variables checkpoint limit, including app AI/MCP. Discover the installed version before relying on this distinction. A committed event-delivery error leaves a usable Undo entry: inspect the affected node/history before retrying. Group related property edits in one bounded batch: checkpoint and rollback still inspect the complete graph, so repeated single-layer calls remain expensive on large documents. See the [WebMCP guide](https://openpencil.dev/programmable/mcp-server#webmcp) for scope and browser requirements.

## Tool discovery

Users configure local server tools in **Settings → Tool access** → **Local MCP**, independently from **Built-in AI** tool preferences. Local MCP changes require a server restart and stdio client reconnection; built-in AI changes apply to the next message. ACP and Pi agents use the MCP surface, not the direct-model AI tool selection. Tool switches are not a sandbox: enabled scripting tools can still perform operations whose dedicated tools are disabled.

Discover available tools and their arguments from the connected server or browser; availability varies by version and mode. Each tool's schema and execution/exposure metadata are authoritative. Numeric inputs accept numbers or numeric strings consistently, but reject non-finite values. Do not rely on a fixed tool count or a copied inventory.

> Tool availability can depend on server mode. `open_file`, `save_file`, and disk-writing export paths are scoped to the effective filesystem root; set it explicitly with `OPENPENCIL_MCP_ROOT`.

## Key tools for agents

- **`query_nodes`** — XPath selectors to find specific nodes without fetching the full tree. Target `document_id` and `page_id`; in the matched fork, omitting the optional `page` name queries that exact page even when names repeat. An explicit `page` name retains name-based matching. Exact bare type paths (`//TEXT`, `//COMPONENT`, `//*`) with a positive finite `limit` walk directly in document order and stop at the requested count, without projecting the complete page into XPath wrappers. Predicates, other axes, namespaces and sequence expressions retain full XPath semantics; their limit bounds results, not all evaluation work. Prefer a small bare type query when that answers the question, then inspect only those IDs. Generic XPath uses query-local sibling positions to avoid repeated linear sibling scans. Neither optimization removes lazy-page materialization or font/layout preparation in the app bridge.
- **`get_components`** — use a small `limit` and `source: "document"` when only local component identities are needed. The matched fork stops document traversal at the limit, including internal imported component pages; `limit: 0` returns immediately. Enabled-library enumeration has separate costs. Results retain the existing traversal-prefix and final sorting behavior.
- **`get_node`** — supply the smallest useful `depth` (`0` for node properties); the default recursively serializes descendants.
- **`get_jsx`** — inspect a node in `render` syntax. Inline output over 12,000 characters is a truncated preview; never render it or treat it as a complete export. In a matched version with the file-output fix, supply `path` inside the configured root for complete text. Older editors truncate even with `path`; check `truncated`, closing tags and parse the actual file. Do not change auth/root or restart an active editor to obtain an export. Main component property declarations and representable references are retained in this fork; general instances become frames and lose their linked identity/assignments. Vector paths, mixed text styles, layout grids and shared styles remain export limitations. Use native clone/reparent for editable fidelity and actual raster exports for visual evidence.
- **`diff_jsx` / `diff_create`** — compare two nodes as a JSX line diff or as an appliable patch of JSX attributes; `diff_show` previews setting attributes and `diff_apply` applies a patch only if the nodes still match it. Supported aliases such as `fontSize`/`size` and `width`/`w` share one patch identity. Preview emits canonical names and old values; retain those removals for stale-state checks. Contradictory aliases fail. An old alias-only addition cannot overwrite an existing canonical value unless explicitly forced; reread the node and regenerate the patch instead of routinely using `force`.
- **`diff_visual`** — pixel diff between two rendered nodes; use it to confirm an edit changed only the intended region.
- On matched builds, changing a paint/scalar attribute through `diff_apply` replaces its inherited variable binding; unrelated bindings remain. A patch that explicitly changes `bind` retains explicit binding precedence. Inspect both actual paint and token ID. INSTANCE `properties` assignments fail explicitly until supported; use bounded native instance authoring and verify assignments rather than interpreting `unchanged` as success.
- For multiline text in JSX diff attributes, use an expression such as `text={"First\nSecond"}` with correct JSON transport escaping. JSX quoted `text="First\nSecond"` contains a literal backslash-n. Preserve `diff_show` removals and do not blanket-unescape intentional backslashes.
- Matched `bind_variable`/`unbind_variable` edits use scoped Undo for the exact `node_id`, binding fields and nearest/outer instance overrides. They retain the affected-node ceiling and do not lift limits for other tools or variable-table mutations.
- **`describe`** — semantic analysis of role, visual style, layout, and design issues.
- **`batch_update`** — group supported property updates into one call. The matched fork prepares fonts only for returned changed roots and their descendants. Validation and one layout pass do not remove the before/after page Undo snapshots: large-page batches can still take seconds. Preserve Undo and recovery; do not describe this document mutation as a full-graph atomic transaction.

For `diff_apply`, `reparent_node`, `combine_as_variants`, `create_component` and `create_instance`, the matched fork prepares fonts from actual graph mutation roots, compacted so overlapping descendants are traversed once. This includes all added diff roots and changed linked instances rather than relying on the first returned ID. Snapshot byte comparisons use exact visible Uint8Array bytes in chunks; floating-point and other value types retain existing equality semantics. These optimizations preserve Undo and do not establish a universal latency or memory bound.

Queued MCP tools can expire before starting and release their pending operation. Once a mutation starts, caller cancellation does not roll it back or skip Undo completion. For tools other than acknowledged render/Save, an RPC timeout still leaves completion unknown: inspect exact affected IDs before retrying.

On matched builds, render and `save_file` acknowledge a document operation before work starts. Fast calls return their usual result. If work exceeds the 20-second transport wait, the response is explicitly `status: pending` with `operation_id` and exact `document_id`; this is not a successful Save or a failed render. Call `get_operation_status` with those IDs to retrieve the final response/error. Do not submit the operation again. Status reads do not load pages. `cancel_operation` cancels waiting/preparation only; a started mutation/write finishes safely. Operation admission has a bounded three-minute deadline, distinct from the short transport wait. At most one operation runs per document; four completed, owned results are retained for 30 minutes, at most 512 KiB each. A closed/replaced document or process exit can make a receipt unavailable; preserve content and inspect the actual document instead of guessing completion. Larger successful results explicitly report `result_unavailable` and require document inspection. Older app/bridge combinations without acknowledgement retain the ordinary timeout behavior.

MCP Save uses the document's existing FIG lane for admission through commit, without importing an RPC-selected offscreen page solely to save. Expired queued Saves do not build, retarget or write; started Saves preserve the captured revision and complete their write. Component dependency lookup reads canvas records without allocating canonical ZIP image/thumbnail/metadata payloads. Legacy archives keep their original canvas-selection policy. These bounded changes do not establish elimination of native memory peaks.

During performance investigation, avoid loading a second large document into the live design editor's shared WebKit process. Use isolated headless measurements and small owned native fixtures, and keep the canonical writer working until a brief clean-only installation cutover. A WebKit policy exit proves the configured process-footprint threshold was exceeded, not which owner leaked; preserve saved content/recovery and distinguish process memory from WASM capacity, caches and retained-object counts.

- **`export_image` / `export_svg` / `export_pdf`** — visual verification and deliverables.
- **`viewport_zoom_to_fit` / `viewport_set` / `viewport_get`** — move the user's view only when they ask to be shown something.
- **`get_codegen_prompt`** — retrieve OpenPencil's current JSX/codegen guidance.
- **`undo` / `redo`** — revert or reapply your newest change; they refuse to touch the user's edits.
- **`list_documents` / `activate_document`** — discover open tabs and show the one you worked on.
- **`agent_dispatch` / `agent_status` / `agent_cancel`** — optional bounded, read-only Codex design review with durable receipts and feedback through a linked new task.

Receipt support requires the updated MCP client as well as the editor/bridge. Old long-lived stdio clients keep ordinary timeout behavior so they cannot misreport a pending Save as `saved: true`. Discover `get_operation_status`/`cancel_operation` before relying on receipts; use a fresh configured client when those tools are absent, without changing authentication or filesystem scope.

After a durable write, Save releases the FIG lane before awaiting recovery cleanup. Superseded queued recovery builds are cancelled before allocating another full FIG; started work settles, and newer unsaved drafts remain protected. A pending Save can already have written the file—retrieve its result rather than repeating or closing it to guess completion.

## JSX Rendering

Read [Design authoring](references/design-authoring.md) before creating or modifying JSX designs. This bundled reference is generated from Core's authoring guidance, tested examples, and renderer metadata—the same reference used by chat and codegen prompts.

On matched builds, authored insertion/replacement into auto-layout reflows direct unrotated imported FRAME/LINE siblings and records their moved coordinates for Save/import. Their imported sizes, absolute/hidden children and baked INSTANCE boundaries remain protected; ordinary cold import retains stored geometry. Verify final sibling order and positions rather than adding manual offsets preemptively. This scoped layout behavior does not reduce the page Undo snapshot or establish a memory bound.

On matched native builds, the first semantic edit retires the obsolete FIG population reader immediately. Its shared worker keeps archive operations for Save; pending page loads fall back against the edited graph. `populationWorkerRetained: false` indicates the population lane retired, not that all worker, archive or decoded host memory was freed. Preserve Undo, recovery and original archive ownership; do not force worker termination to save memory.

On matched builds, loading every visible archive page retires both the worker population mirror and a direct/fallback host reader's decoded archive, even if hidden resource pages remain. Hidden recovery keeps original bytes and the final checkpoint; only all-archive-pages completion releases those bytes. Host-owned hidden resources resume through the same import boundary; worker-only recovery does not start a competing host reader. Deleted loaded component descendants remain omitted in both resumed and recaptured checkpoints. Archive patching keeps its archive owner. This removes retained reader owners, but does not guarantee immediate WebKit RSS reduction or eliminate allocation peaks during population, Save or render.

Matched workers publish page-population deltas through the MessagePort snapshot directly, avoiding an extra full-response copy before transport. Direct reader/export callers still receive owned copies; imported source buffers are never transferred or detached. This reduces one allocation phase, not all document hydration, layout, rendering or timeout costs. A timed-out request may still complete: inspect the exact document status before retrying.

On matched builds, allow one `render` at a time per document. The bridge cancels expired work before it starts and releases queued JSX/tree payloads; a render that has already started may finish normally. After a timeout, inspect `get_runtime_status.automationRender` on the exact document: `preparing`, `queued` or `running` means wait, `completed` means inspect the result before authoring again, and `failed` means inspect affected nodes and Undo because partial committed edits are possible. `expired` with `startedAt: null` means this request did not start a mutation. `stepMs` reports numeric timings for `snapshot-before`, `construction`, `fonts`, `layout-sync`, `snapshot-after` and `undo-commit`; `queueWaitMs` includes preparation and admission. These describe the latest request only, and construction includes icon waits and intermediate component sync. Scoped font preparation and free-page layout avoid scanning unrelated roots, while structural Undo still captures the affected page and dependencies. Request IDs identify bridge work, not a node; no returned node ID after timeout does not prove that nothing was created. Never retry blindly or undo unrelated work. If this metadata is unavailable on an older connection, use bounded node/history inspection and report the uncertainty.

On matched builds, `workMs` records synchronous font-status and design-check counts/total/max milliseconds by render phase. Canvas paint and layer-tree deferral counters show that batching ran; they do not prove it made the request faster. Font-status node invalidations are coalesced through admitted construction; graph/page/font-resolution events and user font actions still refresh immediately. Compare the same recipe, resolved references, page, visibility and node delta before claiming a speed improvement. A shorter render does not establish the cause or elimination of long-run native memory growth.

Render a coherent bounded subtree and use its actual parent/replacement IDs. Direct children of a free canvas now lay out their own roots; nested parents still lay out their siblings and ancestors. Undo/history, dependency hydration and final painting retain their own costs, so do not infer end-to-end speed or sustained memory stability from construction timings. Runtime status reads already-materialized content without loading an unshown page.

Use the `render` tool for JSX strings. Use only the APIs exposed by the installed `eval` environment; native library exports are not automatically scripting globals. The connected server's `get_codegen_prompt` provides its version's codegen and authoring guidance.

For editable controls, inspect native property declarations and references together. Keep BOOLEAN/TEXT/SLOT IDs and defaults stable; use Root `parts` to bind existing named slots, including implicit containers. A Checkbox's `modelValue="Checked"` names a property, not a literal checked value. General instance JSX remains flattened: do not use it as proof of retained master identity, assignments, swaps or custom slot contents. Save the native `.fig` and verify generated application interaction separately.

Native control masters nested inside another component retain their own instance/slot ownership during FIG import on matched builds. A `Missing component` error can also indicate an unmapped nested instance owner even when its source master exists in the archive. Preserve the saved archive and last good preimage; do not save a failed lazy page load over them or flatten controls to bypass the error. Verify cold import of the source and placed instances, text assignments, native roles, and checkpoint/recovery along with exported pixels.

On matched versions, `get_node` with `depth: 0` returns native component definitions/references and instance component IDs/assignments. `expose_instance_swap` returns the created definition in `property`; use its ID and the discovered assignment API, then re-query after Save/import because node handles may change. `design_to_component_map` reports page-local instance counts and `instanceCountScope: "page"`; zero on the source page does not establish zero document consumers.

On matched versions, JSX creation/initial layout failures clean invocation-owned layers. A rollback conflict retains unrelated content and reports containing IDs: re-query them and the original target before any retry. A disconnect or later placement/persistence failure does not prove an unchanged document. Keep Undo and recovery; group coherent authoring operations instead of repeatedly rebuilding the same subtree.

If SVG succeeds but PNG fails, inspect the raster error stage. A missing renderer, allocation failure, or encoding failure is not evidence of hidden/deleted layers. Activate the exact document when its renderer is unavailable, then retry only the affected bounded frame; preserve unsaved work on a disconnect.

## Tips

- Omit the file path to work with the document open in the running OpenPencil editor.
- Start with `list_documents`; resolve the exact document path, page and relevant selection before any edit. Pass `document_id` and `page_id` explicitly where supported, then inspect only the needed subtree.
- Use `tree --depth 2` or `query_nodes` to avoid overwhelming output on large files.
- For selection-focused work, discover `get_selection` and request only the needed `depth`; matched builds return a compact subtree rather than every node property. Selection-scoped MCP connections deliberately restrict reads and file output. Treat that denial as a permission boundary; do not widen the configured scope to bypass it.
- Export specific nodes with `--node` for faster visual checks.
- Use `export_image` after changes to verify visual quality.
- The running editor shows each MCP session as an agent at the layers its tools touch, and follows it while it works when the user has Follow agents on. Leave the user's selection and view alone unless they ask to be shown something.
- Use `analyze colors --similar` to find near-duplicate colors.
- Use `openpencil tool call` for MCP tools without a dedicated CLI command. Scripting requires an already enabled, authorized capability; keep disabled `eval` disabled.
- Use `--json` when piping CLI output to scripts.
- In app mode, `eval` and MCP modifications are reflected live in the editor.
