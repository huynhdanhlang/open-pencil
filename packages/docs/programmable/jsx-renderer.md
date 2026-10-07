---
title: JSX Renderer
description: Create editable designs using the same declarative authoring library as OpenPencil agents.
---

# JSX Renderer

OpenPencil's design JSX creates scene nodes, not browser DOM. You can use readable component trees, JavaScript expressions, and reusable functions to construct editable designs.

## Creating Designs

The `render` tool accepts JSX strings in AI chat and MCP. In application or headless library code, import `Frame`, `Text`, and other authoring exports from `@open-pencil/design-jsx`, then create nodes with `renderTree` or `renderJSX` from `@open-pencil/core/design-jsx`, which add icons, SVG conversion, and layout. To write the trees as TSX, set `"jsxImportSource": "@open-pencil/design-jsx"` with `"jsx": "react-jsx"` in `tsconfig.json`, or add a `/** @jsxImportSource @open-pencil/design-jsx */` comment to the file. The scripting environment determines which APIs are exposed to `eval`; package exports are not automatically globals there.

The [shared design-authoring reference](../reference/design-authoring) contains executable examples, layout guidance, and the supported syntax inventory. It is generated from the same source used by chat, ACP, codegen prompts, and the installable agent skill.

## Elements

Use frames and text for composition, shape nodes for artwork, and real components and instances for reusable editor content. A JavaScript function alone does not create component identity. See the [element inventory](../reference/design-authoring#supported-syntax-inventory).

## Style Props

Use Hug/Fill and flex or grid for content-driven sizing. Bind semantic variables instead of copying values. See [composition and layout](../reference/design-authoring#composition-and-layout), [paint and text](../reference/design-authoring#paint-text-and-artwork), and [variables and components](../reference/design-authoring#variables-and-components).

## Exporting to JSX

```sh
openpencil export design.fig -f jsx                   # OpenPencil format
openpencil export design.fig -f jsx --style tailwind  # Tailwind classes
```

Exported OpenPencil JSX can be edited and rendered back into the document. The export writes hidden and locked layers, constraints, size limits, stacked, gradient, and image fills, strokes, effects, masks, and variable bindings, so rendering an export reproduces them and `diff_jsx` shows changes to any of them. Main component property declarations and representable references are retained in this fork. Rich text with mixed styles, vector paths, layout grids and shared styles remain export limitations. General instances are written as frames with their content and lose their linked master identity and assignments. See [CLI exports](./cli/exporting) and the [component reference](../reference/design-authoring#variables-and-components).

The `get_jsx` tool returns a preview capped at 12,000 characters for inline inspection, with `truncated: true` and `totalLength` when clipped. Supply `path` inside the configured MCP filesystem root to write complete JSX to a file. File output bypasses the preview cap; a truncated response from an older editor is rejected before any file is written. Check the actual file and export limitations before using it for authoring or code generation. A complete text export does not establish native component identity or visual fidelity.

## Visual Diffing

JSX makes structural design changes reviewable as code. Use `get_jsx` and `diff_jsx` to inspect changes, then verify the actual rendered result; a clean structural diff does not prove visual equivalence.
