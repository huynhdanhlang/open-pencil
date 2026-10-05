# Local Linux build

This fork starts at upstream commit
`6a05e30f15398de70d36deda011003b4347d1627`. Upstream still declares version
`0.15.1`, so use the commit and artifact hash to identify a local build.

The local patch normalizes the `fontoxpath` CommonJS import for Node ESM.
Without it, headless XPath queries fail with
`TypeError: evaluateXPathToNodes is not a function` under Node 26.8.2.
The focused regression checks the built export under Node and Bun without
depending on Git LFS fixtures.

FIG saving now records CanvasKit's shaped line positions for newly authored or
layout-edited plain text. Width/height edits invalidate stale imported glyph
layout; glyph cluster offsets are mapped to JavaScript character indices and
shaping uses the CanvasKit instance that owns its font provider. The bounded
path requires a loaded face covering the text, original case, uniform styling,
no variation axes, named-instance axes, truncation, path text or text decoration.
Saving shapes and extracts outlines from the same pinned font buffer, using an
isolated provider so earlier Google font shards cannot mix glyph identities.
This includes imported LIGA/CALT defaults. Providers are reused within an
export and disposed afterward; glyph blobs reuse the existing deduplication map.
Imported glyph geometry stays authoritative until a layout edit.

FIG export reconciles reader checkpoints with live component deletion and skips
pages removed before population. It loads retained pages on the isolated export
graph without changing the live document. The adapter treats missing live roots
as deletion; it does not establish deletion provenance or support for instances
whose main component was removed.

MCP selection and viewport tools now update the actual editor through its
canonical actions. View reads use the canvas dimensions, zoom reports the
applied value, and fitting rejects node IDs from another page. View commands
avoid document layout/font loading and Undo snapshots.

## Build

Install the native prerequisites from upstream's development instructions.
The verified local toolchains are Bun 1.4.2 and Rust 1.99.0 on Linux x86_64.
From the repository root:

```sh
bun install --frozen-lockfile
bun run tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
bun test packages/cli/tests/commands/query.test.ts
bun test packages/core/tests/io/formats/fig/export/text-wrap-export.test.ts packages/fig/tests/source-metadata.test.ts
bun test tests/app/automation/bridge/tool-page.test.ts
```

Keep development test features disabled in the application used for design.
The regression expects package build outputs; the desktop build assembles them.

## Intel launcher

On the verified host, Intel UHD 770 is PCI `0000:00:02.0` and uses i915.
RTX is reserved for AI workloads. Launch the release binary with:

```sh
sh tools/dev/run-intel.sh desktop/target/release/OpenPencil /path/to/document.fig
```

The wrapper sets Mesa's per-process `DRI_PRIME` selector and removes NVIDIA
offload variables. It does not change drivers or system graphics settings.
Inspect the device's PCI address before using this wrapper on another host.
Verify the actual desktop and WebKit processes through `/proc/<pid>/fdinfo`;
an environment variable alone is not proof of which GPU is active.

## MCP and recovery

Build and install desktop, CLI and MCP from the same pinned checkout. Preserve
the existing MCP authentication, private discovery and filesystem scope. Do not
enable eval or broaden access for this update.

For structural design authoring, render a bounded coherent frame/subtree and
batch property changes. Repeated per-layer structural operations snapshot the
affected page for Undo and can amplify CPU and retained history memory. Keep
Undo and recovery enabled. Re-resolve document, page and node IDs after import.

Before switching applications, coordinate with any writer, save through the
canonical file owner and make a checksum-verified backup. Keep the prior binary
and launchers so application rollback does not overwrite the latest design.

## Verification limits

The local native application opened the saved document, connected to MCP and
exported a selected frame. Desktop and WebKit fdinfo confirmed Intel i915.
An archived document also survived a FIG roundtrip with matching page/node
counts. These checks do not prove complete graph equivalence or smooth physical
pan/zoom interactions.

Real CanvasKit regressions cover Vietnamese wrapping and explicit newlines with
ligatures in both the native and full headless runtimes. A private copy of the
actual design retains editable text, declared fonts/widths and wrapped lines
after FIG save/reopen. This does not establish Figma interoperability: a live
Figma roundtrip has not been performed.

Paragraph and saved-outline renders still differ at pixel level: the existing
saved-glyph renderer snaps baselines and uses different antialiasing rules.
Mixed styles, variable axes, fallback fonts, complex scripts and path
text retain the prior serialization path. These patches do not establish that
all typography, icon or navigation/performance bugs are resolved.
