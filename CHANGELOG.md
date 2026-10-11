# Changelog

## Unreleased

## 0.16.0-beta.1 — 2026-10-11

This is a pre-release: npm packages are published under the `next` tag, and installed apps on the stable release do not update to it. Linux package managers see `0.16.0-beta.1` as newer than `0.16.0`, so `.deb` and `.rpm` users should remove the beta before installing the final 0.16.0.

### Breaking changes

- `diff_apply` directly edits only the current page unless `page_ids` explicitly includes the other pages; component propagation across pages remains automatic. In-app AI turns retain their current-page history boundary; grouped multi-page edits use MCP.

- `FontFallbackScript` includes `'emoji'`, and `SkiaRenderer.nodeFontReadiness` can return `'partial'` when the requested faces are loaded but glyph coverage is still resolving or unavailable.
- In scripts, a text node's `fontSize`, `fontName`, `fontWeight`, `fills`, `letterSpacing`, `lineHeight`, and `textDecoration` read `figma.mixed` while its characters differ, as in Figma, instead of the text's first value, and setting one restyles every character instead of only characters without a style of their own. `fills` is typed `readonly Fill[] | symbol`, so scripts that index it narrow it first.
- `SceneNode` from `@open-pencil/scene-graph` has `textParagraphs`, `listSpacing`, `paragraphSpacing`, `paragraphIndent`, and `hangingList`, so code that builds `SceneNode` objects itself must include them. `SkiaRenderer.buildParagraph` returns a `TextLayout`, which answers the `Paragraph` queries the renderer and text editor use for the whole text and draws with `draw(canvas, x, y)`, instead of a CanvasKit `Paragraph`.
- `AUTO_LAYOUT_BREAK_THRESHOLD` is removed from `@open-pencil/core/constants`: a layer dragged out of auto layout now leaves by how far its own edge is past the frame, not by a cursor margin.
- `SceneNode` from `@open-pencil/scene-graph` has `targetAspectRatio`, the size whose proportions a locked layer keeps, so code that builds `SceneNode` objects itself must include it.
- `useFlatReorderDrag` from `@open-pencil/vue` takes `operations`, which drops each target accepts, and `onCombine`, for dropping onto an item, and `FlatReorderInstruction` is now any list-item `Instruction`, so it can be `'combine'` when a list opts in; code that switches on its `operation` needs that case.
- The editor `Tool` type from `@open-pencil/core` and `@open-pencil/vue` includes `'COMMENT'`, and `EDITOR_TOOLS` and `TOOL_SHORTCUTS` list the Comment tool on <kbd>C</kbd>, so a `Record<Tool, …>` needs a `COMMENT` entry and toolbars built on `ToolbarRoot` show it. The canvas places nothing while it is active; the app's comments layer does.
- A paint's `gradientTransform` follows Figma's convention everywhere: it maps the layer's unit square onto gradient space, where a linear gradient runs from (0, 0.5) to (1, 0.5). Gradients made in OpenPencil before this release, which used the inverse, draw differently; code that builds gradients by hand should use `linearGradientTransform` and `ellipticalGradientTransform` from the new `@open-pencil/scene-graph/gradient`, which also has Figma's default transform and stops. `isGradientFill` and `GradientFillType` moved there from `@open-pencil/core/geometry`, and `linearGradientEndpoints` is removed from the canvas module.
- `useStrokeControls` from `@open-pencil/vue` acts on the whole selection: `updateAlign`, `selectSide`, and `updateBorderWeight` no longer take a node, and `currentAlign()` and `borderWeight(side)` read the selection and return `MIXED` when it differs. `useEffectsControls().scrubEffect` and `commitEffect` no longer take a node. `useTypography` edits every selected text layer and adds `nodes`, `merged`, and `fontFeature`. The `panels.layersCount` message is now `panels.selectedCount`.
- The app renders `render` JSX itself and no longer accepts the pre-rendered tree that earlier versions of `openpencil-mcp` send, so an older `openpencil-mcp` fails to render into this app version; update it with the app.
- `VectorizedPath` from `@open-pencil/core/vector` replaces `clipNetworks` with `clips`, each the clip path's `id` and one network per clip shape, and adds `elements`, the groups and shape a path was drawn from. `SVGVectorizeResult` adds `texts`, the SVG's text placed in the target space, and `SVGImportData` from `@open-pencil/core/io` adds the root `name` and whether the SVG is `sized`.
- `@open-pencil/scene-graph/layout-guides` is now `@open-pencil/scene-graph/layout`, which also exports the per-axis sizing helpers and the auto layout keyword parsers; `layoutGuideLines` and `layoutGuideSections` are unchanged.
- `SceneNode` from `@open-pencil/scene-graph` has `isExposedInstance`, whether an instance inside a component shows its properties on instances of that component, so code that builds `SceneNode` objects itself must include it. In the plugin API, `isExposedInstance` and `exposedInstances` follow that flag and Figma's rules instead of treating an instance whose swap is bound to a property as exposed: only an instance in a component's own layers whose component has properties can be exposed, and its copies in instances report it but cannot change it.
- `usePosition` from `@open-pencil/vue` reports and edits `x`, `y`, and `rotation` as Figma's properties panel does: the turned layer's box on the canvas, measured from its frame or page, and its counterclockwise angle. `getDefaultCanvasBgColor` and `CANVAS_BG_COLOR_DARK` are removed from `@open-pencil/core/constants`; new pages use `PAGE_DEFAULT_BACKGROUNDS`, keyed by interface theme.
- `SkiaRenderer.hitTestFrameTitle` no longer takes the selected IDs: it finds the name of any frame on the page or in a section under a point, selected or not.
- `SceneNode` from `@open-pencil/scene-graph` has `strokeWeight` and `strokeAlign`, the stroke weight and alignment a layer keeps without strokes, so code that builds `SceneNode` objects itself must include them. `SECTION_DEFAULT_FILL` from `@open-pencil/core/constants` is replaced by `SECTION_DEFAULT_FILLS`, keyed by interface theme.
- `SceneNode.booleanOperation` is a required key whose value may be `undefined`, like every other scene node field, so code that builds `SceneNode` objects itself must include it.
- `useVariables().collections` from `@open-pencil/vue` returns copies of the document's collections instead of the graph's own objects, so components see modes added or renamed in place; change collections through the editor's actions rather than by mutating the returned objects. `addVariable` returns the new variable's ID.
- `useVariablesEditor`, `useVariablesTable`, and `useVariablesDialogState` are removed from `@open-pencil/vue`, together with the `formatModeValue`, `parseVariableValue`, and `shortName` helpers `useVariables()` returned for them, and the package no longer depends on `@tanstack/vue-table`. Build variable editors on `useVariables()` and the editor's variable actions.
- The editor's shared state has a required `canvasVersion`, which the canvas redraws on; `sceneVersion` still counts every document change. Code that creates editor state itself must set it, and code that bumped `sceneVersion` to redraw the canvas calls `requestRender()` instead; `requestRefresh()` records a change the canvas does not draw.
- `sceneNodeToDesignDocument` from `@open-pencil/dom-css` takes an options object, `{ includeSourceIds, tokens }`, instead of a boolean third argument; `tokens: false` writes literal values instead of variable references.
- `randomHex`, `randomInt`, and `randomIndex` moved from `@open-pencil/core/random` and the `@open-pencil/core` barrel to `@open-pencil/scene-graph/random`.
- `Stroke` from `@open-pencil/scene-graph` extends `Fill`, so every stroke states a paint `type` that code constructing one must set to `'SOLID'`, and `copyStroke` deep-copies the paint fields a fill already copied.
- The `design_to_tokens` AI and MCP tool writes a stylesheet of CSS custom properties built from the document's variables. Its `tailwind` format is a Tailwind v4 `@theme` instead of a JavaScript object, and the `json` format is removed. Names come from the variable's code syntax or from Tailwind namespaces (`--color-gray-50`) instead of the collection name, aliases stay `var()` references instead of resolving through the first mode, and non-default modes go under their condition (`[data-theme="dark"]` by default) instead of a class named after the mode. The result lists the tokens it left out under `issues`.
- The editor state's `remoteCursors` is now `presenceCursors`, typed `PresenceCursor[]` from `@open-pencil/core/canvas`, and each cursor has a `kind` of `'person'` or `'agent'`.
- `VariableBinding` and the `colorVariableBinding` paint field are gone from `@open-pencil/core`, `@open-pencil/core/kiwi`, and the Kiwi `Paint` type. `fig.kiwi` never defined the field, so only `.fig` files OpenPencil itself wrote before `colorVar` contain one; reopening such a file leaves the paint's colour unbound, and binding it again records it the way Figma does.
- `encodeNodeChangeWithVariables`, `encodePaintWithVariableBinding`, and `encodeVarint` are removed from `@open-pencil/core` and `@open-pencil/core/kiwi`. They spliced a colour-variable binding into encoded bytes because the field had no schema entry; exports now write `colorVar`, which `fig.kiwi` defines, so nothing needs them. `parseVariableId` is unchanged.
- The desktop app now requires macOS 13 or later; the web app supports Chrome 111, Edge 111, Firefox 128, and Safari 16.4 or later.
- `.fig` reading moved to one reader, so the previous importer's exports are gone. `importNodeChanges` (`@open-pencil/core` and `@open-pencil/core/kiwi`) and `importClipboardNodes` (`@open-pencil/fig/clipboard`) are replaced by `parseFigFile` and `parseFigmaClipboard`; `populateLazyFigImportRoots` and `populateAllLazyFigImportRoots` (`@open-pencil/core/kiwi`) are replaced by `populateFigPage` and `populateAllFigPages` on `@open-pencil/core/io/formats/fig`; `populateAndApplyOverrides` (`@open-pencil/fig/instance-overrides`) is replaced by `interpretInstance` with `materializeInstance`. `FIG_PACKAGE_STATUS` now reads `document-reader`, and `assertFigPackageReady()` is gone, because `@open-pencil/fig` reads an archive into a SceneGraph itself rather than directing callers to Core.
- `sceneNodeToJSX` and `selectionToJSX` in `@open-pencil/core` produce only OpenPencil JSX, and `JSXFormat` and `JSXExportOptions` are removed. For Tailwind JSX, use `sceneNodesToTailwindJSX(graph, nodeIds)` from `@open-pencil/dom-css` or the browser-safe `@open-pencil/dom-css/export`.
- Color conversion and management and text/layout direction helpers moved from `@open-pencil/core/color` and `@open-pencil/core/text` to `@open-pencil/scene-graph/color` and `@open-pencil/scene-graph/text-direction`, and `@open-pencil/core/bytes` is removed in favor of `js-base64`; the `@open-pencil/core` root exports are unchanged. `@open-pencil/dom-css` no longer requires `@open-pencil/core`, and `exportHTMLBundle` takes a font resolver in `fonts` instead of `'assets'`; pass one built on `exportWebFontFaceAssets` from `@open-pencil/core/text/web-font/assets` to keep font files in standalone exports.
- Design JSX moved from `@open-pencil/core` to the new `@open-pencil/design-jsx` package, which depends only on `@open-pencil/scene-graph`. Import elements, paint and effect helpers, variables, `JSX_REFERENCE`, `buildComponent`, `sceneNodeToJSX`, and `selectionToJSX` from `@open-pencil/design-jsx`; `@open-pencil/core/design-jsx` now exports only `renderJSX` and `renderTree`, which render with OpenPencil's icons and layout. The `@open-pencil/core` root keeps `renderJSX` and `renderTree` and drops the other design JSX exports, `renderTreeNode` is removed in favor of `renderTree`, and the `@open-pencil/core/io/formats/jsx` subpath is removed.
- `diff_create` and `diff_show` patches list changed JSX attributes per node, such as `-rounded={8}` and `+rounded={12}`, instead of `key: value` property lines, so they cover every property the JSX export writes and report reordered children as moves. `diff_show` takes JSX attributes in `attributes`, such as `w={200} bg="#FF0000"`, instead of a JSON `props` object, and patches in the old format no longer apply.
- `openpencil documents` is now a command group: list open documents with `openpencil documents list`.
- The MCP `close_file` tool no longer asks in the app whether to save unsaved changes, a question an agent could not answer and that left the call timing out. With unsaved changes it now fails unless `unsaved` is `"save"` or `"discard"`, and it is marked as a write tool.
- OpenPencil's plugin-data keys are defined once in `OPEN_PENCIL_PLUGIN_DATA` from `@open-pencil/scene-graph`, each with the schema that reads and writes it, and read or replaced with `readPluginData` and `withPluginData`. `@open-pencil/fig/node-change` no longer exports `OPEN_PENCIL_PLUGIN_ID` (now in `@open-pencil/scene-graph`), the `*_PLUGIN_KEY` constants, `upsertPluginData`, `removePluginData`, or `getOpenPencilPluginValue`; read a `.fig` record's value with `readNodeChangePluginData`. `@open-pencil/core` no longer exports `SOURCE_LIBRARY_PUBLICATION_PLUGIN_KEY`, and `SourceLibraryPublication` moved to `@open-pencil/scene-graph`.
- `fractionalPosition`, `orderKeyBetween`, and `siblingOrderKeys` moved from `@open-pencil/fig/node-change` to `@open-pencil/scene-graph/order-keys`; the `@open-pencil/core` root still exports `fractionalPosition`. `orderKeyBetween` now always returns a key: when no printable key sorts between its bounds it returns a key above `lo`, which `hasOrderKeyBetween` detects, and it takes an optional suffix that `siblingOrderKeys` can request through `{ suffix }`.
- The desktop app requires macOS 13 or later; the web app supports Chrome 111, Edge 111, Firefox 128, and Safari 16.4 or later.
- Shared rooms record the layer tree in a new format, so people on this version and on earlier versions can no longer join each other's rooms. A room this browser saved with an earlier version converts when you open it again.
- A paint's `gradientTransform` follows Figma's convention everywhere, so gradients made in OpenPencil before this release draw differently. Build gradients with `linearGradientTransform` and `ellipticalGradientTransform` from the new `@open-pencil/scene-graph/gradient`, where `isGradientFill` and `GradientFillType` moved from `@open-pencil/core/geometry`; `linearGradientEndpoints` is removed.
- `.fig` files store colour-variable bindings in Figma's `colorVar`. A paint bound through the old `colorVariableBinding` field, which only OpenPencil wrote, reopens unbound. `VariableBinding`, `colorVariableBinding`, `encodeNodeChangeWithVariables`, `encodePaintWithVariableBinding`, and `encodeVarint` are removed from `@open-pencil/core` and `@open-pencil/core/kiwi`.
- In scripts, a text node's `fontSize`, `fontName`, `fontWeight`, `fills`, `letterSpacing`, `lineHeight`, and `textDecoration` read `figma.mixed` while its characters differ, as in Figma, and setting one restyles every character. `fills` is typed `readonly Fill[] | symbol`, so scripts that index it narrow it first.
- Update `openpencil-mcp` together with the app: the app renders `render` JSX itself and no longer accepts the pre-rendered tree earlier versions send. AI and MCP tools reject arguments they do not declare: `defineTool` from `@open-pencil/core/tools` takes a `v.strictObject` input. `close_file` fails on unsaved changes unless `unsaved` is `"save"` or `"discard"`, and `diff_create` and `diff_show` patches list JSX attributes such as `-rounded={8}`, with `diff_show` taking `attributes` instead of a JSON `props` object, so patches in the old format no longer apply. `openpencil documents` is now a command group: list open documents with `openpencil documents list`.
- `design_to_tokens` writes CSS custom properties named from each variable's code syntax or Tailwind namespace: its `tailwind` format is a Tailwind v4 `@theme`, the `json` format is removed, aliases stay `var()` references, and non-default modes go under their condition (`[data-theme="dark"]` by default).
- Design JSX moved from `@open-pencil/core` to the new `@open-pencil/design-jsx` package. Import elements, helpers, variables, `JSX_REFERENCE`, `buildComponent`, `sceneNodeToJSX`, and `selectionToJSX` from there; `@open-pencil/core` and `@open-pencil/core/design-jsx` keep only `renderJSX` and `renderTree`, `renderTreeNode` is removed in favor of `renderTree`, and the `@open-pencil/core/io/formats/jsx` subpath is gone.
- JSX export writes only OpenPencil JSX: `JSXFormat` and `JSXExportOptions` are removed, and Tailwind JSX comes from `sceneNodesToTailwindJSX(graph, nodeIds)` in `@open-pencil/dom-css` or `@open-pencil/dom-css/export`. `@open-pencil/dom-css` no longer requires `@open-pencil/core`, and `exportHTMLBundle` takes a font resolver in `fonts` instead of `'assets'`; build one on `exportWebFontFaceAssets` from `@open-pencil/core/text/web-font/assets` to keep font files in standalone exports.
- Shared primitives moved to `@open-pencil/scene-graph`: color conversion and management to `/color`, text and layout direction to `/text-direction`, `randomHex`, `randomInt`, and `randomIndex` to `/random`, `fractionalPosition` to `/order-keys`, and `@open-pencil/scene-graph/layout-guides` is now `/layout`. `@open-pencil/core/bytes` is removed in favor of `js-base64`; the `@open-pencil/core` root exports are unchanged.
- `SceneNode` has new required keys `textParagraphs`, `listSpacing`, `paragraphSpacing`, `paragraphIndent`, `hangingList`, `targetAspectRatio`, `isExposedInstance`, `strokeWeight`, `strokeAlign`, and `booleanOperation` (which may be `undefined`), so code that builds `SceneNode` objects itself must include them. `Stroke` extends `Fill`, so every stroke states a paint `type`, usually `'SOLID'`.
- `SceneNode.primaryAxisSizing` and `counterAxisSizing` are `AxisSizingMode` (`'FIXED' | 'HUG'`): fill is stored on the child, as `layoutGrow` and `layoutAlignSelf: 'STRETCH'`, as Figma stores it. Read and change per-axis sizing with `layoutSizing`, `layoutSizingOptions`, and `layoutSizingUpdates` from `@open-pencil/scene-graph`.
- `.fig` reading moved to one reader. `importNodeChanges` and `importClipboardNodes` are replaced by `parseFigFile` and `parseFigmaClipboard`, `populateLazyFigImportRoots` and `populateAllLazyFigImportRoots` by `populateFigPage` and `populateAllFigPages` from `@open-pencil/core/io/formats/fig`, and `populateAndApplyOverrides` by `interpretInstance` with `materializeInstance`; `assertFigPackageReady()` is gone and `FIG_PACKAGE_STATUS` reads `document-reader`. `.fig` export takes text shaping from a runtime: `buildDerivedTextDataV4` is removed, `sceneNodeToKiwi` needs the `runtime` that `withFigExportRuntime(graph, canvasKit, write)` passes to its callback, and `FigNodeChangeExportRuntime` takes `shapeText(node)` instead of `getGlyphOutlineMetrics`.
- OpenPencil's plugin-data keys are defined once in `OPEN_PENCIL_PLUGIN_DATA` from `@open-pencil/scene-graph` and read or replaced with `readPluginData` and `withPluginData`. `@open-pencil/fig/node-change` drops `OPEN_PENCIL_PLUGIN_ID` (now in `@open-pencil/scene-graph`), the `*_PLUGIN_KEY` constants, `upsertPluginData`, `removePluginData`, and `getOpenPencilPluginValue` in favor of `readNodeChangePluginData`; `SourceLibraryPublication` moved to `@open-pencil/scene-graph` and `SOURCE_LIBRARY_PUBLICATION_PLUGIN_KEY` is gone.
- Every process mints layer, variable, and collection IDs in a random session, so `generateId()` no longer starts at `0:1` in the CLI, MCP, or scripts. Code that needs fixed IDs calls `setIdSession`, which now returns the previous session, or passes the `SceneGraph` its own generator (#770).
- Editor state gains required `canvasVersion`, which the canvas redraws on (call `requestRender()` instead of bumping `sceneVersion`), `shapeHandleHover`, and `selectionTheme`, which replaces `RulerTheme.label`. `remoteCursors` is now `presenceCursors` (`PresenceCursor[]`, each with a `kind` of `'person'` or `'agent'`), and the `Tool` type, `EDITOR_TOOLS`, and `TOOL_SHORTCUTS` include `'COMMENT'` on <kbd>C</kbd>.
- Canvas and constants APIs changed: `SceneGraph.hitTestFrame` is now `hitTestDropTarget`, `adoptNodesIntoSection` is now `adoptCoveredLayers`, and `SkiaRenderer.hitTestFrameTitle` no longer takes selected IDs. `SkiaRenderer.buildParagraph` returns a `TextLayout` that draws with `draw(canvas, x, y)`. `AUTO_LAYOUT_BREAK_THRESHOLD`, `getDefaultCanvasBgColor`, and `CANVAS_BG_COLOR_DARK` are removed, and `SECTION_DEFAULT_FILL` is replaced by `SECTION_DEFAULT_FILLS` and new pages use `PAGE_DEFAULT_BACKGROUNDS`, both keyed by interface theme. Icons come from an `IconProvider`: `fetchIcon`, `fetchIcons`, `searchIcons`, `searchIconsBatch`, and `clearIconCache` are replaced by the default `iconify` provider, `createIconifyProvider()`, and `placeIcon`, and `VectorizedPath` from `@open-pencil/core/vector` replaces `clipNetworks` with `clips`.
- `@open-pencil/vue` composables act on the whole selection: `useStrokeControls` and `useEffectsControls` no longer take a node, `useTypography` edits every selected text layer and its `weights` (also the `TypographyControlsRoot` slot prop) is a computed list of the families' weights, read with `.value`, and `usePosition` reports `x`, `y`, and `rotation` as Figma's panel does. `useVariables().collections` returns copies and `addVariable` returns the new ID; `useVariablesEditor`, `useVariablesTable`, `useVariablesDialogState`, and the `@tanstack/vue-table` dependency are removed. `useFlatReorderDrag` takes `operations` and `onCombine`, and the `updates` messages replace the system update dialog strings with the Software Update window's.

### Added

- MCP `diff_apply` accepts structured grouped updates, JSX subtree additions, removals and sibling reordering across explicitly included pages. One grouped Undo/Redo owns those pages and transitive component dependencies; artwork resolves before history, dry runs skip mutation/layout, and commit failures roll back the group. Requests are bounded to 500 operations, 1 MiB and 20,000 added nodes including instance expansion.

- System emoji fonts participate in paragraph fallback, and readable text stays visible while missing glyphs resolve or remain unavailable.
- Preserve native component property declarations, visibility/text references and named slots in Design JSX export/import. Agents can read property IDs and instance assignments through `get_node`, and `expose_instance_swap` returns its created definition; component maps explicitly identify page-local usage counts.

- Add optional native MCP `agent_dispatch`, `agent_status` and `agent_cancel` for one bounded read-only Codex design reviewer, with durable replay/conflict handling, cancellation/restart recovery, configured model/reasoning receipts and linked feedback tasks. The main agent remains the sole canvas writer.

- Bulleted and numbered lists in text, as in Figma: `.fig` files and the Figma clipboard keep each paragraph's list type, nesting, list and paragraph spacing, and first-line indent, and the text's hanging markers, and the canvas lays lists out as Figma does, with markers centred or ending a third of an em before the item, numbers counting 1, a, i as they nest, and wrapped lines hanging at the indent. Set a list's style, list and paragraph spacing, paragraph indent, and hanging markers in the Typography section, for the paragraphs being edited or the whole text; while editing, <kbd>⇧</kbd><kbd>⌘</kbd><kbd>8</kbd> and <kbd>⇧</kbd><kbd>⌘</kbd><kbd>7</kbd> make bulleted and numbered lists, <kbd>Tab</kbd> and <kbd>⇧</kbd><kbd>Tab</kbd> nest and unnest items, and text you type into a list continues it. Flattening or outlining text keeps its markers. Hanging markers remain visible in fixed-height text boxes without letting lower lines overflow. Scripts read and set lists with `getRangeListOptions`, `setRangeListOptions`, `getRangeIndentation`, `setRangeIndentation`, `listSpacing`, `paragraphSpacing`, `paragraphIndent`, their `getRange` and `setRange` methods, and `hangingList`.
- While text is being edited, the Fill and Typography fields show and change the style of the selected characters, as in Figma, instead of the whole layer.
- Design JSX writes rich text: `<Span>` styles characters with `<Text>`'s own props, and `<Paragraph>` makes a paragraph with `list`, `level`, `spacing`, `listSpacing`, and `indent`. Exporting a text layer to design JSX writes them back.
- Scripts style text by character range, as in Figma: `getStyledTextSegments` and `getRange` / `setRange` methods for font name and size, fills, letter spacing, line height, and decoration with its style, offset, thickness, colour, and skip ink. The `set_font_range` AI and MCP tool uses them.
- Bulleted and numbered lists in text, as in Figma: `.fig` files and the Figma clipboard keep each paragraph's list type, nesting, list and paragraph spacing, and first-line indent, and the text's hanging markers, and the canvas lays lists out as Figma does, with markers centred or ending a third of an em before the item, numbers counting 1, a, i as they nest, and wrapped lines hanging at the indent. Set a list's style, list and paragraph spacing, paragraph indent, and hanging markers in the Typography section, for the paragraphs being edited or the whole text; while editing, <kbd>⇧</kbd><kbd>⌘</kbd><kbd>8</kbd> and <kbd>⇧</kbd><kbd>⌘</kbd><kbd>7</kbd> make bulleted and numbered lists, <kbd>Tab</kbd> and <kbd>⇧</kbd><kbd>Tab</kbd> nest and unnest items, and text you type into a list continues it. Flattening or outlining text keeps its markers. Scripts read and set lists with `getRangeListOptions`, `setRangeListOptions`, `getRangeIndentation`, `setRangeIndentation`, `listSpacing`, `paragraphSpacing`, `paragraphIndent`, their `getRange` and `setRange` methods, and `hangingList`.
- Drag several layers along an auto layout row or column together, as in Figma: they move as one block in their order, wherever you grab them, and layers selected in different rows each move along their own row. A layer dragged along a flow takes the next slot once its leading edge reaches the next layer's centre, as Figma reorders, instead of once the cursor does.
- Move a layer in an auto layout row or column with the arrow keys, as in Figma: Right and Left move it one slot along a row, Down and Up along a column, Shift too, and the arrows across the flow do nothing. With several layers selected, each moves one slot and one at the end stays; a run of keys is one undo step.
- Lock a layer's aspect ratio with the button beside its width and height, as in Figma: typing either side changes the other, handles keep the ratio (<kbd>Ctrl</kbd> frees it for one drag, which then keeps the new size), a Fill layer in auto layout takes its other side from the ratio, and a constraint keeps it when exactly one axis follows the frame. The lock reads from and writes to `.fig` files and the clipboard, and the plugin API has `lockAspectRatio()`, `unlockAspectRatio()`, `targetAspectRatio`, and `constrainProportions`.
- See the selection as a Vue or React component in the Code tab, as the Storybook export generates them: a component set with its variants as props and its behaviour's Reka UI or Radix parts, any other layer as a plain component of the elements it draws, with shaders playing through `shaders/vue` or `shaders/react`. HTML there now shows the selection as markup, images as file paths, and still rewrites it live when edited; with nothing selected it keeps the starter for writing new layers. A CSS/Tailwind switch styles HTML and components with a readable stylesheet or with Tailwind utilities, their states as variants such as `data-[state=checked]:`, and edited HTML is built with Tailwind's utilities; React with Tailwind replaces the Tailwind JSX format. In HTML, Vue, and React, as in Design JSX, the element around the cursor marks its layer on the canvas and design issues are underlined on the layer's class. `export -f storybook --css tailwind` styles the exported Vue and React components the same way.
- Talk with the people in a shared room in a voice call, as in Figma: the headphones beside the avatars start or join it, a ring marks who is in the call and lights up while they speak, and the call's popover chooses the microphone and, where the browser allows, the speakers. Audio goes peer to peer, and only to the people in the call.
- Take a layer out of its auto layout with **Ignore auto layout** at the top of the Position section, as in Figma: the layer stays where it is, its siblings close the gap in the same undo step, and it keeps its sizing, so a Fill layer fills again when it returns.
- Round a rectangle's corners on the canvas, as in Figma: while the pointer is over a selected rectangle at least 108 screen pixels across, a handle sits inside each corner. Dragging one sets every corner while they are equal and only that corner while they differ, <kbd>⌥</kbd> swaps the two, and <kbd>⇧</kbd> rounds to tens; a label beside the pointer shows the radius.
- Comment on designs, as in Figma. Pick the **Comment** tool or press <kbd>C</kbd>, click the canvas, and type; the pin shows your avatar and stays on the top-level layer under it when that layer moves. Open a pin to reply, resolve, copy, or delete it. Comments take bold, italic, strikethrough, links, and numbered and bulleted lists, with Figma's shortcuts or Markdown, and Shift+Enter continues a list. While the Comment tool is active the right sidebar lists the document's threads with search, newest- or oldest-first order, and filters for resolved comments, your threads, and the current page; **View → Comments** (<kbd>⇧</kbd><kbd>C</kbd>), also in the zoom menu and a pin's right-click menu, hides pins outside the tool. Comments are saved in the document as OpenPencil plugin data, so they travel with the `.fig` file, its storage copy, and a collaboration room, comments two people add at the same time are both kept, and Figma and older versions of OpenPencil still open the file. Adding or resolving a comment marks the document as changed, but undo leaves comments alone. Scripts, the AI chat, and MCP clients can act on review feedback too: `openpencil.getComments()`, `addComment()`, and each comment's `reply()` and `resolve()` in `openpencil eval`, and the `get_comments`, `add_comment`, `reply_to_comment`, and `resolve_comment` tools.
- Edit a polygon's or star's corner radius, point count, and a star's inner ratio in the properties panel, as in Figma: **Count** from 3 to 60 and **Ratio** as a percentage.
- Round a rectangle's, polygon's, or star's corners on the canvas, as in Figma: while the pointer is over a selected shape at least 108 screen pixels across, a handle sits inside each corner of a rectangle and below the top point of a polygon or star, and handles on a polygon's or star's next point and a star's first inner point set its point count and inner ratio. Dragging a rectangle's handle sets every corner while they are equal and only that corner while they differ, <kbd>⌥</kbd> swaps the two, and <kbd>⇧</kbd> rounds to tens; a label beside the pointer shows the radius.
- Fill layers with shaders from the open-source [`shaders`](https://shaders.com) library: the fill picker's Shader tab stacks effects, generates controls for each effect's props, and takes a preset copied from shaders.com, and design JSX takes `shader()` paints. The canvas shows each shader's first frame and preview plays it; both need WebGPU, without which a shader shows the frame it was saved with. Safari copies each playing frame from WebGPU into the canvas synchronously, so there preview updates shaders in turn, less often the more are on screen. Files and other formats keep that frame as an image fill with the preset in OpenPencil plugin data, so a `.fig` file opens in Figma with the frame and reopens in OpenPencil as the shader. Tailwind JSX and Vue and React Storybook exports play a layer's shader behind its content with the library's `<Shader>`, telemetry off, and HTML shows its still frame there.
- Edit several layers at once as in Figma: the properties panel gives a multi-selection a Layout section with sizes, text resizing, flow, clip content, and a Spacing field that spaces a row or column evenly; Typography for the text among it; corner radius for the layers that have one; the stroke of the layers that have strokes; and Selection colors, which lists every fill and stroke colour in the selection and its children and recolours one everywhere it is used. The panel's header reads "N selected".
- Read plain text from layers and their descendants with `export_text`, without rendering images or changing selection, including when MCP shares only the selection (#861).

- Edit gradients on the canvas, as in Figma: while a fill or stroke gradient's picker is open, the layer shows the gradient's line or ellipse with its end dots and stop squares. Dragging a dot moves it, <kbd>Shift</kbd> turns it in 15° steps, and dragging a square slides its stop; the stop selected on the canvas is the one selected in the picker.
- Paste SVG markup copied as text, such as from a code editor or Figma's Copy as SVG, as layers.
- Show the pixel grid when zoomed in, as in Figma: from 800% on a standard display and 400% on a Retina one, toggled with **View → Pixel Grid** or <kbd>⇧</kbd><kbd>'</kbd>. <kbd>⇧</kbd><kbd>⌘</kbd><kbd>'</kbd> toggles **Snap to Pixel Grid**. The zoom menu in the properties panel lists both, with Figma's shortcuts, and labels its shortcuts for zoom to fit (<kbd>⇧</kbd><kbd>1</kbd>) and 100% (<kbd>⌘</kbd><kbd>0</kbd>); <kbd>⇧</kbd><kbd>R</kbd> toggles rulers and <kbd>⌥</kbd><kbd>⌘</kbd><kbd>\\</kbd> multiplayer cursors.
- Set a component's text, boolean, and swap properties on a design JSX `<Instance>` by name, as variants are set, such as `<Instance of="Card" Title="Hello" Badge={false} />`; `properties` accepts names too. An instance written this way still works after the document is saved to `.fig` and reopened, which gives each property a new ID ([#750](https://github.com/open-pencil/open-pencil/issues/750)).
- Import `designDocumentToSceneGraph` from `@open-pencil/dom-css/scene-graph` in browser builds, which the package's main entry, with its headless CSS runtime, cannot be bundled for.
- Open HTML files in CLI commands that read documents, such as `openpencil tree` and `openpencil convert`, laid out as `openpencil import` lays them out.
- Save the open document to cloud storage with **File → Save to storage…**. The tab stays bound to the stored copy, so Save and auto-save write to the bucket; before storage is configured, the command opens its settings. A new Cloud Storage guide covers connecting a bucket, CORS, syncing, and provider notes.
- Add a variant to a standalone component from the header's **Add variant** button, as in Figma (#847): it becomes a component set named after it, whose existing instances and properties carry over, with a `Property 1=Variant2` copy below. A set's variant properties are rows of its **Properties** list, each opening to rename it and add, rename, reorder, or remove its values; removing a value variants still use moves them to another value. Variants that share a combination of values are named in a notice that selects them.
- Create and edit a component's text, boolean, and instance swap properties from the properties panel, as in Figma (#847). A layer in a main component links its text content, visibility, or swapped component to a new or existing property from the Typography and Appearance sections and the instance header, and shows the linked property in place of the value. The component lists its properties, each opening to rename it, change its default, see and unlink the layers it drives, or delete it, and reorders them by dragging. Expose nested instances so their properties show, grouped under the instance's name, on instances of the component. Typing into text a property drives sets the property: its default in the main component, the instance's value in an instance.
- An icon picker searches Iconify's open-source sets from the toolbar, the Object menu, and the command palette, and inserts the chosen icon at the middle of the view. It starts with the icons already in the file and the ones picked lately, and a set button in the search field narrows it to one set. Placed icons keep their name, so the Design panel's Icon section can swap the glyph or change its color in one undo step, and design JSX and HTML exports write them as icons. Icons show as icons in the layer tree, are named after the icon, such as `cat`, go without a frame title on the canvas, and scale their paths when resized. An icon whose paths were edited is marked Modified, exports as the paths it draws, can be reset to the original icon, and asks before a swap discards the edit; **Detach icon** in the Icon section, the canvas menu, and the Object menu makes any icon plain artwork.
- Attach images to an AI chat message by dropping them anywhere on the chat panel: an outline over the composer shows where they go, or why they cannot be attached while a reply is running or four images are already attached. SVG images are drawn as PNGs when dropped, pasted, or chosen. Documents dropped on the chat still open in a new tab.
- Share only the selected layers with MCP clients: **Share only the selection** under **Settings → MCP → Local server**, or `OPENPENCIL_MCP_SCOPE=selection` for a server you start yourself, limits clients to `get_selection`, `get_node`, `get_page_tree`, `describe`, and `export_image` on the selected layers and what they hold, enforced by the server for MCP sessions, stdio clients, and `/rpc` alike.
- Set up AI in a few steps with guided setup. On first launch OpenPencil asks what AI should help with and what you already use: a coding agent on this computer (Claude Code, Codex, Gemini CLI, or Pi, in the desktop app), an API account (Anthropic, OpenAI, Google AI, OpenRouter, DeepSeek, Z.ai, or MiniMax), or a local or company server such as Ollama or LM Studio. Sign in to OpenRouter from the browser or the desktop app instead of pasting a key. In the desktop app, setup checks whether the agent, its OpenPencil adapter, OpenPencil's MCP server, and Pi's Harness companion are installed and match the app, installs or updates them with one click through npm, and links a [setup guide](https://openpencil.dev/programmable/coding-agents) or copies a prompt that asks the agent to set itself up. Setup tests each connection, proposes a model for each role that you can change, and keeps anything configured by hand. Skip it to start designing, or run it again from **Settings → AI & agents**.
- Print the installed version of OpenPencil's MCP server and Harness companion with `openpencil-mcp-http --version`, `openpencil-mcp --version`, and `openpencil-harness --version`. The desktop app asks it to check that they match the app on every platform, including npm `.cmd` shims on Windows and version managers such as Volta and mise.
- Add a Controls page to the `/demo` document: a switch, checkbox, slider, tabs, text field, and a button with hover, pressed, focus, and disabled states, written as Reka-named design JSX, and a settings card made of their instances to try in preview.
- Make main components behave like real controls and try them in preview. The Behaviour section turns a component or component set into a Button, Text field, Textarea, Number field, Toggle, Switch, Checkbox, Radio, Radio group, Toggle group, Slider, Progress, Tabs, Collapsible, or Accordion, after Reka UI's primitives: its values bind to the component's variant, boolean, and text properties, a slider or number field keeps its own number range, its parts are its slots (a group's items slot holds its radios, toggles, or collapsibles), and a variant property can draw its default, hover, pressed, focus, and disabled states. Rows are named for the control, and an empty row creates what it needs: a text layer and text property, Off and On variants, a slot in every variant, or a variant for each interaction state, turning a lone component into a component set when it needs variants. View > Preview (⌥⌘↩) runs each top-level layer holding controls as live Reka UI components over the canvas, drawn by the component's variants: real inputs with the browser's caret, selection, and paste, keyboard focus and navigation, and layout that grows as collapsibles open, all without changing the document, its history, or what collaborators see; Esc or the pill returns to editing.
- Build controls from scripts, tools, and design JSX. Scripts run by `eval`, `openpencil eval`, and app automation get an `openpencil` global next to `figma`, in the Figma API's style: `openpencil.setBehaviour(set, { kind: 'switch', values: { value: 'State' }, parts: { thumb: 'Thumb' }, states: 'Interaction' })` or `.bindValue()` and `.bindPart()` by property and slot names, `getBehaviour`, `behaviourKinds`, and `createSlot`. MCP and AI chat get `set_behaviour`, `get_behaviour`, and `create_slot`. Design JSX writes controls with Reka UI's element names, such as `<Switch.Root modelValue="State">` with `<Switch.Thumb>`, `<TextField.Input>`, and `<Tabs.List>`, in JSX strings or in TSX through the typed `Switch`, `Slider`, `Tabs`, and other namespaces `@open-pencil/design-jsx` exports, and exports components with behaviours the same way. A part holding layers with no layout of its own, such as a `Tabs.Content` panel, stacks them in a column that hugs them.
- Open a `.fig`, `.pen`, or other supported document by dragging it onto the window, where it opens in a new tab as File → Open does. Images and SVG files dropped on the canvas are still placed, and other files report that they can't be opened instead of being ignored.
- Pass an ID generator to `new SceneGraph()` from `@open-pencil/scene-graph` to choose the IDs of the nodes, variables, collections, and modes the graph creates, including modes added later with `createMode`; generated IDs skip any node, variable, collection, or mode ID already in the graph, and an exhausted generator throws instead of hanging. `createComponentPropertyId` gives new component properties the `prop:` IDs the editor, plugin API, and design JSX share.
- Diagnose failures from Settings → Diagnostics. Uncaught errors, unhandled rejections, component errors, failed AI chats, and AI tool calls that broke inside OpenPencil are recorded with their message and stack, and other failed tool calls as warnings. Messages and stacks are scrubbed of URL queries and credentials, API keys and tokens, email addresses, and home folder names, and provider errors keep no message. Each event has a specific label, such as _Tool: render · 162 ms_ or _Error: TypeError_, expands to its details, and can be filtered by level and category and paged; copied diagnostics include the app version and browser.
- Diagnose failures from Settings → Diagnostics. Uncaught errors, unhandled rejections, component errors, failed and stopped AI chats, and AI tool calls that broke inside OpenPencil are recorded with their message and stack, and other failed tool calls as warnings. Messages and stacks are scrubbed of URL queries and credentials, API keys and tokens, email addresses, and home folder names, and provider errors keep no message. Each event has a specific label, such as *Tool: render · 162 ms* or *Error: TypeError*, expands to its details, and can be filtered by level and category and paged; copied diagnostics include the app version and browser.
- Import `resolvePasteTarget` from `@open-pencil/core/editor` to place ordinary pasted or dropped content in an embedding app in the same container the editor would choose. It takes the editor `createEditor` returns. Replacement paste is not covered: it inserts into the selected target's parent.
- Import `flattenNodesToVectorProps`, `outlineStrokeNodesToVectorProps`, and the `VectorFlattenProps` type from `@open-pencil/core/canvas` to compute Flatten and Outline stroke geometry in an embedding app without going through the editor's own write path.
- Check designs from the new Lint tab in the right panel: issues on the page, in the selection, or across the document are grouped by rule, hovering one highlights its layer on the canvas, clicking selects it and brings it into view, and one-click fixes bind colors to the variable they match and round subpixel geometry for a row or a whole group, and snap radius, spacing, and small text to the scale, convert groups to frames, and delete hidden layers one row at a time. Rules can be turned off individually or switched between the Recommended, Strict, and Accessibility presets.
- See which layer the code is about in the Code tab's Design JSX and Tailwind JSX: the element around the cursor marks its opening and closing tag and shows its layer on the canvas as a tinted box, apart from canvas hover, and design issues are underlined on the property that causes them, including while you edit Design JSX live.
- Fix lint issues outside the app: `openpencil lint --fix -o fixed.fig` binds colors to the variable they match and rounds subpixel geometry, and the `lint` and `lint_fix` tools let MCP clients and AI chat check a page and apply those fixes, plus radius, spacing, text size, group-to-frame, and hidden-layer suggestions on request. Lint messages carry each fix as data in `fix` and `suggestions`.
- Mark layers with errors and warnings on the canvas while you work, and pin those outside the view to the canvas edge in their direction, with matching marks in the Layers panel and error and warning counts in the page list; hover a marker or pin for its issues or click it to open them in Lint, and turn markers on or off with View → Design issues.
- Follow collaborators and their AI agents from the avatars in the toolbar: an avatar counts that person's agents, hovering lists what each is doing and on which page, and clicking follows. The view glides after whoever you follow, a frame in their color and a “Following …” bar show whom you follow, and Escape, clicking, scrolling, zooming, or switching pages stops it. Your own agents, the AI chat and MCP clients alike, are followed automatically while they work; turn this off with the crosshair button at the top of the AI panel. Your own avatar renames your agents and leaves the room.
- See where AI agents are working: the built-in AI chat, ACP and Pi harness chats, and every MCP client each show a cursor whose outlined label shows a sparkle and a callsign such as *Fern*, at the layers they read or edit, and an MCP agent leaves when its session ends or its document closes. While the chat streams JSX, its cursor moves through the elements as they appear and outlines them. People's and agents' cursors glide to each new position instead of jumping. In a shared room, collaborators see each other's agents in the color of the person running them.
- Edit variables as design tokens in the redesigned variables dialog, opened from View → Variables…, the command palette, or the Design panel, and expandable to most of the window. Collections and the groups inside them are listed in a sidebar with counts; picking a group, a type filter, or a search, which matches names, CSS names, descriptions, and values with the command palette's typo-tolerant matching, narrows the list, which shows each variable's type, CSS name, and a value per mode. Names and number or text values edit in place, rows reorder by dragging, and Shift- or Cmd-clicking selects several to duplicate, move into a group, or delete from the context menu, the Delete key, or the side panel. Selecting one edits its name, CSS name (checked against CSS before it is saved), unit, per-mode values or CSS expressions such as `clamp()`, scopes, description, and publishing, and points a value at another variable of the same type or detaches it again. The collection settings rename and delete the collection, add, rename, duplicate, delete, and choose the default mode, and choose when each mode applies in plain words, such as _System is in dark mode_ or _Screen is narrower than 640px_, with the CSS it writes shown underneath and a custom selector or `@media`, `@supports`, or `@container` query when no preset fits. Manually switched modes use an attribute named after the collection, such as `data-theme`, or one the collection names to match an existing codebase; it is saved in `.fig` files and used by exported code. The active collection's stylesheet updates live below the list, and copying offers CSS or a Tailwind v4 theme. Undo and redo work in the dialog as they do on the canvas, with one step per change and one per color picker session, while a field with uncommitted text keeps its own undo. The dialog lays out by its own width: in a narrow window or on a phone it shows one mode at a time and opens a variable, the collection settings, or the stylesheet over the list.
- See where AI agents are working: the built-in AI chat, ACP and Pi harness chats, and every MCP client each show a cursor whose outlined label shows a sparkle and a callsign such as *Fern*, at the layers they read or edit, and an MCP agent leaves when its session ends. While the chat streams JSX, its cursor moves through the elements as they appear and outlines them. People's and agents' cursors glide to each new position instead of jumping. In a shared room, collaborators see each other's agents in the color of the person running them, and watch what the AI chat builds take shape on their own canvas while its JSX streams, not only once it is done.
- Follow collaborators and their AI agents from the avatars in the toolbar: an avatar counts that person's agents, hovering lists what each is doing and on which page, and clicking follows. The view glides after whoever you follow, a frame in their color and a “Following …” bar show whom you follow, and Escape, clicking, scrolling, zooming, or switching pages stops it. Your own agents, the AI chat and MCP clients alike, are followed automatically while they work, and following stops when they finish, are stopped, or fail; an agent you chose to follow keeps you with it while it rests. Turn automatic following off with the crosshair button at the top of the AI panel. Your own avatar renames your agents and leaves the room.
- See where AI agents are working: the built-in AI chat, ACP and Pi harness chats, and every MCP client each show a cursor whose outlined label shows a sparkle and a callsign such as *Fern*, at the layers they read or edit, on whichever page those are, and an MCP agent leaves when its session ends. While the chat streams JSX, its cursor moves through the elements as they appear and outlines them. People's and agents' cursors glide to each new position instead of jumping. In a shared room, collaborators see each other's agents in the color of the person running them, and watch what the AI chat builds take shape on their own canvas while its JSX streams, not only once it is done.
- Copy the document's variables as a CSS stylesheet or a Tailwind v4 theme from the variables dialog, or print them with `openpencil tokens`. Each collection's default mode goes in `:root` (or `@theme`, with a `@custom-variant` per mode), other modes override under their condition, `[data-theme="dark"]` unless the mode names a selector or `@media` query, and aliases stay `var()` references that follow the mode. Variables CSS cannot express, such as booleans, are named instead of written.
- Import and export variables, text styles, and effect styles as W3C design tokens. **Export as design tokens** in the variables dialog's copy menu and `openpencil tokens --format dtcg --out <folder>` write one file per collection mode in the shape Figma imports, typography and shadow tokens for styles, and a DTCG resolver for tools such as Style Dictionary. **Import design tokens** reads files from Figma, a resolver with its files, Tokens Studio themes, or a zip of them, shows where each collection and mode goes before anything changes, updates variables and styles by name without deleting any, and undoes in one step; agents and MCP clients import with the `import_design_tokens` tool, and `design_to_tokens` takes `format: "dtcg"`.
- Edit variables as design tokens in the redesigned variables dialog, opened from View → Variables…, the command palette, or the Design panel, and expandable to most of the window. Collections and the groups inside them are listed in a sidebar with counts; picking a group, a type filter, or a search, which matches names, CSS names, descriptions, and values with the command palette's typo-tolerant matching, narrows the list, which shows each variable's type, CSS name, and a value per mode. Names and number or text values edit in place, rows reorder by dragging, and Shift- or Cmd-clicking selects several to duplicate, move into a group, or delete from the context menu, the Delete key, or the side panel. Selecting one edits its name, CSS name (checked against CSS before it is saved), unit, per-mode values or CSS expressions such as `clamp()`, scopes, description, and publishing, and points a value at another variable of the same type or detaches it again. The collection settings rename and delete the collection, add, rename, duplicate, delete, and choose the default mode, and choose when each mode applies in plain words, such as *System is in dark mode* or *Screen is narrower than 640px*, with the CSS it writes shown underneath and a custom selector or `@media`, `@supports`, or `@container` query when no preset fits. Manually switched modes use an attribute named after the collection, such as `data-theme`, or one the collection names to match an existing codebase; it is saved in `.fig` files and used by exported code. The active collection's stylesheet updates live below the list, and copying offers CSS or a Tailwind v4 theme. Undo and redo work in the dialog as they do on the canvas, with one step per change and one per color picker session, while a field with uncommitted text keeps its own undo. The dialog lays out by its own width: in a narrow window or on a phone it shows one mode at a time and opens a variable, the collection settings, or the stylesheet over the list.
- See which pages people and AI agents are working on: the Pages panel marks those pages in their colors and, on hover, shows who is there with what their agents are doing and a button to follow them; the command palette names who is there, and the chat offers **Go to page** while its reply works on a page you're not viewing. On phones, the room pill shows the people in the room as avatars beside the room's status.
- Hide, lock, and constrain layers in design JSX with `visible={false}`, `locked`, and `constraints={{ horizontal, vertical }}`, set italic text with `italic`, and describe strokes fully with `strokes`, `strokeWeights`, `strokeCap`, `strokeJoin`, and the node-level `dashPattern`. JSX export now writes these together with stacked, gradient, and image fills, every effect, absolutely positioned children, size limits, vertical text alignment, masks, and variable bindings, so rendering exported JSX reproduces them and `diff_jsx` reports changes to them.
- Jump between pages from the command palette: it lists the pages you visited recently in the tab, **Go to page…** lists every page, and typing a page name finds it.
- Choose how much an AI model thinks for each message from the chat composer, from Off to Extra high or the provider default. Anthropic, Google, DeepSeek, OpenAI, OpenRouter, and compatible models apply it, where reasoning effort previously reached only OpenAI and OpenRouter models. A model profile's thinking level, which replaces its free-text reasoning effort, sets the starting choice, and finished reasoning shows how long the model thought.
- Read AI tool calls at a glance: each call shows a one-line summary and buttons that bring the layers it touched into view, even on another page. Expanded, it shows highlighted JSX, scripts, and JSON input and output, and exported images inline. A render call's JSX streams in as the model writes it, and a long run folds its earlier steps into one row that lists them by name and counts failures.
- Review what each AI edit changed from its tool call in the chat: a before and after image split by a draggable divider, or the changed pixels highlighted, and a diff of the layers' JSX. Both are saved with the conversation. Settings → Chat → Change previews sets the image size (240, 480, or 960 px) or turns images off to keep only the JSX diff. The chat AI can check its own work the same way with `diff_changes`, which compares the page or a layer with its state before the run edited it as a patch that `diff_apply` can replay.
- Revert an AI reply's edits from the chat while nothing has been edited since, regenerate the last reply, retry a message that failed before any reply from the message or its error notice, or edit the last message and send it again; regenerating and resending undo the replaced reply's edits first when they can. An edit a tool finishes after you stop a reply still counts as that reply's. Edit → Undo counts the same as reverting: each AI edit you undo marks its tool call *Undone*, a reply with only some edits undone says how many, and a reply with all of them undone stays in the chat dimmed and marked *Changes reverted*, also after reopening the conversation. Your next message tells the AI which of its edits were undone or redone since it last heard, so it does not build on edits that are gone, and an edit undone while the AI is still working is noted on its next tool result. **Restore changes** on the reply, or Edit → Redo, brings undone edits back and removes their marks while nothing has been edited since.
- Preview designs progressively on the canvas as direct AI providers stream JSX, without saving partial designs or adding intermediate undo steps. A preview stays with its page: it hides while you view another page and returns when you come back.
- Write design trees as TSX with `@open-pencil/design-jsx` as the JSX import source, and render them with `renderTree`.
- Swap the component behind an instance with `instance.swapComponent(component)` in the plugin API, as in Figma.
- Import SVG markup with `figma.createNodeFromSvg(svg)` in the plugin API, as in Figma: it builds the same layers as pasting the SVG, on the current page at its origin.
- Detach an instance from its component with `detachInstance()` in the plugin API, as in Figma, from scripts run through `eval`.
- Run scripts written for Figma's dynamic-page mode that call `figma.getNodeByIdAsync()` or `getMainComponentAsync()`; both resolve to the same nodes as their synchronous forms.
- Export components to Storybook with `openpencil export -f storybook`: one CSF3 story file per component set or component for React, Vue, or HTML, titled by the document and, when several have components, its page, with a story and `select` controls per variant (a component with a behaviour gets boolean `checked`, `pressed`, `open`, and `disabled` controls instead, and each interaction state stays a story; with `--framework vue` or `--framework react`, every component set and component becomes a Vue or React component whose variants are compiled into state styles, its variant, text, boolean, and slot properties its props and slots, and one with the behaviour of a Button, Switch, Checkbox, Toggle, Collapsible, Tabs, Radio group, Toggle group, Accordion, Slider, Progress, Number field, Text field, or Textarea a Reka UI or Radix UI component and whose text properties are string props with a text control, tabs and groups choosing a value named after each tab's or item's label, sliders, progress bars, and number fields binding a number within their range, text fields and textareas binding their text as a native input or textarea with the design's placeholder and filled look (React's number field is a native number input with its steppers wired, since Radix has none), each tab's trigger drawn with the chosen tab's look while it is active, and groups writing an item component they use once per item with the words each item shows; inside it, an instance of another generated component that draws as its variant does uses that component, also where a state draws it in place of another layer, operable from the value the design draws, and an icon is an `@iconify/vue` or `@iconify/react` component; with stories whose play function operates it), a design image per variant, an `openpencil://` link that opens the variant in OpenPencil, and the document's fonts and design variables as files every story file loads, warning about families no web font provider has (`--fonts none` leaves them out); each file opens with a `Default` story and tags its other stories `variant` and itself with its page, so Storybook's tag filter can show one story per component or hide a page; a rules file (`openpencil.stories.json`, or `--rules`) leaves components out, keeps `Default` alone, lays a set out as a gallery, keeps static stories in place of a generated component, or renames titles, matched by page and component name. `--watch` re-exports on every save and removes stories of deleted components, and `--beside` writes each document's stories next to it, for many documents at once (#727).
- Export HTML and Tailwind JSX from the app's export options and through the IO registry, and export Tailwind JSX from the CLI with `-f tailwind-jsx` (`-f jsx --style tailwind` still works). HTML export of a single layer now includes the layer itself, as other formats do. Vector shapes, booleans, stars, and polygons export as inline SVG with their fills, gradients, strokes, and shadows, in HTML, Tailwind JSX, and Storybook stories.
- Choose PPTX in the Export panel's format list, alongside PNG, JPG, WEBP, SVG, and PDF.
- Let AI and MCP agents verify and replay their edits with diff tools: `diff_visual` returns a pixel diff of two rendered nodes with the changed region, and `diff_apply` applies a `diff_create` or `diff_show` patch, including moved, added, and removed children, only when every node still matches it. The built-in AI chat enables `diff_create`, `diff_jsx`, and `diff_visual` by default.
- Compare designs from the terminal with `openpencil diff`: `create`, `jsx`, `show`, `apply`, and `visual` work on a file or the running app, and `diff files` compares two documents page by page and exits with status 1 when they differ.
- Create and fill slots as in Figma. **Create slot** turns a frame of a main component into a slot, or wraps other selected layers in a new one, and the Slots section sets its name, description, layer limits, and preferred components or removes it. In instances, drop, paste, or move layers into a slot, or add components from **Add instances** in the properties panel, which shows each slot as Default or Modified with its item count and limits; **Reset slot** brings back the component content and **Delete contents** empties it. Slots are outlined in pink on the canvas and marked in the layers panel, and parts of an instance outside its slots cannot be dropped into, grouped, wrapped, or deleted, as in Figma.
- Create and inspect slots from scripts run through `eval` and from AI and MCP tools, as in Figma: `component.createSlot()` adds a slot frame and its `SLOT` property, slot frames read `type: 'SLOT'` with `resetSlot()` and `limitViolations`, `appendChild`, `insertChild`, and `remove()` work inside slots and refuse the rest of an instance, and `addComponentProperty` and `editComponentProperty` take a `description` and `slotSettings`.
- Control the running app from the CLI and MCP: `openpencil documents` opens, creates, saves, closes, and brings documents to the front, `openpencil undo` and `redo` step back through changes made through the CLI and MCP, refusing to revert edits made in the editor, and `openpencil settings get` and `set` read and change theme, language, animations, snapping, canvas rendering, recovery, chat, and design check settings. MCP clients get the same through `activate_document`, `undo`, `redo`, `get_settings`, and `update_settings`; credentials, models, MCP connections, storage, and tool access stay out of reach. `openpencil tool list`, `describe`, and `call` run any MCP tool from the shell, against the running app or headlessly on a file.
- Be in several shared rooms at once, each in its own tab and syncing in the background. Join a room from Home with **Join room…**, and from a browser on a computer open it in the desktop app with **Open in desktop app** (`openpencil://join?room=<id>`).
- Join a shared room right away under a generated name such as _Teal Fox_, and set the one name every room shows in Settings or the share panel.
- See how auto layout arranges layers, as in Figma: hovering a horizontal or vertical auto layout frame outlines its visible direct children with dotted lines, and selecting a single layer dots the border of its auto layout parent, in purple for components and instances. The outlines, and the padding and gap markers of a selected frame, hide while layers move, resize, or rotate.
- Join a shared room right away under a generated name such as *Teal Fox*, and set the one name every room shows in Settings or the share panel.
- Read what a frame says without rendering it: the `query_nodes` and `get_page_tree` AI and MCP tools return the text of text layers, and XPath selectors match `@id`, so `//*[@id='1:2']//TEXT[not(ancestor-or-self::*[@visible='false'])]` lists a frame's visible text in layer order with each layer's ID (#861).
- Comment on designs, as in Figma: the **Comment** tool (<kbd>C</kbd>) pins threads to layers, with replies, resolving, rich text, and a searchable, filterable list in the sidebar. Comments are saved in the `.fig` file, so they travel through storage and shared rooms, and scripts, the AI chat, and MCP clients read, add, reply to, and resolve them.
- Be in several shared rooms at once, each in its own tab and syncing in the background, and talk with the people in a room in a peer-to-peer voice call from the headphones beside the avatars. Join from Home with **Join room…** or a pasted link, open a browser room in the desktop app with **Open in desktop app**, and join right away under a generated name such as *Teal Fox*.
- Follow collaborators and AI agents: avatars count each person's agents and show what they are doing, clicking follows them, and your own agents are followed while they work. Agents from the AI chat, ACP and Pi harness chats, and MCP clients show labeled cursors at the layers they touch, and the Pages panel and command palette show who is on each page. The command palette also lists recent pages and **Go to page…**.
- Create and fill slots, as in Figma, from the canvas, the properties panel, scripts, and AI and MCP tools: slots have names, limits, and preferred components, instances show each slot as Default or Modified, and **Reset slot** brings back the component's content.
- Create and edit component properties and variants from the properties panel, as in Figma (#847): link text, visibility, and swapped components to text, boolean, and instance swap properties, expose nested instances, reorder properties, and turn a component into a set with **Add variant**.
- Make components behave like real controls: the Behaviour section turns a component or set into a Button, Switch, Checkbox, Slider, Tabs, Text field, or another of 15 Reka UI-style controls, and **View → Preview** (<kbd>⌥</kbd><kbd>⌘</kbd><kbd>↩</kbd>) lets you use them live without changing the document. Scripts, AI and MCP tools, and design JSX build them too.
- Bulleted and numbered lists in text, as in Figma, with nesting, list and paragraph spacing, indents, and hanging markers, set from the Typography section or with <kbd>⇧</kbd><kbd>⌘</kbd><kbd>8</kbd> and <kbd>⇧</kbd><kbd>⌘</kbd><kbd>7</kbd>. Lists round-trip through `.fig` files, the Figma clipboard, HTML, design JSX, and scripts.
- Style selected characters while editing text: the Fill and Typography fields show and change the selection, as in Figma. Scripts style ranges with `getStyledTextSegments` and the `getRange`/`setRange` methods, design JSX writes `<Span>` and `<Paragraph>` with decoration style, colour, thickness, offset, and skip ink, and HTML, Tailwind, Vue, and React exports keep character styles and lists.
- Fill layers with shaders from the open-source [`shaders`](https://shaders.com) library: the fill picker's Shader tab stacks effects with generated controls and takes presets copied from shaders.com. The canvas shows the first frame and preview plays it where WebGPU is available; `.fig` files keep the frame as an image so Figma still opens them.
- Edit shapes on the canvas, as in Figma: gradient end points and stops while a gradient's picker is open, corner radius handles on rectangles, polygons, and stars, and a polygon's or star's point count and inner ratio, also in the properties panel.
- Lock a layer's aspect ratio beside its width and height, as in Figma; the lock survives `.fig` files and the clipboard and is available in the plugin API.
- Show the pixel grid when zoomed in, toggled with **View → Pixel Grid** or <kbd>⇧</kbd><kbd>'</kbd>, and snap moves, resizes, and drawing to whole pixels with **Snap to Pixel Grid** (<kbd>⇧</kbd><kbd>⌘</kbd><kbd>'</kbd>).
- Rearrange auto layout as in Figma: drag several layers along a row or column as one block, move a layer one slot with the arrow keys, take it out with **Ignore auto layout**, and see the layout's children outlined on hover.
- Edit several layers at once: a multi-selection gets Layout, Typography, corner radius, and stroke sections, plus **Selection colors**, which recolours a colour everywhere it is used.
- Check designs in the new Lint tab: issues are grouped by rule, marked on the canvas and in the Layers panel, and many have one-click fixes such as binding colours to matching variables. `openpencil lint --fix` and the `lint` and `lint_fix` tools apply the same fixes outside the app.
- Edit variables in a redesigned variables dialog: collections and groups in a sidebar, search across names and values, inline editing, drag to reorder, multi-select, CSS names and expressions, per-mode conditions written in plain words, and a live stylesheet preview.
- Import and export variables, text styles, and effect styles as W3C design tokens, in the shape Figma imports, from the variables dialog, `openpencil tokens --format dtcg`, and the `import_design_tokens` tool. Copy variables as CSS or a Tailwind v4 theme, or print them with `openpencil tokens`.
- Insert icons from Iconify's open-source sets with an icon picker in the toolbar, Object menu, and command palette. Placed icons keep their name, so the Icon section can swap or recolour them, and exports write them as icons.
- See the selection as a Vue or React component in the Code tab, styled with CSS or Tailwind, and see which layer the cursor's element draws, with design issues underlined in the code.
- Export components to Storybook with `openpencil export -f storybook`: one story file per component for React, Vue, or HTML, with variant controls, and with `--framework vue` or `--framework react`, working Reka UI or Radix UI components (#727). Export HTML and Tailwind JSX from the app and the CLI (`-f tailwind-jsx`), with vector shapes as inline SVG, and choose PPTX in the Export panel.
- Open a `.fig`, `.pen`, or other supported document by dragging it onto the window, paste SVG markup copied as text, such as Figma's Copy as SVG, and open HTML files in CLI commands such as `openpencil tree` and `openpencil convert`.
- Save the open document to cloud storage with **File → Save to storage…**; the tab stays bound to the stored copy, so Save and auto-save write to the bucket. A new Cloud Storage guide covers setup.
- Set up AI in a few steps with guided setup: on first launch, pick a coding agent on this computer, an API account, or a local server. The desktop app installs or updates agents, adapters, the MCP server, and the Harness companion, tests each connection, and proposes models, and the MCP server and Harness companion print their version with `--version`; sign in to OpenRouter instead of pasting a key.
- Choose how much an AI model thinks for each message, from Off to Extra high, attach images by dropping them on the chat, and watch designs appear on the canvas while direct providers stream JSX.
- Review and undo AI edits from the chat: each tool call shows a summary, its input and output, and a before-and-after image with a JSX diff. Revert a reply's edits, restore them, regenerate the last reply, retry a failed message, or edit and resend it; undoing an edit tells the AI on the next message.
- Control the running app from the CLI and MCP: `openpencil documents`, `undo`, `redo`, and `settings`, the matching MCP tools, `openpencil tool list`, `describe`, and `call` to run any MCP tool from the shell, and `openpencil diff` with the `diff_visual` and `diff_apply` tools to compare and replay changes. Share only the selected layers with MCP clients from **Settings → MCP → Local server** or `OPENPENCIL_MCP_SCOPE=selection`.
- Diagnose failures from **Settings → Diagnostics**: errors, failed AI chats, and broken tool calls are recorded with scrubbed messages and stacks, filterable and copyable with the app version.
- Choose an accent color in **Settings → General → Appearance**, and customize the toolbar in **Settings → Toolbar** or from its right-click menu: hide, reorder, and regroup tools on desktop and mobile.
- Use more of the Figma plugin API: `instance.swapComponent()`, `detachInstance()`, `figma.getNodeByIdAsync()`, and `getMainComponentAsync()`. OpenPencil's own `openpencil` script global adds comments and controls.
- Write design JSX with more of the document: `visible`, `locked`, `constraints`, `italic`, full stroke props, and component properties set by name on `<Instance>` (#750). JSX export writes them back with every fill, effect, mask, and variable binding, and TSX can use `@open-pencil/design-jsx` as its JSX import source.
- New SDK entry points: pass an ID generator to `new SceneGraph()`, place pasted content with `resolvePasteTarget` from `@open-pencil/core/editor`, compute Flatten and Outline stroke with `flattenNodesToVectorProps` and `outlineStrokeNodesToVectorProps` from `@open-pencil/core/canvas`, and import `designDocumentToSceneGraph` from `@open-pencil/dom-css/scene-graph` in browser builds.
- New npm packages: `@open-pencil/design-jsx` for writing and exporting design JSX, and `@open-pencil/emit`, which it and the exporters use to print source code.

### Changed

- The font weight list offers only the weights the text's family has, as in Figma. Switching family keeps the weight and italic where the new family has them, otherwise the nearest weight with the same slant.
- Selecting, dragging, drawing, duplicating, and pasting follow Figma: clicks select a top-level frame's direct children and double-clicks go deeper, dragged layers land in the frame under the cursor, groups and locked frames never take a drop, and Space, Shift, and Control change how a drag reparents. A layer leaves auto layout once its edge is about 5 px past the frame instead of after the cursor travels 96 px.
- Layers move and turn as in Figma, on the canvas and in scripts: the properties panel shows X and Y of a turned layer's box and a counterclockwise rotation, children of groups report positions in their container, and groups and booleans refit to their contents.
- New layers, pages, and sections look as in Figma: white frames that clip, #D9D9D9 shapes, black 1 px lines, theme-aware page backgrounds and sections, numbered names such as "Rectangle 2", and Figma's results for Group, Frame selection, Create component, booleans, and Combine as variants.
- A layer keeps its stroke weight and alignment without strokes, as in Figma, and strokes take the same paints fills have, including gradients and images (#797).
- Layers inside components and instances are outlined in purple, and bound variables show as a neutral chip instead of purple text.
- Import SVG as editable layers, as pasting into Figma does: groups, one vector per shape, text layers, and clip path groups instead of one merged vector (#734).
- The plugin API refuses to move, rotate, constrain, or mask a layer an instance takes from its component, with Figma's errors; slot content stays editable.
- Popovers, menus, selects, and pickers share one look and motion, selects open over their field, every section adds and removes items with + and −, and variables, styles, and swap components come from one searchable list.
- The desktop app shows updates in a Software Update window with formatted release notes and cancellable download progress (#743). On macOS and Linux you choose when to restart, and restarting asks about unsaved documents first.
- Design lint reports far fewer false positives, checks touch targets against WCAG 2.2 AA in the Recommended preset, and reports unbound colours and off-scale spacing as suggestions.
- HTML and Tailwind export write variable-bound values as their tokens, such as `var(--color-primary)` or `bg-primary`, and Tailwind JSX uses the same class mapping as Tailwind HTML.
- The AI chat starts with comment, variable, lint, page, and image export tools on, keeps working on the page where it started, and recommends the latest models, with Claude Sonnet 5.5 and GPT-6.1 Sol as the new defaults. Saved profiles keep their model.
- Invalid tool arguments from the AI chat, CLI, or WebMCP name the tool and list every problem with its location.
- Run Pi with the providers and default model you signed in to in the Pi CLI, and see what to fix when its Harness companion or MCP server is missing or out of date. Codex install instructions point at `@agentclientprotocol/codex-acp`, which replaces `@zed-industries/codex-acp`.
- `get_selection` returns the selected layers with their direct children by default and takes a `depth`, and `openpencil eval` prints the value of a script's last expression.
- Opening a share link opens the room in its own tab, so an open document is never changed, and leaving a room keeps its file as a local copy.
- Text in both themes meets the WCAG AA contrast ratio of 4.5:1.
- The Linux AppImage no longer bundles `xdg-open` and relies on the system's `xdg-utils`.

### Fixed

- Auto-sized text and Hug containers reflow when readable provisional emoji or script fallback metrics settle, without adding an Undo step.

- Apply canonical stroke edits through the existing affected-node transaction, avoiding whole-document clones on large files; preserve paint bindings through scoped Undo and rollback.

- Reject canceled or expired Undo/Redo and raster exports before their queued work starts, so an unstarted timed-out request cannot replay later.

- Limit component synchronization layout to the edited definitions, their instances, and affected auto-layout ancestors. Building new controls no longer repeatedly lays out unrelated trees on the same page; parent resizing, sibling placement, and cross-page instances remain synchronized.
- Save imported documents after deleting nested children from a loaded component: resumed instances now reconcile every source level against the live component, including child order and nested component swaps, while preserving instance-owned slot content.
- Write complete JSX when `get_jsx` receives a filesystem `path`, keeping the 12,000-character limit only for inline previews. MCP refuses truncated responses from older editors before writing a file, preserving existing exports; main component metadata and general instance/vector fidelity limits are documented separately.

- Canonical `update_node` journals its affected property/layout fields with bounded Undo and rollback, so loading unrelated pages no longer blocks a small edit at the whole-document limit. Other atomic tools retain their existing document checkpoint limit. Committed event-delivery failures keep the edit undoable.
- `Icon` and inline SVG color variables resolve to COLOR values and bind only authored `currentColor` path paints. Literal multicolor paths remain unbound; token bindings survive Save/import.
- Duplicating a layer subtree and importing a transfer forest preserve shared FIG backing buffers within one isolated copy instead of cloning the same archive-sized buffer for each layer. Transfer Undo captures retain their own isolated copy.
- Closing a document flushes its AI transcript and releases the live chat before disposing the editor. Failed persistence leaves the tab retryable, and delayed history reads cannot bind a closed tab's transcript to another editor.
- Page-load rollback snapshots preserve shared FIG backing buffers across candidate nodes instead of copying the same buffer for each node, while retaining isolated recovery data.
- Appending JSX variants to an existing component set and renaming known variant dimensions refresh native choices without replacing property IDs or unrelated values. Native variant renames retain complete Undo/Redo state, and failed render completion restores metadata and source edit markers.

- Host component synchronization preserves the appearance and size of an explicitly swapped nested instance, including scaled bindings and local paint overrides, instead of restoring the original slot's appearance.

- Retain the owned immutable FIG payload across Undo snapshots when only source edit markers change, without aliasing live data or reducing history/recovery protection.
- Roll back JSX creation and initial layout failures without leaking partial layers; preserve unrelated concurrent content and report rollback conflicts. Free Yoga trees when layout application throws.
- Remap local preferred component IDs through FIG export/import and preserve actual library asset keys, including keys shaped like GUIDs.
- Report raster renderer availability, surface allocation and image encoding failures separately from genuinely empty visible bounds.

- JSX diff previews and application now treat supported aliases (`fontSize`/`size`, `width`/`w`, etc.) as the same attribute, including old-value checks. Conflicting aliases fail instead of silently overriding or ignoring an edit.
- Saved plain text uses the same paragraph raster as live text when a cached check proves every saved glyph outline and placement matches the exact loaded font. Imported layout differences, missing fonts, decorations, path text and complex/blended paints retain their saved-glyph rendering; one bounded font scope is shared across prepared paragraphs.

- MCP design JSX respects replacement and insertion placement, keeps variable bindings through the desktop bridge, and restores dependent component instances on other pages with their original layer IDs and overrides when a structural edit is undone.
- Store crash recovery snapshots of any size. Snapshots of documents over 127 MiB failed to save to IndexedDB and stayed in memory for the rest of the session.
- HTML, Tailwind JSX, and Vue and React exports keep a text's character styles as spans, its lists as nested lists with Figma's markers, its paragraph spacing and first-line indent, and its decoration style, colour, thickness, offset, and skip ink, where they wrote the whole text in one style. Importing HTML reads them back: inline formatting and box-less paragraphs, headings, and lists join into one text layer.
- Underlines and strikethroughs are drawn where and as Figma draws them, from the font's own metrics: underlines break around descenders, dotted ones are round dots, and a set offset or thickness is kept, in reopened `.fig` files too, which drew no strikethroughs and misplaced the other styles. Text saved to `.fig` or copied to Figma keeps its decorations there, where Figma showed underlined text without them and underlined text over several lines not at all.
- Text that mixes font sizes keeps its auto line height when a `.fig` file OpenPencil saved is reopened. Every line took the height of the first, which pushed later lines down and cut them off.
- Instances follow their component's structure as in Figma: wrapping a layer of the component in auto layout or a frame, or moving it into another frame of the component, moves the layer's copy in every instance with its overrides instead of adding a fresh copy beside the old one, and moving a layer out of the component or deleting it removes its copy from every instance, while undo brings the copies back with their overrides.
- Dragging a number field in the properties panel moves its value in whole steps instead of fractions on high-density screens.
- While text is being edited, its caret and selection follow a property dragged in the panel instead of catching up when the mouse is released.
- Outline text, flatten, and boolean operations on text place glyphs where the canvas draws them; lines sat lower by about a quarter of the font size.
- Tailwind exports keep corner radius: Tailwind JSX and HTML with Tailwind classes write radius from Tailwind's radius scale, such as `rounded-xl` for 12px, instead of classes like `rounded-3` that Tailwind v4 does not generate, and other values as `rounded-[20px]`.
- ⌘Z right after arrow-key nudges undoes the nudges instead of the edit before them.
- <kbd>⇧</kbd>-dragging a corner handle follows the side the pointer stretched most relative to the layer's size, as Figma does, instead of the side it moved more pixels along.
- The AI provider list labels its "Your agents" and "Providers" groups in the app language instead of always in English.
- Tooltips no longer appear when a popover such as the colour picker focuses its first control on open; they still show for keyboard focus. Moving the pointer along a row of buttons switches tooltips at once instead of blinking out, and tooltips centre on their control instead of sitting a few pixels off.
- A layer that ignores auto layout follows its constraints when its auto layout frame resizes, as in Figma: a badge pinned to the right of a Hug button stays on its corner as the label grows or shrinks, a centred one stays centred, and one set to Left & right or Scale stretches with the frame, also inside a Fill frame and for the layers in a stretched overlay. Layers in a reopened `.fig` file keep the places the file saved until an edit resizes their frame.
- Polygons and stars draw and export to SVG with their corner radius and smoothing as Figma rounds them, inner star corners included, and copy to and from Figma with their point count and a star's inner ratio; they were drawn with sharp corners, also from `.fig` files, and pasted into Figma as empty shapes.
- The font picker opens at the current font instead of the top of the list.
- Undo after adding, switching, or removing auto layout, or wrapping layers in it with <kbd>⇧</kbd><kbd>A</kbd>, puts back every layer the layout moved or resized, and the new frame takes the place of the topmost layer it wraps, as in Figma. Setting the layout a frame already has, or aligning layers that auto layout places, no longer records an undo step, and undoing a drag out of an auto layout frame puts the layer back in its slot.
- A Fill child in a Hug frame keeps its size, as in Figma, instead of collapsing the frame: along the layout the frame hugs the child as it is, and across it the frame hugs the other children, keeping its size when every child fills. A Fill line stays a line, placed where its row aligns the other layers.
- A frame in a reopened `.fig` file lays out again when you resize it, add auto layout, padding, or a gap to it, or add, move, or remove a layer in it or in an auto layout inside it, instead of keeping its layers where the file had them; a Fill layer fills a resized frame while you drag.
- A Hug frame grows with its text while the text is typed, as in Figma, instead of only when editing ends.
- `figma.currentPage.backgrounds` in the plugin API and `eval` scripts takes Figma paints, as `fills` does.
- Cmd+Z and Shift+Cmd+Z undo and redo while a fill, stroke, or colour picker is open, as in Figma, and undo reverts the picker's latest change rather than the edit before it.
- A frame's name reads on the section it sits in: on a dark page, frames in a white section had white names on white. Names now fade more on light backgrounds than on dark ones, as Figma's do.
- `lineHeight` and `letterSpacing` in the plugin API and `eval` scripts read and write Figma's `{ unit, value }`, including percent of the font size and `{ unit: 'AUTO' }`; assigning those objects used to leave the text undrawn.
- Gradients from Figma files and Figma pastes draw as they do in Figma: they ran backwards or sat in the wrong place unless they were symmetric, because the canvas applied Figma's gradient transform the wrong way round. SVG export and import keep a gradient exactly, and a new gradient starts as Figma's does, top to bottom from the fill colour to a darker shade, keeping its transform when switched between linear, radial, angular, and diamond.
- Changing stroke position, per-side stroke weights, or an effect with several layers selected changes all of them, not only the first.
- Draw layer blur, drop and inner shadows, and background blur with Figma's falloff. They spread about 15% too far, with a long faint edge Figma does not draw; SVG export keeps Figma's own `stdDeviation` of half the radius.
- Load the fonts of SVG text before placing it from `import_svg`, so centred and right-aligned text sits where Figma puts it; `figma.loadFontAsync` in scripts now loads the font instead of doing nothing.
- Gradient stops in the fill picker show their full position and opacity, such as 100%, instead of cutting them off; each stop's colour, hex, and opacity share one field as in the properties panel.
- Keep design variable bindings and honor `replace_id` and `insert_index` when `render` runs through the stdio MCP server (`openpencil-mcp`) against the desktop or web app, as it already did through the HTTP endpoint (#830).
- Draw layers masked by a group, such as Figma's clip path groups, instead of hiding them; a group used as a mask masks with what its layers draw.
- Draw what a mask masks through the mask's opacity and layer blur, as Figma does, so a half-transparent or blurred mask fades or softens its layers instead of masking them fully. An outline mask ignores how opaque its fill is, and a luminance mask counts its opacity twice, as in Figma.
- Import SVG files that start with an XML declaration or doctype, such as Illustrator and Inkscape exports, instead of reporting no supported elements.
- Keep `fill-opacity` and `stroke-opacity` when importing SVG instead of drawing those paints opaque.
- Stopping an AI chat reply ends it cleanly. The reply is marked *Stopped*, its reasoning stops showing *Thinking…*, and a tool call that never reported back stops spinning and tells the AI on your next message whether it changed the document, also in conversations saved mid-reply. A tool already running finishes, and calls still waiting for their turn change nothing.
- Keep an AI chat going when a script it runs through `eval` returns layers or pages inside an object or list, or values such as `NaN` or a `Map`; the reply used to stop with an invalid-prompt error. The model now gets such results as JSON.
- Use an API key saved in Settings for the open AI chat right away, including when asking again after a failed request, instead of only after reloading; the failure's notice closes once the request is sent again.
- Renaming a section title on the canvas keeps the title's size, weight, and place. Section titles draw in Inter SemiBold rather than an emboldened regular weight, and labels that are not rotated sit on whole pixels, so they stay crisp.
- Save HTML imported with `openpencil import` with its layout applied: layers in a flex container sit where its padding and gap place them instead of all at the top left (#788).
- Import HTML and CSS laid out as a browser lays it out, in `openpencil import` and the app's HTML import. Block elements stack and fill their parent's width, inline elements and buttons hug their content, flex items stretch across their container by default, `flex: 1` and `width: 100%` fill, padding and borders sit outside a `width` or `height` unless `box-sizing: border-box`, `display: none` is left out, and text wraps or hugs its content instead of taking an estimated size. Before, block elements became fixed 100 × 100 frames without layout, so `openpencil import` left their children at the top left (#788).
- Import HTML and CSS laid out as a browser lays it out, in `openpencil import` and the app's HTML import. Block elements stack and fill their parent's width, inline elements and buttons hug their content, flex items stretch across their container by default, `flex: 1` and `width: 100%` fill, padding and borders sit outside a `width` or `height` unless `box-sizing: border-box`, `display: none` is left out, and text wraps or hugs its content instead of taking an estimated size. Before, `openpencil import` saved every child at the top left, and block elements became fixed 100 × 100 frames (#788).
- Import HTML and CSS laid out as a browser lays it out, in `openpencil import`, the app's HTML import, and the code panel's HTML preview, which showed its layers without any layout. Block elements stack and fill their parent's width, inline elements and buttons hug their content, flex items stretch across their container by default, `flex: 1` and `width: 100%` fill, padding and borders sit outside a `width` or `height` unless `box-sizing: border-box`, `display: none` is left out, and text wraps or hugs its content instead of taking an estimated size. Before, `openpencil import` saved every child at the top left, and block elements became fixed 100 × 100 frames (#788).
- Apply rules that use the universal selector, such as Tailwind's `box-sizing: border-box` base style, when HTML and Tailwind are converted headlessly, and let a `padding-inline` or `padding-block` override a less specific rule's padding.
- Keep exported HTML at the size it has in OpenPencil when a box has padding or a border: it declares `box-sizing: border-box`, so its width includes them in HTML used without OpenPencil's standalone stylesheet.
- Size design JSX text in a frame without auto layout, such as text an AI agent or MCP client renders into a plain frame, to its content instead of 100 × 100.
- Size text in `.pen` files from its font instead of estimating its width from the number of characters; wrapping text without a width wraps at the width of its content.
- Reject an argument an AI, MCP, CLI, or WebMCP tool does not take, such as `properties: { y: 500 }` for `update_node` or `font: { family }` for `set_font`, and name it, instead of reporting success without changing anything (#977).
- Choose an instance's variant by its variant property in design JSX, such as `<Instance component="Button" State="Pressed" />`, without a warning that the property is unsupported.
- Lay out design JSX `justifyContent="space-between"`, `"flex-start"`, and `"flex-end"`, and `alignItems="flex-end"` and `"flex-start"`, as written instead of at the start; `space-around` and `space-evenly`, which auto layout has no equivalent for, still start at the start, and align a row's children by their baseline with `items="baseline"`, which JSX export now writes instead of dropping. A `.pen` padding with one or three values fills the sides it leaves out as CSS does, instead of with 0.
- Keep memory flat while the AI chat or an MCP client edits a document (#587). Each edit kept two copies of its whole page in the undo history, about 10 MB a call on a 400-layer page, until the 200-step history limit, so long sessions grew until the app ran out of memory; an edit now keeps only the layers it changed, and undoing it leaves the other layers as they are.
- Keep the new-tab button and the active tab in view when many documents are open. Tabs shrink before the tab bar scrolls, the clipped side fades with a chevron that scrolls to hidden tabs, and the new-tab button is a compact button beside the last tab instead of scrolling away with the tabs.
- Show when the browser menubar has more menus than fit in the left panel. The clipped side fades out and a chevron scrolls to the hidden menus; before, Arrange and Text could be cut off with no sign the bar scrolls.
- List storage documents as soon as storage settings are saved. The home tab kept asking to configure storage until it next refreshed, which happened on window focus or up to a minute later.
- Keep a Figma file's exposed nested instances when it is saved from OpenPencil; their properties stopped showing on the outer component's instances in Figma.
- Paste here and Paste to replace land where they should inside a frame that is offset, rotated, or flipped: Paste here centers on the cursor, and Paste to replace starts the replacement at the target's top-left corner, as in Figma, instead of centering it on canvas coordinates read as the frame's own.
- Reflow components and instances opened from a `.fig` file once a layer in them is edited, as Figma does: restyling the label of a Hug button, or changing a layer's size, now resizes the button instead of leaving it at the size the file saved.
- Size auto-width and auto-height text, and the Hug frames around it, with its real font once the face loads; text laid out while its weight, style, or characters were still loading kept a fallback size. The weight control now loads the face before applying it, as the family control does.
- Never let a component contain itself, as in Figma: an instance dragged, dropped or inserted into its own component, or into a component it shows, lands in the nearest frame that can hold it, and the plugin API's `appendChild` and `insertChild` throw Figma's cycle error.
- Offer only components that fit in an instance swap's list: one that would contain itself, such as the component the swapped layer sits in, is left out, and a variant is named with its set, as in `Badge / State=Info`.
- Undo a change to a property that drives several layers of an instance on all of them, and show an instance's value on a layer linked to that property after the instance was made.
- Open S3 storage documents and show their previews on servers that answer a byte-range read with `200` instead of `206`, such as `rclone serve s3`. Previews failed to load, and the browser cached the partial reply as the whole document, so opening it failed with "Invalid fig-kiwi container". Storage requests now skip the browser cache, and a `200` whose `Content-Range` matches the request is accepted.
- Keep a layer's `.fig` ID the same across saves (#890). Layers created in OpenPencil were numbered in tree order on each save until the file was reopened, so inserting a layer shifted the IDs of the layers after it; variable collections and modes could also be renumbered.
- Store crash recovery snapshots of documents over 127 MiB, and in Safari Private Browsing. Those snapshots failed to save to IndexedDB and stayed in memory for the rest of the session.
- Keep browser-stored documents over 127 MiB: Chromium refused to save them to IndexedDB. Binary data is stored as Blobs where the browser allows it, and as plain bytes in Safari Private Browsing, where IndexedDB cannot store Blobs.
- Keep an opened `.fig` file saved until it is edited. Laying out its first page, which recomputes auto-layout sizes and positions, and showing another page for the first time, which loads its layers from the file, marked it unsaved, so closing it asked to save changes nobody made.
- Save variable edits to an opened `.fig` file. After changing only variables, variable collections, or the document's color profile or libraries, saving wrote the original file unchanged.
- Run crash recovery and autosave after edits, not whenever the canvas redraws. Opening a document, laying out a page, or loading a font started a recovery snapshot or an autosave, which encoded the whole document again once another page had loaded. In Safari, where every opened file gets recovery snapshots, a large page froze the browser for minutes after it first appeared.
- Open image-heavy `.fig` files without the canvas running out of memory (#924). Decoded images stay within a fixed budget, and documents with many large images draw previews sized to the view, decoded in the background a few at a time, while exports keep the full images.
- Show tables in AI chat replies at the chat's text size and weight, with a light header and copy as their only action, and task lists with a checkbox in place of the bullet. Tooltips, the copy menu, and the confirmation before opening a link follow the app's style, and links no longer load each site's favicon.
- Fill one axis of a grid cell: a grid child set to fill its width or its height no longer fills both, and an auto-layout child of a grid keeps its own size unless it fills, as in Figma. Design JSX renders and exports `w="fill"` and `h="fill"` in grids, and HTML and Tailwind export leave out the size a child fills, so it stretches in the browser too.
- Resize auto-layout frames that fill across their parent with it: one with a fixed size on that axis kept its old size. A filling child still counts toward a hugging parent's size, as in Figma.
- Set `layoutSizingHorizontal` and `layoutSizingVertical` in scripts as Figma does: Fill is recorded on the child for that axis instead of on the frame's own sizing, which `.fig` export dropped, text switches its `textAutoResize`, and sizing Figma refuses, such as Hug on a frame without auto layout, throws Figma's error.
- Read geometry in scripts after an edit without waiting for the script to finish: `x`, `y`, `width`, `height`, `relativeTransform`, `absoluteTransform`, `absoluteBoundingBox`, and `absoluteRenderBounds` lay out what the script changed first, as in Figma, so a hugging parent reports its new size right after a child is added.
- Size text from scripts as Figma does: `figma.createText()` makes empty 12px text that sizes itself to its content instead of a fixed 100px box, auto-sizing text resizes when its characters, font, or size change, and `resize()` fixes its size.
- Draw segmented controls in the properties panel at the height of the fields beside them.
- Keep saving AI chat history in Safari Private Browsing after a message with an image or a reply that changed the document. Safari cannot store image data that way in a private window, so the conversation stopped saving from that point and showed "Chat history could not be saved".
- Keep a component set's dashed border one pixel wide at every zoom; zooming in after opening a page scaled it into thick dashes until the page was redrawn.
- Keep a layer's blend mode, such as Multiply or Screen, when saving to `.fig`; it was dropped and the layer reopened as pass-through.
- Stop the underline of saved or Figma text where the text ends instead of running to the edge of its text box.
- Keep the content of an imported auto layout frame centred, or otherwise aligned, within the width its parent stretches it to, instead of laying it out as if the frame hugged its content.
- `figma.combineAsVariants` derives variant properties from components named as Figma names variants, such as `State=On, Size=Large`, as Combine as variants in the editor now does too; before, only slash-separated names gave the set any properties.
- HTML and Tailwind export place layers of frames without auto layout at their coordinates instead of stacking them, leave the size of hugging auto layout frames and auto-sizing text to their content, and round ellipses.
- Show the blinking caret in a new, empty text layer before the first character is typed.
- Frames and instances that fill their auto layout parent keep filling it when saved to `.fig` or copied to Figma, instead of shrinking to their content there, as a filled title row or full-width button did.
- Text saved to `.fig` or copied to Figma keeps its layout in Figma: it wraps at the layer's width with its alignment and line height, and keeps ligatures and contextual forms such as Inter's arrows, where Figma previously drew every saved OpenPencil text layer on one unwrapped line (#914). Text copied to Figma also keeps growing with its content, instead of keeping the width OpenPencil measured, which clipped or wrapped labels Figma draws wider.
- Release a document's memory when its tab closes. Every closed tab kept its scene, canvas, and editor panels alive until reload, so memory grew with each document opened and closed. Menus and shortcuts now also follow the active document, so Undo and Redo are offered according to its history rather than the first document opened.
- Put a deleted variable back in its place in its collection when the deletion is undone, instead of at the end.
- Start Pi chats with OpenPencil's MCP tools when the Harness companion runs on Node 22.15 or later; the companion now installs the dependency Pi's MCP adapter needs and loads its TypeScript sources. A reopened Pi session starts fresh instead of failing to resume its in-memory sandbox, and npm output from Pi no longer mixes into the companion's protocol.
- Keep a chat message in the composer when the chat cannot start, instead of discarding it.
- Import HTML and CSS with the right shadow and border colors. A shadow whose color follows its lengths, as CSS usually writes it, and a `border` with a color function such as `rgb(226, 232, 240)` came in black. Every layer of a `box-shadow` list now imports, `inset` ones as inner shadows, and lengths in `%`, `em`, or `vh` are no longer read as pixels.
- Accept a CSS `box-shadow` list in design JSX's `shadow` prop: the color may come first, a fourth length sets the spread, several layers add several shadows, and `inset` makes an inner shadow. A color before the lengths or a spread made the shadow black.
- Read `repeat()` and `minmax()` in design JSX grid tracks, such as `columns="repeat(7, 1fr)"`, which collapsed the grid to near-zero columns. A track the grid cannot express sizes to its content instead of to 0.
- Lay out text set to fill its container the way Figma does: fill text in an auto-layout row now shares the free space with its siblings instead of keeping its old width and overflowing the row.
- Report what `linearGradient`, `radialGradient`, `angularGradient`, and `diamondGradient` expect when design JSX passes them something other than an array of stops, such as `linearGradient('#3b82f6')`, instead of failing with `stops.map is not a function`, so an AI agent can correct the call.
- Keep the canvas context menu open when you right-click again right after closing it, which could close it again at once, especially with reduced motion.
- Show and edit the component properties of an instance nested inside another instance; they were missing because the nested instance was read as its own component.
- Read and set `componentPropertyReferences` in the plugin API with property keys such as `Label#prop:1a2b`, as `componentPropertyDefinitions` lists them and Figma uses them, instead of internal property ids.
- Open Figma files that use slots with each instance's own slot content instead of its component's default, keep slot properties, their settings, and instance content when saving back to `.fig`, and keep an instance's slot content, and that of instances nested in it with the same names, when you switch its variant or swap it.
- Report a failed MCP `save_file` or `new_document` save as an error instead of success, and ask for a path rather than opening a Save dialog when the document has never been saved.
- Undo layers that MCP clients and the CLI create, delete, or rearrange in the running app, including `render` and `eval` changes, with Edit → Undo. Previously only their property edits were undoable. Undoing these and AI chat edits also reverts what they change on other pages, the pages themselves, and variables and collections, which undo used to leave as they were; an edit that lands while a colour picker is open becomes its own undo step instead of joining the picker's.
- Save a `.fig` file that was opened and not edited yet. In the app the save never finished, and MCP `save_file` timed out without writing the file.
- Show the text, visibility, or swapped component an instance sets when the component gains that layer after the instance was placed, instead of the component's default ([#849](https://github.com/open-pencil/open-pencil/issues/849)).
- Show `.fig` thumbnails in the desktop app's recent files, which the app was not permitted to read.
- Give paints set through the plugin API, `eval`, and AI and MCP scripts an opacity of 1 and make them visible when the script leaves those out, as Figma does. Such paints were stored without them, which the Design panel could not show.
- Keep a layer's other plugin data when you pick or clear a colour in OkHCL. Picking one rewrote every plugin-data entry on the layer, including other plugins' and its export settings, as OkHCL data.
- Keep a model picker in Settings → Models open when you open it while the model editor is still sliding in. Focus jumped to the editor's first field once the animation ended, which closed the picker.
- Show variable-bound colours and numbers correctly when a `.fig` exported from OpenPencil opens in Figma. Figma draws the value a bound field stores until something makes it resolve the variable again, and exports stored the colour from before the binding, so a bound fill appeared in its old colour. Each bound field is now written as it resolves in its layer's mode, or in the collection's default mode when the layer sets none.
- Give strokes the same paints fills have. A `.fig` file's gradient or image stroke imported as opaque black, because a stroke could hold only one color; it now keeps its stops, transform, and image, and renders and saves the way the same paint does as a fill. The stroke panel opens the fill picker, so you can give a stroke a gradient or an image and its weight, align, cap, join, and dashes stay as they were ([#797](https://github.com/open-pencil/open-pencil/issues/797)).
- Stop showing a “signal is aborted without reason” error when you switch pages again before the previous page has finished loading.
- Export layers with two shadows as one `effects` prop instead of repeating the `shadow` attribute, background blurs as `backgroundBlur` instead of a layer blur, hidden children with `visible={false}` instead of leaving them out, and per-corner radii even when the uniform radius is 0.
- Apply `strokeAlign`, `strokeDash`, `minH`, and `maxH` in design JSX, which were accepted but ignored, and make `minW` and `maxW` set the layer's minimum and maximum width rather than only clamping its initial width.
- Keep the text, visibility, or swapped component an instance sets through a component property when a page it appears on loads on its own, instead of resetting it to the component's default.
- Run XPath queries from `openpencil query` and the MCP `query_nodes` tool under Node, which failed with `evaluateXPathToNodes is not a function` (#787).
- Render the canvas with the Vue SDK's `CanvasRoot` and `CanvasSurface`; CanvasKit never started there and the canvas stayed blank.
- Keep the view centered on what you were looking at when zooming to 100% or another fixed level, instead of jumping elsewhere whenever the zoom changes.
- Draw collaborators' names on their cursors with proper letter spacing and fallback fonts, and end long names with an ellipsis.
- Keep one layer tree in a shared room when people move layers into each other at the same time. Both moves used to apply, making each layer the other's parent, which hid both and froze the editor of anyone in the room; now every peer undoes the latest move that would close the loop, a layer moved into a parent someone else deleted returns to its previous parent, and a layer left without any parent goes back to its page ([#888](https://github.com/open-pencil/open-pencil/issues/888)).
- Show every peer in a shared room the same layer list in the same order. A layer moved to another parent stayed listed under its old one for others, reordering layers did not reach them, and layers added at the same time could end up in different orders or drop out of the Layers panel; now moves, reorders, and additions by different people merge, and only two people moving the same layer at once have one move win ([#889](https://github.com/open-pencil/open-pencil/issues/889)).
- Keep every layer two people add at the same time in a shared room. Each editor window started its layer IDs from the same counter, so layers added at once could get the same IDs and one person's would replace the other's; each window now mints IDs under a random session of its own, while the CLI and MCP server keep giving a file's layers the same IDs on every run.
- Keep line breaks in multi-line text when exporting OpenPencil JSX, so `get_jsx` output and `openpencil export -f jsx` render back to the same text instead of joining the lines with spaces.
- Announce unavailable commands in the command palette as disabled to screen readers.
- Show an imported Figma page's background, and keep a background you change when you switch pages or save the document.
- Keep fixed-size text from collapsing and clipping beside smaller siblings in a Hug auto-layout container.
- Keep the text and icon an instance was given when a page loads on its own, instead of resynchronising it back to the component's defaults.
- Keep the ordering keys a `.fig` gave its layers when saving one again, instead of renumbering every sibling, and give every layer on a canvas its own key. Shared styles, variables and the canvas's own layers were numbered in separate passes that each restarted, so Figma saw siblings claiming the same position and ordered them arbitrarily.
- Keep a `.fig` variable's description, scopes, code syntax, publishing visibility, and plugin data when saving the file, and a collection's plugin data and default mode. Saving previously wrote every variable as published to all scopes with no description or code names, and made the first mode the default.
- Clear a `.fig` fill or stroke's colour-variable binding when you unbind it, instead of exporting the variable the layer was imported with and rebinding it on reopen. An emptied binding record is no longer written into the file either.
- Keep an AI reply running in the chat panel, with its Stop button, when you switch pages, instead of detaching the panel from the reply in progress.
- Undo an AI edit while another page is on screen; undo previously did nothing until you returned to the page the AI changed.
- Type `parameterConsumptionMap`, `propRefValue`, and `expressionValue` in the Kiwi `NodeChange` codec, which `fig.kiwi` declares but the TypeScript definitions omitted, so reading them no longer needs a cast.
- Read `.fig` text bound to a string variable, in a component and through an instance override, and keep the bound value where Figma does instead of applying a literal override the layer's binding retires. Text bindings also survive export. Bound text and visibility then follow the variable when its value or the shown mode changes, on the canvas and in saved `.fig` files; a bound font family still changes only when the file is reopened.
- Draw a `.fig` fill or stroke bound to a colour variable at the variable's own transparency, which was previously ignored in favour of the paint's own opacity — so a translucent token drew opaque, and an opacity left over from an override the binding supersedes drew in its place.
- Export the instance overrides you make in OpenPencil to `.fig` beyond text and fill colour — strokes, size, padding and spacing, sizing modes, text styles, visibility, name, opacity, and variable bindings, including the variable bound to an overridden fill — addressed through nested instances so Figma applies each one to the right layer.
- Reject malformed effects assigned to `node.effects` in the plugin API with an error naming the invalid field, as Figma does, instead of storing them. `node.effects` now reads back in Figma's shape: layer blurs are `LAYER_BLUR` with `blurType`, and blurs no longer carry shadow fields (#786).
- Render fragments (`<>…</>`) nested inside other elements in JSX from the AI and MCP `render` tool, which previously failed with `Unknown element: <>`.
- Judge text contrast in the AI and MCP `describe` tool by its WCAG 2 ratio (4.5:1, or 3:1 for large text), the same ratio the `color-contrast` lint rule computes. It no longer reports passing dark text on mid-tone backgrounds as "dark on dark", now reports low-contrast light text, measures translucent and faded text as it is drawn, skips text whose color is bound to a variable, and says the ratio and the threshold it missed (#735).
- Keep the Code tab and the canvas in sync while you edit Design JSX. Canvas edits patch only the values, text, layers, and layer order that changed, under the property names you wrote (such as `width` for `w`), keeping your comments, formatting, and expressions; an expression or loop the canvas has changed is marked instead of overwritten. Code edits update the existing layers instead of recreating them, and each edit is one undo step. Before, canvas changes did not reach edited code until the tab was reopened.
- Warn about options the paint and effect helpers ignore when rendering JSX instead of dropping them silently, and point `blur` in effect helpers at `radius`, the name Figma uses (#736).
- Size groups and boolean operations made through the AI and MCP `group_nodes` and `boolean_*` tools to what they contain, as the editor's commands already do, instead of a default 100 × 100 box or the first operand's box (#738).
- Keep a layer where it is drawn when it moves into or out of a rotated or flipped parent, instead of shifting it and leaving it at its old angle (#737).
- Size auto-width text from `.pen` files to its content in CLI exports, instead of a 10000px placeholder that stretched hugging frames in HTML and Storybook output, and keep narrow widths a `.pen` file sets explicitly instead of widening multi-character text.
- Keep grid layouts, rotation, inner shadows, every shadow of a layer, layer and background blur, flex grow, right-to-left direction, and sections in HTML export, which previously turned grids into columns and dropped the rest.
- Show what to update instead of a blank window when the browser or system WebView is too old, naming the detected macOS, Safari, Chrome, Edge, Firefox, WebKitGTK, or WebView2 version and linking a prefilled bug report, and explain a failed start the same way (#744).
- Start on macOS 13 with WebKit older than Safari 17.4, which previously failed with `Promise.withResolvers is not a function` (#744).
- Evaluate the `**` operator in the AI and MCP `calc` tool, which its own description advertised but which the tool rejected. `calc` now accepts exactly the arithmetic it documents — `+ - * / % **`, parentheses and `min max floor ceil round abs sqrt pow` — and no longer evaluates undocumented expressions such as `random()`, factorials, trigonometry, strings, arrays, or property access.
- Show Chinese, Japanese, Korean, and Arabic characters in a fallback font when the text's own font is unavailable and another font substitutes for it, instead of drawing missing-glyph boxes (#746).
- Explain in the font issues banner when an installed font, such as PingFang on macOS 15 and later, stores outlines in a format OpenPencil cannot draw yet, instead of spending over a second trying to load each of its styles (#746).
- Render the Medium, Semibold, Bold, and other styles of variable fonts at their named weights instead of drawing Regular or a synthetic bold.
- Load the Bold, Medium, and other styles of macOS system fonts packaged as font collections, such as Menlo, Helvetica Neue, and Avenir Next, instead of reporting them as substituted or drawing a different style (#746).
- Load the Medium, Semibold, Bold, and other styles of installed variable fonts such as SF Pro on macOS instead of reporting them as substituted (#752).
- Ship the MIT license text in every published npm package, and add READMEs for `@open-pencil/core`, `@open-pencil/cli`, and `@open-pencil/mcp` on npm.
- Draw unchecked checkboxes in the Publish library dialog as empty boxes instead of filled squares, which were nearly black in the light theme.
- Show a saved AI key the browser can no longer read as Unavailable on its model in Settings, instead of a "Browser credential operation failed" error each time Settings or the app opens.
- Reject malformed vector network JSON in the AI and MCP `path_set` tool with an error instead of storing it on the node, where later path tools failed on it.
- Keep image bytes when the CLI reads a component library revision back from its catalog, instead of restoring every image empty.
- Work with pages other than the one on screen through MCP, `eval`, and the CLI against the running app without switching to them: `openpencil export --page` and `--page-id` export that page instead of the selection, `export_image` and `openpencil export --node` export layers from any page instead of failing with "Raster export selection must stay on a single page", and a `.fig` page that has not been shown yet gets its layers, fonts, and layout before a command reads or changes it.
- Fill the open subpaths of filled, unstroked SVG paths as if they were closed, as SVG does, in icons from `insert_icon` and Design JSX `<Icon>`, inline Design JSX `<svg>`, SVG from `import_svg` or dropped and pasted files, and SVG clip paths. Icons that cut holes with open subpaths, such as some Font Awesome icons, no longer render with those holes filled in, and filled `<polyline>` elements render filled instead of not at all.
- Keep round and other stroke caps and joins after saving and reopening the file on icons from `insert_icon` and Design JSX `<Icon>`, and on vectors from inline Design JSX `<svg>`, `import_svg`, and dropped or pasted SVG files. They were set only on the stroke paint, which `.fig` does not store, so outline icons such as Lucide's reopened with butt caps and miter joins and showed gaps where their strokes meet.
- Join the right room from a pasted link that ends in a query, `#`, or `/`, and say so when pasted text is not a room link instead of joining an empty room.
- Name the layer and page rename fields, the command palette list, and picker lists for screen readers, and announce disabled picker options as disabled.
- Show a fill's whole hex value and the whole opacity in the Design panel; the last hex digit and the opacity were cut off beside the variable button.

### Performance

- Reduce pauses before the first structural edit and during Undo/Redo on large pages while preserving complete history for dependent components and instances.

- Defer partial scene/overlay paints and structural layer projection during admitted JSX construction on the resolved placement page, including direct font/resize paints; selection still flushes immediately. Report bounded paint timings and deferrals in runtime status.

- Coalesce the displayed layer tree per frame during async structural authoring, flushing before selection and cancelling stale work on page/graph changes. Suppress file-watch reload throughout disk writes and prepare the restored lazy page before publishing it on external reload.

- Prepare fonts only for rendered JSX roots and reflow changed subtrees on free-positioned pages; MCP runtime status separates render construction, fonts, layout, and Undo timings.

- Retire obsolete FIG workers, preserve unchanged-file Save across page population, recover exited app-managed MCP servers, and expose read-only per-surface renderer, GPU resource-cache and Undo diagnostics through `get_runtime_status`.

- Selecting text and moving the caret while editing repaint only the selection instead of redrawing the whole canvas and properties panel, and text drawn from glyphs saved in a `.fig` file decodes each glyph once instead of on every redraw, so drag-selecting and dragging a property no longer stutter on pages with many text layers.
- Open large `.fig` files with a fraction of the memory: records stay in the file's bytes except for the few fields indexing needs, and are decoded whole when read, kept only for the pages being read and the components they use. Opening the Nuxt UI design kit takes 0.7 GB instead of 2.2 GB, and its first twelve pages 1.2 GB instead of 2.6 GB.
- Save an edited `.fig` file by rewriting only the layers that changed and copying the rest from the file it was opened from, as it is stored, without decoding it; in the browser that work runs off the main thread. Saving the 109 MB Preline UI kit after an edit takes about 3 seconds instead of over two minutes, and crash recovery no longer freezes Safari after the first edit to a large file. Editing a component also rewrites its instances on pages that were not opened yet.
- Open `.fig` design kits with less memory: layers inside instances hold their component layers' paints, glyphs, and other unchanged values instead of a copy each, about a third fewer objects and an eighth less memory per loaded page.
- Save large `.fig` documents with less memory: once every page is loaded, the first save releases the decoded original file, and saves write from the document instead of a copy of it, about 1.5 GB less on a 74 MB design kit.
- Save edited `.fig` documents with many component instances faster: each overridden layer is addressed and its variables resolved once, overrides merge through an index instead of a scan per override, and the components Figma keeps off-canvas are read once instead of on every save. Saving a 74 MB design kit after an edit takes about 8 seconds instead of 13, and later saves about 7.
- Open and draw large pages faster: guides no longer scan every layer of the page on each frame, a layout pass only writes the layers it moved and asks for one redraw, and opening a `.fig` keeps one copy of the file on the main thread instead of three.
- Edit variables in large documents without stalls: renaming, reordering, or adding a variable, or changing its CSS name, unit, scopes, or conditions, no longer redraws the canvas, and changing a value or mode updates only the layers bound to those variables or to variables aliasing them instead of re-resolving and laying out every bound layer in the document.
- Open the `/demo` document like any `.fig` file, built ahead of time, instead of generating it in the browser, which froze the page for several seconds.
- Open large `.fig` files with less memory in the macOS desktop app and Safari: imported layers now share one object layout in JavaScriptCore instead of each being stored as a slower, larger dictionary.
- Open multi-page `.fig` documents faster: the archive is indexed once rather than once for every page, each page resolves only the layers it adds instead of rescanning the whole document, placing an instance no longer re-synchronises every other instance of its component, and archive records are copied directly rather than through `structuredClone`. A 33-page file loads about a fifth quicker, and a page of repeated components opens three to four times faster once a document is already open.
- Lay out documents with many text layers and component instances without long freezes: text checks whether its fonts cover every glyph and measures itself at each width once rather than on every layout pass, and layout updating sizes no longer re-synchronises the components it touched. Building the demo document takes less than half as long.
- Instances follow their component as in Figma: style overrides from `.fig` files survive component edits, every field an instance does not override follows the component, restructured component layers move their instance copies with overrides, and properties set on nested instances show and stay set when pages load on their own (#849).
- Save `.fig` files that open correctly in Figma: overrides beyond text and fill colour, exposed nested instances, slot content, blend modes, bound variable values, variable metadata, fill-sizing, ordering keys, and stable layer IDs (#890). An opened `.fig` stays unchanged until edited, saves before its first edit, and saves variable-only edits.
- Text saved to `.fig` or copied to Figma keeps its wrapping, alignment, line height, ligatures, and decorations there (#914), and shows there when drawn in a fallback, missing, or variable font or truncated. Auto line height stays auto when `.fig` files are opened and saved, so text with mixed font sizes keeps its lines.
- Auto layout behaves as in Figma: Fill children in Hug frames keep their size, frames from `.fig` files reflow when edited, absolute children follow constraints, Hug frames grow while typing, and undo puts back everything an auto layout change moved.
- Draw like Figma: gradients from Figma files and pastes no longer run backwards, blurs and shadows use Figma's falloff, masks apply their opacity and blur, layers masked by a group show, and polygons and stars keep their rounded corners, point count, and inner ratio, also when copied to Figma.
- Underlines and strikethroughs follow the font's metrics and Figma's styles, outlined or flattened text keeps its glyph positions, and fonts load reliably: styles of variable fonts and macOS font collections, CJK and Arabic fallbacks, and a clear notice for unsupported outlines such as PingFang (#746, #752).
- Import HTML and CSS laid out as a browser lays it out, with correct shadows, borders, and `box-sizing`, in `openpencil import`, the app, and the Code tab's preview (#788).
- Import SVG files with an XML declaration, `fill-opacity`, `stroke-opacity`, open filled subpaths, and stroke caps and joins that survive saving.
- Design JSX lays out `justifyContent`, `alignItems`, grid `repeat()` tracks, fill sizes in grids, and `box-shadow` lists as written, applies props it used to ignore, reports bad gradient arguments, warns about ignored paint and effect options (#736), and keeps line breaks when exporting multi-line text.
- The plugin API reads and writes `lineHeight`, `letterSpacing`, effects, paints, page backgrounds, and `componentPropertyReferences` in Figma's shapes, updates geometry and text size immediately, and refuses invalid sizing and component cycles as Figma does (#786).
- AI, MCP, and CLI tools reject arguments they do not take (#977), keep variable bindings through stdio `render` (#830), size groups and booleans to their contents (#738), work on pages other than the one on screen, run XPath queries under Node (#787), judge text contrast by its WCAG ratio (#735), and report failed saves as errors.
- Undo covers layers MCP clients, the CLI, and AI chat create, delete, or move, including on other pages and in variables, and undo and redo work while a colour picker is open.
- AI chat replies stop cleanly, survive switching pages, accept `eval` results of any shape, use a newly saved API key right away, and keep your message when the chat cannot start. Pi chats start with OpenPencil's MCP tools on Node 22.15 or later and resume cleanly.
- Shared rooms keep one consistent layer tree when people move, reorder, or add layers at the same time (#888, #889).
- Storage keeps working: browser storage saves after Safari suspends a tab, in Private Browsing, and for documents over 127 MiB; crash recovery and autosave run after edits instead of on redraws, which froze Safari; and S3 storage works with servers that answer range reads with `200`, such as `rclone serve s3`.
- Memory stays flat during long AI and MCP sessions (#587), image-heavy `.fig` files open without running out of memory (#924), and closing a tab releases its document.
- Show a clear message instead of a blank window when the browser or WebView is too old, and start on macOS 13 with older WebKit (#744).
- HTML export keeps grid layouts, rotation, every shadow and blur, flex grow, right-to-left direction, sections, and the positions of layers outside auto layout, and declares `box-sizing: border-box`.
- Picking an OkHCL colour no longer overwrites a layer's other plugin data, including other plugins' data and its export settings.
- Smaller fixes: layers keep their place when moved into or out of a rotated or flipped parent (#737), the Vue SDK's `CanvasSurface` starts, `.pen` text sizes from its font, whole-step number field drags, ⌘Z after nudges, ⇧-resizing, Paste here in transformed frames, zooming to a fixed level, the font picker's starting position and search order, section and frame titles, tab and menubar overflow, tooltips, full hex and opacity values, component set borders at every zoom, the caret in empty text, imported page backgrounds, `.fig` thumbnails in recent files, the canvas context menu closing on a quick second right-click, model pickers in Settings → Models closing while the editor slides in, and screen reader labels.
- Ship the MIT license text in every npm package, with READMEs for `@open-pencil/core`, `@open-pencil/cli`, and `@open-pencil/mcp`.

### Performance

- Open large `.fig` files with a fraction of the memory: the Nuxt UI design kit takes 0.7 GB instead of 2.2 GB, and pages share unchanged component data and JavaScriptCore object layouts.
- Save an edited `.fig` by rewriting only the layers that changed, off the main thread in the browser: the 109 MB Preline UI kit saves in about 3 seconds instead of over two minutes, with about 1.5 GB less memory on large kits.
- Open multi-page `.fig` documents, lay out pages with many text layers and instances, and edit text selections and variables without long freezes or full redraws.
- Open the `/demo` document instantly, built ahead of time instead of in the browser.

### Security

- Limit what the desktop app may write and run: no writes to startup locations, shell profiles, global package folders, or MCP discovery files, and only the exact command lines of supported agents, the MCP server, and the Harness companion.
- Update to Tauri 2.12, which binds large IPC responses to the requesting webview (GHSA-w28w-mhc8-qvjv), and install desktop updates only when the signature names the announced version.
- Evaluate `calc` through `jsep` and an arithmetic allowlist instead of `expr-eval`, which had an unpatched code-execution advisory (GHSA-q9v2-7m5w-4693); `calc` now supports `**` and nothing it does not document.
- Escape layer names and text in JSX and Tailwind JSX export, so document text cannot inject attributes or expressions into `render` and `replace`.
- Validate collaborator cursors and names, clipboard data, component library revisions, and MCP and automation messages before using them, and update `@xmldom/xmldom` to 0.9.12, which fixes quadratic parsing of crafted SVG and XML.

## 0.15.1 — 2026-09-18

### Added

- Configure built-in AI and local MCP tool access independently on a Tool access page, including optional extended AI tools, searchable read-only and side-effect groups, and per-target defaults (#584).
- Set the built-in AI's maximum steps per message in Chat settings, including a custom number, with consistent stopping and remaining-step warnings (#573).
- Open documents and jump to a named layer from `openpencil://open?file=&node=` links, resolving the file against open tabs or a one-time file picker. Path segments match the way the filesystem does: case-insensitively on macOS and Windows, exactly on Linux.
- Open documents and jump to a named layer in the web app from `?file=&node=` links, fetching the file from an `https:` URL without credentials, ignoring the URL fragment, and refusing a document larger than 64 MiB — a ceiling the automation bridge's `openFile` now shares.

### Changed

- Create new documents with the sRGB colour profile, so Display P3 is reserved for documents that declare it.
- Export diagnostics from Settings only, with a retention count you choose. AI requests and tool activity now carry conversation and request identifiers, while chat no longer offers a separate diagnostic log or includes transcript content.
- Replace the demo's legacy reference page with a component library on the first page, including component sets, linked instances, component properties, and the variable collections, and show the standard canvas loading overlay and tab indicator while it is generated instead of an empty canvas.

### Fixed

- Store colours edited in the colour picker in the document's colour profile, and convert them on the way to the display, so a Display-P3 document no longer looks different on an sRGB display than on a wide-gamut one.
- Keep Display-P3 documents rendering correctly in wide gamut where the browser supports it and in sRGB elsewhere, fixing the black rectangles and incorrect blend colours, with a dismissible notice when wide gamut is unavailable.
- Classify MCP `open_file` and `close_file` operations as read-only hints, and close opened document tabs through the new `close_file` tool with the usual unsaved-change prompt.
- Let the desktop app use an MCP server you started yourself by allowing the app's own origin by default, instead of requiring `OPENPENCIL_MCP_CORS_ORIGIN`.
- Explain why the local MCP server did not start — a missing `@open-pencil/mcp` install, a denied command, an early exit, or an unreachable address — with translated guidance, and find a globally installed server when the desktop app is launched from the system shell.
- Animate the AI chat tool-call disclosure, which expanded and collapsed without motion because its animation classes were misspelled.
- Mark unsaved documents and ask whether to save before closing a tab, the desktop window, or the application, rather than relying on recovery alone.
- Defer AI provider connections and system credential reads until you send a message or use a connected feature, so opening documents and browsing chat history no longer trigger unexpected credential prompts.
- Save and recover documents whose text uses disabled numeric, fraction, or small-caps OpenType features, which previously failed to write a `.fig` file.
- Update instance text properties on the canvas while typing, with grouped undo for rapid edits.
- Point Homebrew installation instructions to the official `openpencil` cask and document separate CLI installation.
- Reach the custom model option in the model picker for providers with large model catalogs instead of requiring a search for it.

### Performance

- Reduce editor pauses while generating recovery snapshots and exporting text-heavy `.fig` documents.
- Recompute layout only for the pages an edit affects, instead of every page, when editing a component or its instances.

## 0.15.0 — 2026-09-16

### Breaking changes

- Use MCP SDK v2 server/client types for programmatic MCP integrations. Define custom tools with native Valibot `input` schemas and execution metadata instead of `params`, `ParamDef`, or `paramToZod()`.
- Replace Scene Graph `overrides` records with `instanceOverrides`, using separate `self` and `descendants` maps. Rename `figmaDerivedLayout`, `figmaDerivedTextGlyphs`, and `FigmaDerivedTextGlyph` to `derivedLayout`, `derivedTextGlyphs`, and `DerivedTextGlyph`.
- Update custom Vue SDK binding providers to implement `getBindingId()` and handle `unresolved`. Replace `setValue()` with `prepareEdit()`, returning a stable edit key, captured value, setter, and restoration callback.
- Replace Vue SDK `useDialogMessages()`, `dialogMessages`, and their catalog keys with the corresponding product-domain message composables and catalogs.
- Use Vue 3.5.41 or newer within Vue 3 for the Vue SDK, and CanvasKit 0.41.1 or newer when supplying its optional CanvasKit peer. Update custom CanvasKit integrations to use `PathBuilder` and immutable `Path` operations.

### Added

- Expose design inspection and undoable layer-property and variable edits to browser agents through experimental WebMCP in supporting browsers, with explicit Off, Inspect, and Edit access controls in Settings.
- Control custom tool exposure independently through `mcp`, `ai`, and `webmcp` exclusions. Tools are included by default, subject to execution support and user permissions.
- Bind Design JSX spacing, sizing, corners, and typography directly to numeric document variables.
- Define component properties and assign instance values in Design JSX using stable property IDs.
- Save AI conversations and attachment previews locally, switch between chats, rename or delete them, and browse saved transcripts across documents. Choose whether reasoning stays collapsed, expands while thinking, or stays expanded, with animated disclosure controls that respect reduced motion.
- Add a searchable command palette for editor and application actions.
- Search current AI provider catalogs from model pickers, with curated recommendations, recent compatible models, and offline fallbacks.
- Render triangle and line arrow stroke caps on lines and open vector paths, and choose them from the stroke cap picker.
- Expose component properties and instance-swap targets through the Figma API and automation.
- Create, select, move, duplicate, transfer, and delete canvas and frame guides directly from rulers, with undoable edits, measurements, context-menu actions, and `.fig` round-trip fidelity.
- Open to a unified home with recent and configured storage documents in grid or list layouts, and open multiple selected design files in separate tabs.
- Snap vector points, moved layers, and resized edges to nearby geometry, guides, frame and canvas bounds, and whole-pixel coordinates, with visible alignment guides and persistent snapping preferences.
- Run Pi through AI SDK HarnessAgent as a configurable desktop provider with saved model profiles, secure credentials, existing MCP design tools, and per-profile thinking and permission settings.
- Combine components into variant sets through Figma API scripts and automation.
- Add local AI usage and technical diagnostics, including token telemetry, provider/model summaries, recent failures, configurable retention, export, and clear controls (#588).
- Import, render, edit, resize, select, and export Figma text-on-path layers while preserving their curved glyph layout.
- Show temporary Figma-style distance measurements between selected and Option/Alt-hovered layers (#491).
- Edit Design JSX and HTML/CSS previews in CodeMirror, with theme-aware highlighting, Tailwind viewing, completion, diagnostics, bounded execution, and session-level undo (#130).
- Set provider-specific reasoning effort on supported AI model profiles (#454).
- Show unavailable or substituted document fonts with affected-layer selection and retry actions, and expose font fidelity through the Figma API, MCP, and `openpencil fonts [file] --json`. Choose `warn`, `strict`, or `allow` font-substitution policies for file-backed CLI raster and PDF exports with `--font-policy` (#503, #625).
- Add reusable remote MCP connections for ACP agents, with Streamable HTTP endpoints and credential-backed bearer tokens.
- Author and manage multidimensional component variants and published component libraries, including revision previews, linked-instance updates, stable library identities, offline catalogs, storage-backed catalogs, and read-only library definitions (#239).
- Recover unsaved and pathless documents locally, including after closing their tabs, with options to disable recovery and restore or discard retained snapshots (#487, #505, #574).
- Inspect selected designs with a configured Vision model and attach images to AI chat with bounded analysis and previews (#232, #471).
- Pin selected layers as explicit AI chat context, show collapsible reasoning, copy individual responses, and grow the composer with multiline prompts (#13).

### Changed

- Refresh the OpenPencil mark across the editor, documentation, browser tabs, installed web apps, and desktop icons, with small-size and dark-background adaptations.
- Explore editable component, typography, and paint comparisons in the demo, with the original examples preserved on a reference page.
- Use compact desktop Home search actions with consistent responsive layout and control sizing.
- Keep pixel-grid rounding invisible while showing alignment guides only for real geometry, objects, and canvas/layout guides.
- Embed images when copying selections into Figma, and preserve geometry, text sizing, component links, variables, modes, and shared styles when pasting within OpenPencil.
- Choose the app theme and whether animations follow the system or stay off under Appearance in General Settings, with live updates and persistent preferences.
- Simplify property panels with fill and stroke style pickers in section headers, concise effect style rows, and collapsed equal corner fields when all four share a variable. Preserve applied and missing styles and remove the redundant Dimensions heading for text layers.
- Open variable pickers below their trigger when space permits, flipping above near the viewport edge.
- Keep AI chat preferences with the model overview and edit models in a fixed-size Settings pane with explicit Save and Cancel actions.
- Match page-list density to the layer tree and add subtle, reduced-motion-aware dialog transitions.
- Fade in streaming Markdown list items and code lines without animating completed responses.
- Vertically center shaped section titles and allow renaming a section by double-clicking its canvas label.
- Load supported online fonts before revealing imported pages, preserve substituted text during editing, and shape canvas labels with Inter typography and shared Arabic/CJK font fallback.
- Complete translated app, accessibility, font, color, file, clipboard, collaboration, chat, vectorization, storage, recovery, component-library, and connection feedback across supported locales, and synchronize document language with the selected locale.
- Separate local MCP server controls, browser WebMCP access, and remote connections in Settings, with inline searchable tool permissions.
- Show translated field errors, hints, and consistent contextual alerts in Settings forms, focus the first invalid field on submission, and explain missing requirements instead of silently disabling Save or Test.
- Pan horizontally with Shift+wheel while preserving native horizontal trackpad movement.

### Fixed

- Render four-point diamond gradients, preserve text layout across fill types, and keep image colors accurate on sRGB displays.
- Keep newly created and edited objects visible during zoom instead of replaying outdated scene content.
- Keep property fields and paint previews live during editing, rotated selection labels readable and aligned, and object edges stable when previews settle.
- Show compact bordered section labels with inset nested titles and clearer hover feedback.
- Keep Undo and Redo commands available as edit history changes, without requiring another scene edit.
- Avoid recursive desktop HTTP proxy requests when font downloads intercept Tauri IPC traffic.
- Keep FIT image fills proportional, centered, and fully visible without stretching or cropped edges.
- Preserve edited instance text, including cleared labels, when saving and reopening `.fig` files.
- Honor `.pen` frame layout defaults and sizing and padding shorthands so imported auto-layout frames keep their computed dimensions and child positions (#564).
- Avoid macOS Keychain prompts during credential status checks and pause repeated credential access after failures until explicitly retried from Settings.
- Honor explicit Design JSX instance dimensions and preserve authored overrides through component synchronization.
- Route browser Command/Ctrl plus and minus shortcuts to canvas zoom instead of page zoom.
- Resolve `$name` references in imported `.pen` fills, stroke fills, font families, dimensions, and spacing without requiring a `--` prefix (#563).
- Resolve bound fields in each layer’s mode, keep variable edits scoped and undoable, and make broken bindings visible and recoverable.
- Display letter spacing in pixels and support explicit automatic line height.
- Prevent the stock photo tool from replacing text, lines, structural layers, or containers with content while supporting closed shape geometry.
- Preserve imported Figma text alignment metadata, explicit normal blend modes on text and vectors, and implicit fixed text sizing in auto-layout frames across save and reload.
- Render imported Figma strokes with odd-length dash patterns correctly.
- Stop showing a misleading desktop-only warning when web font loading or catalog lookup fails.
- Resolve fallback fonts reliably for cached characters, mixed-language text, and text-case transformations.
- Preserve imported Figma divider-line geometry during auto-layout recomputation, preventing half-pixel shifts on save and reload.
- Resolve package imports under Node and Bun from ordinary tarballs while preserving Bun source-first workspace execution (#663).
- Use the user's home directory as the default MCP file root on Windows, avoiding the caller's unreliable working directory.
- Open legacy raw `.fig` files that store the Kiwi document and thumbnail without a ZIP wrapper (#582).
- Preserve a frame's auto-layout HUG sizing, variable bindings, and variable modes when converting it into a component through the Figma API or automation (#595).
- Run `openpencil import` on Node so npm-installed CLI users no longer encounter `Bun is not defined` (#575).
- Generate recent-file previews from the conventional `Cover` page without modifying the source file.
- Resolve Vue SDK semantic test selectors correctly in non-browser runtimes (#397).
- Commit vector vertex and Bézier-handle edits when the pointer is released and keep transformed vector-edit overlays aligned (#586).
- Preserve app-created component properties and instance-swap targets across `.fig` save and reload cycles (#548).
- Reconnect desktop automation to an already-running MCP server through its discovery file (#546).
- Keep text-editing carets, hit testing, and selection highlights aligned with vertically centered or bottom-aligned text (#539).
- Match AI chat code-block colors and backgrounds to the active theme, and let desktop users select and copy chat text without replacing it with canvas layers (#537, #538).
- Restore visible above, below, and child drop feedback while dragging layers in the Layers panel.
- Place editor-created instances beside nested source components in world space, including transformed parents.
- Prevent malformed collaboration updates from corrupting synchronized nodes or derived text rendering.
- Transfer native `.fig` exports over binary Tauri IPC, preventing large desktop saves from being truncated or exhausting WebView memory (#484).
- Decode zstd-compressed FIG containers and reject invalid compressed payloads (#397).
- Compose caller CSS with Tailwind defaults when importing DOM/CSS documents (#397).
- Preserve desktop HTTP timeout, abort, and empty-response semantics (#397).
- Report whether missing Figma clipboard images were actually fetched (#397).
- Report exhausted provider credit, request failures, and output-token limits through localized chat toasts and copied diagnostics (#451, #454).
- Prevent Windows desktop crashes when loading large system fonts for non-Latin text.
- Preserve open vector segments when the same vector network also contains filled regions (#450).
- Match Figma Plugin API behavior for `rescale()`, page `backgrounds`, and nullable visual `absoluteRenderBounds` (#442).
- Keep imported and pasted Figma instances linked to their remapped source components so later component edits update existing instances (#385).
- Restore native copy, cut, and paste shortcuts in desktop text inputs while preserving design clipboard handling on the canvas.
- Preserve committed desktop text input when the WebView supplies text through the input event before updating the hidden text field (#607).
- Preserve selected layers when browser clipboard serialization fails during cut operations, and fall back to the session clipboard when system clipboard access is unavailable (#568).
- Treat MCP tool results with an omitted `isError` field as successful while preserving explicit MCP errors (#583).
- Preserve effective nested instance text overrides when importing complex Figma component hierarchies (#102).
- Preserve SVG clip paths, including clip shapes referenced through `<use>`, when importing editable vectors.
- Preserve circles, ellipses, rectangles, lines, polylines, and polygons supplied as JSX children of inline SVG elements (#452).
- Stop local MCP servers after the app disconnects instead of leaving orphaned background processes (#494).
- Prevent unbounded instance duplication when editing Figma-imported or pasted components with serialized or renamed children, keep extra instance children in their intended order, and avoid pasted instances re-linking pre-existing instances during clipboard import.

### Performance

- Reduce pauses after repeated frame creation without leaving hidden property edits or popups active.
- Reduce repeated text shaping and scene invalidation while moving and resizing objects, and reuse fitting canvas labels during zoom.
- Reduce unnecessary layout work after automation and Figma API edits by updating only affected layers and containers.
- Keep rapid trackpad zoom reversals and effect-heavy document navigation responsive by cancelling obsolete reconstruction and reusing safe raster snapshots.
- Show the FIG page list from a lightweight Kiwi scan before materializing the full document.
- Avoid redundant collaboration writes when synchronized node fields have not changed.
- Release completed streaming-response state to reduce retained chat memory (#544).
- Open large documents faster by reducing repeated position calculations when finding layers under the pointer (#527).
- Avoid redundant autosaves while a `.fig` export is in progress, while ensuring newer edits are saved afterward (#528).
- Defer JSX generation and syntax highlighting until the Code panel is active, keeping large canvas selections responsive (#500).
- Paste large, flat Figma selections faster by avoiding repeated scans of clipboard layers (#500).
- Reduce peak memory during `.fig` export by sharing immutable binary resources with the isolated export graph.

### Security

- Protect new real-time collaboration sessions with stronger invitation credentials.

## 0.14.0 — 2026-08-10

### Breaking changes

- **Core SDK:** Import scene graph types, geometry, coordinate, matrix, snapping, undo, and path helpers from `@open-pencil/scene-graph`; import `.pen` parsing from `@open-pencil/pen`; import synchronous Kiwi decompression from `@open-pencil/kiwi` instead of the `@open-pencil/core` compatibility barrel; use uppercase acronym casing in exported identifiers, including `JSONObject`, `JSONArray`, `JSONValue`, `RPCCommand`, and `executeRPCCommand`; and use the renamed tool exports `importSVG`, `exportSVG`, `exportPDF`, `getJSX`, `diffJSX`, and `setPexelsAPIKey`.
- **Vue SDK:** Replace the removed color-picker model helpers with `useColorModel()`; replace the deprecated `FillPickerRoot` and `useFillPicker()` APIs with `FillRoot`, `FillSwatch`, `useFill()`, and a consumer-owned popover; rename `FontPickerUi` to `FontPickerUI`; and remove the exported `testId` prop helper types in favor of semantic component anatomy.
- **CLI and MCP SDKs:** Use uppercase acronym casing in exported identifiers, including `AppTargetCLIArgs`, `appTargetRPCArgs`, `loadRPCData`, `prepareDocumentForRPC`, `RPCSender`, `createBrowserRPCBridge`, `createMCPSessionManager`, and `createStdioRPCBridge`.

### Added

- Export selections, pages, and documents as editable PowerPoint (`.pptx`) files from the File menu, CLI, and SDK. Text, rectangles, ellipses, and lines remain editable; visually complex layers are embedded as images.
- Import HTML, CSS, Tailwind, and JSX as editable documents from the app, CLI, and SDK, and export standalone browser-ready HTML with compiled CSS and optional external assets.
- Drag image files into the desktop app and paste Figma layers with their remote image fills.
- Import dropped SVG files as editable vector layers, preserving compatible multi-color fills and transparent paints. (#386, #392, #394, #446).
- Convert image layers into editable vectors with Recraft or fal.ai from the canvas context menu. (#322).
- Browse document components as thumbnails or a list in the Assets panel, group them by page, and drag instances directly onto the canvas. (#424).
- Create centered frames from Figma-style device and asset presets, or resize selected frames to a preset while preserving their names. (#418).
- Manage pages by renaming, deleting, and dragging to reorder them in the Pages panel.
- Create text by dragging a fixed-size text box or clicking for auto-width text.
- Create and edit layout grids for frames and components, including columns, rows, counts, gutters, margins, visibility, and grid size.
- Inspect and edit constraints, stroke caps and joins, corner smoothing, shared styles, component properties, blend modes, masks, advanced typography, text resizing, and per-node export settings from the Design panel.
- Edit solid fill colors by entering hex values directly in the Design panel.
- Use Figma-style number-key opacity shortcuts: `1`–`9` set 10%–90%, `0` sets 100%, and two-digit sequences set exact values.
- Access more common design actions from the browser and desktop menus, including visibility, locking, masks, flipping, components, z-order, distribution, selection, rulers, multiplayer cursors, and Settings.
- Find overlapping layers and overflowing children from the CLI, AI tools, and MCP.
- Target a specific open document and page from live CLI and MCP automation, including sessions with multiple documents.
- Connect local MCP clients through automatically discovered private Unix sockets on macOS and Linux, with localhost TCP fallback. (#338).
- Test OpenAI-compatible provider connections from AI settings with clearer setup errors.
- Configure separate Design, Review, Fast, and Vision models, providers, endpoints, and credentials from AI settings.
- Manage AI, agent, media, and storage credentials from unified Settings, using the system credential store on desktop and encrypted browser storage by default, with a session-only browser option.
- Connect an S3-compatible storage workspace with local-first saves, background synchronization, embedded `.fig` previews loaded without downloading full documents, and automatic refresh while the workspace is active.
- Add Japanese localization and improve menu translations across the existing supported languages. (#367).
- Author richer Design JSX with components, instances, variables, gradients, structured fills, shadows, blur effects, masks, and inline SVG vectors.
- Build custom property panels and document workspaces with new Vue SDK number fields, bindable values, property sections, responsive grids, segmented controls, property lists, color models, fill controls, gradient primitives, and the headless `useDocumentWorkspace()` composable.
- Use `useColorModel()` in the Vue SDK for extensible color formats and shared RGB, HSL, HSB, and OkHCL channel behavior.
- Add dedicated SceneGraph, Pen, Kiwi, Fig, and DOM/CSS packages with documented public entry points for building on OpenPencil.

### Changed

- Simplify AI model setup with clearly separated model, connection, and advanced settings, automatic compatibility and output-limit defaults for recognized models, and an explicit custom-model option.
- Redesign the editor chrome and Design panel with denser, better-aligned controls, clearer selection and section states, improved menus and overlays, consistent light/dark theming, and better keyboard and screen-reader support.
- Choose Freeform, vertical, horizontal, or grid flow directly from the contextual Layout section, with sizing controls grouped alongside it.
- Choose Auto width, Auto height, or Fixed size directly from the Layout section for text layers.
- Scale the Layers panel to documents with thousands of nodes through virtualized rows, faster incremental updates, stable expansion, range selection, and scroll-to-selection.
- Open and save large `.fig` documents substantially faster while preserving original metadata and user edits, and switch between large pages with fewer Layers panel stalls. (#420).
- Resolve fonts before text appears, with language-aware CJK and Arabic fallbacks, character-specific remote subsets, and more reliable rendering as fonts load.
- Use MiniMax M3 as the default model for MiniMax AI connections. (#431).
- Center empty and setup states consistently across panels, dialogs, and workspaces.

### Fixed

- Keep desktop startup clean when optional MCP automation is unavailable, retain startup diagnostics for MCP-dependent features, and load JSX syntax highlighting without browser globals.

- Preserve Figma’s imported glyph outlines through layout and appearance updates so text keeps its intended weight and shape.
- Keep swapped image avatars and thin stepper dividers at their effective imported size and position.
- Scale proportion-constrained `.fig` instance geometry through fixed wrapper layers so imported logos and icons retain their intended size.
- Match Figma auto-layout spacing, padding, min/max constraints, scalar variable bindings, CanvasKit-shaped generated text, imported text bounds, and nested instance geometry more closely.
- Match Figma Plugin API vector path and network editing, including bounds, transforms, winding rules, region fills, validation, and handle mirroring. (#444).
- Let AI and MCP tools create arbitrary vectors from SVG path data, validating input without leaving blank layers behind. (#440).
- Improve AI design accuracy by exposing every supported shape, including visible stroke colors and weights in visual descriptions, and accepting supported inline SVG attributes without false warnings. (#445, #447, #448).
- Restore Anthropic AI connections in the web app instead of failing with a browser endpoint error. (#438).
- Reconnect live CLI and automation sessions automatically after an unexpected bridge disconnection.
- Keep MCP file access inside its configured root when paths contain symlinks, and strengthen local authentication token checks. (#338).
- Start globally installed ACP agents correctly on Windows instead of reporting them as unavailable. (#361).
- Resume pending cloud saves after restarting the app or temporarily losing credentials, without reviving deleted documents or overwriting newer local changes.
- Handle S3 object listings, pagination, and escaped names more reliably, and explain required CORS setup without modifying bucket rules.
- Show HTML, CSS, Tailwind, and JSX import errors instead of failing silently.
- Preserve inline SVG attributes, nested transforms, and explicit icon dimensions when rendering Design JSX artwork.
- Save auto-layout frames that stretch their children to `.fig` without failing. (#427).
- Preserve nested instance text, visibility, paint, geometry, clipping, variable modes, and component swaps in `.fig` files.
- Improve `.fig` import and rendering fidelity for groups, booleans, instances, rotated vectors, complex text fills, auto-sized text, layout grids, page guides, patterns, noise effects, masks, and canvas backgrounds.
- Preserve pages, components, prototype and library metadata, export settings, unsupported effects, and other unrelated Figma data when editing and resaving `.fig` files.
- Prevent duplicate generated IDs from corrupting `.fig` round trips.
- Preserve the whole document when exporting FIG unless a page is explicitly requested, populate unopened pages for file-mode CLI inspection, and expose vector paths and variable modes to Plugin API scripts.
- Report corrupted compressed `.fig` data as an error instead of opening it as valid content.
- Match Figma auto-layout reflow after deleting children, hiding optional instance slots, or syncing component changes.
- Make group and boolean-operation children scale with their parent during resize.
- Edit vectors in opened documents at the correct position, with live fill updates and working undo and redo. (#390).
- Keep duplicated layers independent instead of sharing mutable fills, strokes, bindings, overrides, or vector data, and remove stale bindings when paints are deleted.
- Keep desktop text visible across scene and overlay canvases, refresh it after local fonts load, and preserve rendering when an italic face is unavailable. (#395).
- Vertically center text correctly when an explicit line height adds space above and below its glyphs. (#422).
- Preserve Hangul IME composition while editing text.
- Restore desktop copy, cut, and paste when browser clipboard events are unavailable.
- Finish pasting Figma layers promptly even when remote images are slow or unavailable, and hydrate their image fills when downloads complete.
- Reuse the existing tab when reopening a file through its desktop path or browser file handle, avoiding duplicate watchers and conflicting saves. (#297).
- Share public app links from the desktop collaboration panel and send the current document to newly joined collaborators.
- Show only the most specific tooltip when property controls contain nested actions.
- Match regional browser languages to supported locales without selecting a lower-priority language. (#417).
- Improve Simplified Chinese translations and correct localized menu terminology.
- Resolve published package types correctly for TypeScript consumers and keep file-backed CLI commands working under Node.

### Security

- Update the collaboration WebSocket dependency to address a protocol-length advisory.

## 0.13.2 — 2026-05-30

### Changed

- Update the Homebrew install command to use the published `openpencil` cask.

### Fixed

- Fix the published MCP package so global installs include the `openpencil-mcp` and `openpencil-mcp-http` launchers required by desktop app integrations.

## 0.13.1 — 2026-05-29

### Fixed

- Fix the npm package contents for the CLI so Bun installs include the built `openpencil` binary and runtime bundle.

## 0.13.0 — 2026-05-29

### Fixed

- Fix the published CLI package so Bun global installs run the built `openpencil` binary instead of raw TypeScript sources.

- Greatly improve importing Figma `.fig` files with complex component systems: badges, avatars, icons, links, input fields, lists, date pickers, nested instances, component swaps, and variant properties now open much closer to their original Figma appearance.
- Fix missing or white content in imported `.fig` files caused by unresolved Figma variable bindings, including image/avatar badges, icon colors, text colors, and variable-backed component overrides.
- Preserve more Figma document details when opening and saving `.fig` files, including internal component pages, component ordering, page metadata, canvas backgrounds, text layout, glyph rendering, vector geometry, effects, shadows, and instance overrides.
- Keep user edits after opening an imported `.fig` file: changing size, position, fills, text, or layout now wins over preserved Figma round-trip data when the document is saved again.
- Fix `.fig` exports so files reopened in Figma or OpenPencil keep their pages, components, instances, text wrapping, icons, avatars, and preview thumbnail intact.
- Fix live canvas updates during move/resize/edit previews so visible scene changes repaint immediately.
- Fix accidental duplicate creation when Alt-clicking without dragging.
- Fix MCP startup in the browser.
- Fix CanvasKit loading outside the browser when project paths contain spaces.
- Render imported Figma layer and fill blend modes such as multiply, screen, overlay, difference, hue, saturation, color, and luminosity.
- Render common imported Figma mask stacks so visible layers above alpha, vector, or luminance masks are clipped by the mask shape, including consecutive mask layers.
- Render Figma-style smoothed rectangle corners, including independent corner radii, and effect blend modes from imported Figma files.
- Improve imported tiled image fills by applying Figma image transforms when repeating image patterns.
- Keep imported Figma boolean operations editable as boolean-operation nodes instead of flattening them to vectors.
- Apply imported variable font axes from Figma `fontVariations` when rendering text.
- Render more imported Figma visual metadata, including text decoration styles, leading trim, pattern fills, layout grids, page guides, and deterministic fallbacks for raw noise effects.

### Performance

- Open large `.fig` files faster by deferring work for pages you have not viewed yet while still preparing all needed content before export.
- Improve canvas responsiveness during zooming, panning, dragging, and editing by reusing cached scene backing where safe.
- Speed up `.fig` export for documents with many preserved Figma paint and variable payloads.

## 0.12.2 — 2026-05-19

### Added

- Allow OpenRouter users to enter any model ID from provider settings with cached autocomplete suggestions for tool-capable models, while keeping the curated dropdown as the default when no custom model is set.

### Changed

- Use localized app tooltips instead of native browser titles across editor controls, panels, and menus.
- Update Claude Code MCP setup documentation and the docs landing screenshot.
- Ignore non-source Markdown files in the app dev watcher so documentation edits do not reload the running editor.

### Fixed

- Route Claude Code stdio MCP requests through the live OpenPencil app connection, including immediate disconnected errors when no document is connected.
- Keep MCP disconnected guidance focused on starting OpenPencil and opening a document.
- Improve agent-rendered JSX compatibility with Figma-style text, alignment, and rotation aliases; strip HTML comments; and report unsupported props from render tools.
- Load exact text font styles after MCP and AI tool mutations so newly created bold/weighted text renders immediately.
- Include text style fields in MCP `get_node` output so agents can verify generated text accurately.
- Keep provider settings tooltip/popover composition working in WebKit.

## 0.12.1 — 2026-05-19

### Fixed

- Fix `.fig` round-trips for OpenPencil component sets and variable bindings, and recompute imported layouts after opening documents.
- Report desktop/MCP package version mismatches explicitly and include package-manager-aware install guidance from the MCP server.
- Support scoped MCP `save_file({ path })` workflows while keeping file saving in the desktop app.
- Use native Tauri path handling for save parent directories so Unicode and Windows paths are handled correctly.
- Fix the web font picker so Google Fonts remain available in Safari, local font access is requested on first open when supported, font sources are labeled, and Google font previews load lazily for visible rows.
- Fix background blur rendering so it blurs the backdrop behind a layer instead of applying a no-op content filter, and keep effect parameter controls visible in the properties panel.

## 0.12.0 — 2026-05-18

### Added

- Assets panel — browse, search, and insert document components directly from the left sidebar.
- Component variants — switch instance variants from the right inspector; default variant respects property definitions.
- Figma library metadata — component keys, source libraries, version IDs, descriptions, and docs links are preserved on import/export.
- Desktop file associations — double-click `.fig` or `.pen` files in Finder/Explorer to open them in OpenPencil.
- Auto-update — startup update checks and a Check for Updates menu item on desktop.
- Light theme with theme-aware canvas rulers.
- PDF export — available in the export panel, CLI (`--format pdf`), and MCP.
- SVG import tool for automation workflows.
- DeepSeek AI provider.
- Variable modes — create, rename, duplicate, delete, and set defaults per collection.
- Variable binding controls for fills, strokes, sizing, min/max, and typography fields.
- Auto-layout inspector controls for min/max dimensions, auto gap, wrap gap, and two-axis padding.
- Stroke dash/gap controls.
- Font settings — local font access, fallback predownloads, and downloaded font cache management.
- Editor commands for frame selection, paste to replace, Boolean operations, flatten, outline text, and outline stroke.
- Boolean operations panel control and canvas context-menu entries for flattening and outlining supported selections.

### Changed

- Smaller domain modules across core, app, Vue SDK, CLI, MCP, docs, and desktop with enforced package boundaries.
- Separate scene and overlay canvas layers — rulers, labels, and selections no longer cause scene redraws.
- Shared menu schema between browser and native Tauri menus.
- Editor command metadata now drives shortcut display across browser menus, native menus, tooltips, and context menus.
- Text-to-vector conversion now uses shared loaded-font outline geometry across Boolean, flatten, and outline commands.

### Fixed

- Fix `.fig` export of component variant properties and text stretch alignment so designs round-trip correctly through Figma.
- Fix CJK and Arabic text rendering — fallback fonts now load before the first paint instead of showing blank text.
- Fix large `.fig` files freezing on open — parsing runs in a worker, and the viewport fits to content after loading.
- Improve Figma import fidelity — variable aliases, nested instances, avatar swaps, badge internals, and input text alignment are preserved.
- Improve Figma export fidelity — flipped vectors, stroke geometry, visual overflow, and stroked-shape drop shadows are preserved.
- Fix variant switching so instances update their contents, not just the component reference.
- Fix text editing inside components and instances on double-click.
- Fix paste into selected containers and entered frames.
- Fix clipboard parsing to safely ignore invalid data.
- Fix undo/redo for duplicate, state restore, and modifier-key release.
- Prevent browser from intercepting app-level undo/redo shortcuts.
- Fix font loading and bundled font resolution.
- Show the startup loader until fonts load and the first render completes.
- Improve light theme polish and canvas ruler colors.
- Normalize browser zoom speed.
- Fix variable picker popovers and color binding swatches.
- Fix dashed strokes on vector nodes and gradient fills on text.
- Fix inner shadow rendering on text nodes.
- Fix imported Figma-derived underlined text rendering.
- Fix exponential `.fig` file growth on repeated save/load cycles.
- Fix opening large `.fig` files so every page populates component instances, preventing missing nested content when switching pages.
- Fix canvas size badges scaling with zoom.
- Fix layout inspector dropdown anchoring and spacing/padding icon clarity.
- Fix section drawing and color input forwarding in the property panel.
- Fix asset insertion coordinates inside entered containers.
- Fix MCP stdio handshake and eval return values.
- Fix `@open-pencil/vue` npm imports referencing an unexported core subpath.
- Fix Figma clipboard text compatibility — pasted OpenPencil text keeps editable fixed bounds, line wrapping, baselines, glyph offsets, and Figma edit-mode layout.
- Fix local font matching so requested upright and weighted faces do not fall back to italic or regular faces.
- Fix CanvasKit paragraph rendering to preserve requested text weights and slants.
- Fix nested text editing interactions — drill double-click enters nested text edit mode, and clicking another text node switches edit targets while editing.
- Fix auto-height text edit commits so text bounds and undo state stay in sync.
- Fix Boolean, flatten, and outline operations to reject unsupported image/complex-script sources safely instead of silently dropping geometry.
- Fix outline stroke enablement for stroked descendants inside groups and containers.

### Performance

- Event-driven canvas rendering — scene and overlay layers only repaint when their inputs change, replacing continuous polling.
- Shared RAF scheduler coalesces scene and overlay frames into a single animation frame per editor.
- Font-family fallback arrays and downloaded remote fonts are cached to avoid repeated work.
- WebGL draw-call instrumentation only runs while the profiler is active.
- Instance override resolution is cached and `.fig` pages load lazily for large files.
- Live drag/resize uses repaint-only previews to skip layout during interaction.

## 0.11.8 — 2026-04-23

### Fixed

- Fix MCP server not spawning on Windows — use `cmd /c` to resolve `.cmd` wrappers from npm global installs.
- Fix MCP server and automation WebSocket not connecting on Windows/Linux — inline `__TAURI_INTERNALS__` check at call time instead of using stale module-level `IS_TAURI` constant.
- Fix shell PATH not inherited by GUI app on macOS/Linux — add `fix-path-env-rs` to read shell config.

## 0.11.7 — 2026-04-22

### Added

- Add stdio transport for MCP server — `openpencil-mcp` now works as a proper stdio MCP server for Claude Code, Cursor, etc. HTTP server available as `openpencil-mcp-http`.
- Default canvas background to dark when system prefers dark color scheme.
- Add `list_available_fonts` MCP tool for font discovery.
- Copy node ID / XPath from context menu; CLI selection command.
- Arrow key nudge for selected nodes (1px, Shift+arrow for 10px).
- JSX renderer: `position="absolute"`, `top`, `left` props for absolute children inside auto-layout containers.
- MCP server sends `notifications/tools/list_changed` when the desktop app connects or disconnects.
- Headless text measurement via opentype.js per-glyph advance widths — no CanvasKit needed.
- Add `open_file` and `new_document` MCP tools with `OPENPENCIL_MCP_ROOT` path scoping.
- Optional `path` param on `export_image`, `export_svg`, `get_jsx` — write output to disk instead of returning base64/string.
- Multi-root JSX support — multiple top-level elements auto-wrapped in a fragment.
- `Component` and `Instance` tag aliases in JSX renderer.
- JSX prop reference doc — copy to clipboard via book icon in Code panel.
- Prompts (`CODEGEN_PROMPT`, `JSX_REFERENCE`) moved from embedded strings to markdown files.

### Fixed

- Fix Backspace not deleting selected nodes after clicking on canvas — canvas now receives focus on click so keyboard shortcuts aren't blocked by stale input focus.
- Support Cmd/Ctrl+click for additive multi-select in layers panel (previously only Shift+click worked).
- Fix macOS Tauri build — move `NSAllowsLocalNetworking` ATS config from invalid `tauri.conf.json` property to a proper `Info.plist` file.
- Fix tab order and keyboard handling in inspector panel.
- Fix design token variables not resolved before passing to yoga-layout.
- Suppress keyboard shortcuts while editing property panel inputs.
- Fix tooltip competing with popover trigger on Windows.
- Fix hit area for nodes with rotated parents.
- Error toasts auto-dismiss, deduplicate, and cap stack at 5.
- Bump yoga-layout to 3.3.0-grid.3 with `Node.free()` support.
- Bump PWA precache limit for canvaskit-webgpu.
- Fix color picker dragging flooding the undo stack — fill/stroke/effect color and opacity drags now collapse into a single undo entry per interaction via debounced batching in `PropertyListRoot`.
- Fix .fig import crash on alias variables without a GUID.
- Fix `save_file` crash on vectors with missing tangent control points — default to straight segments.
- Validate `create_vector` path JSON upfront with clear error messages for malformed input.
- Fix MCP/AI tools rejecting string-encoded numeric arguments from MCP clients (`"42"` → `42`).
- Fix "Create Instance" context menu item always grayed out — inverted disabled flag.
- Show "Create Instance" instead of "Create Component" in context menu when a component is selected.
- Fix headless layout: use stored .fig dimensions instead of rough text size estimates (26K → 11K mismatches on material3.fig).
- Fix `--help` output with huge vertical gaps between commands — remove inline examples from query description.
- Fix `openpencil-mcp` npm package missing `dist/stdio.js` — explicitly list entry points in tsconfig.
- Show toast when MCP server fails to start instead of silently swallowing the error.
- Fix provider settings popover not appearing — tooltip wrapper broke floating-ui positioning.
- Fix `set_font_range` producing invalid style runs that crash `.fig` export — use `applyStyleToRange`, apply color and fontWeight from style name.
- Fix MCP "app not connected" error — message now instructs the agent to stop and inform the user.
- Fix external links in AI panel blocked by Tauri ACL — use opener plugin instead of shell.

## 0.11.6 — 2026-04-08

### Fixed

- Switch `@open-pencil/core` build from `tsgo` + `fix-esm-import-path` to `tsdown` — fixes bare directory imports that broke Node.js and Bun consumers.

## 0.11.5 — 2026-04-08

### Fixed

- Fix published npm packages resolving to TypeScript source instead of compiled JavaScript — `publishConfig.exports` overrides are now applied during CI publish.
- Fix Windows CI build failures caused by backslash file paths in custom lint rules.

## 0.11.4 — 2026-04-08

### Fixed

- Fix `@open-pencil/core` published package containing stale import paths from before the domain module restructuring — CLI and MCP installs from npm now resolve correctly.
- Add `save_file` MCP tool for saving the current document to disk.
- Clipboard text export now writes richer v4 `derivedTextData` payloads with glyph outlines for better paste fidelity.

## 0.11.3 — 2026-04-08

### Fixed

- Show actionable install errors in the chat panel when a required local AI CLI is missing.
- Fix inline layer rename so clearing the name restores the default name, and Backspace/Delete inside rename inputs no longer delete the layer.
- Fix rotated frame hit testing, hover highlights, and selection overlays so interactive areas and overlay labels stay aligned during rotation.
- Fix text edit undo so it restores both the original text and `styleRuns`.
- Pressing Enter with a selected text node now starts text editing and selects all text.
- Fix `ScrubInput` Enter handling so committing a value no longer triggers a second blur-based commit that overwrites it.
- Show the auto-layout panel for `COMPONENT`, `COMPONENT_SET`, and `INSTANCE` nodes.
- Fix missing layout direction icons in the auto-layout controls.
- Fix nested text selection inside gradient cards.
- Unify the size control into a single inline sizing input/dropdown with shorter localized labels to prevent overflow.

## 0.11.2 — 2026-03-30

### Fixed

- Stabilize npm publishing with isolated temp publish directories instead of mutating tracked package manifests in CI.
- Strip build-time scripts and dev dependencies from generated publish manifests so tarballs pack from verified artifacts only.
- Fix `@open-pencil/mcp` release packaging so the published npm tarball includes its built `dist/` CLI and server entrypoints deterministically.
- Fix `@open-pencil/core` release build configuration so CI publish jobs include Node and Bun ambient types when compiling package artifacts.

## 0.11.1 — 2026-03-30

### Fixed

- Fix npm publishing pipeline to publish packed tarballs instead of raw package folders.
- Attempt to fix `@open-pencil/mcp` npm package contents so the published CLI includes its built `dist/` entrypoints.
- Fix `@open-pencil/vue` npm package metadata and build output so the published package resolves from `dist/` while local workspace development keeps using source aliases.

## 0.11.0 — 2026-03-30

### Added

- Lock and visibility toggle buttons in layers panel (hover to reveal, always shown when active).
- Figma-style selection scope — double-click to enter groups/frames/components, Escape to exit.
- Nested container navigation — each double-click goes one level deeper.
- Dashed border around entered container for visual feedback.
- Layer panel click syncs canvas scope automatically.
- Vue SDK internationalization primitives — `useI18n()`, locale detection, persisted locale selection, lazy-loaded locale JSON files, and exported locale metadata for custom editor shells.
- Vue SDK docs and public API audit — documented advanced exports (`useOkHCL()`, variables helpers, viewport and locale APIs), aligned docs with the actual `provideEditor()` injection model, and expanded release-ready SDK guidance.
- npm release pipeline now publishes `@open-pencil/core`, `@open-pencil/cli`, `@open-pencil/mcp`, and `@open-pencil/vue` together on version tags.
- App language picker in the menu bar — switch UI locale without reloading.
- Added a vector curve editor and improved drawing experience with the pen tool.
- Resume pen drawing from existing open path endpoints — click an endpoint to continue the curve.
- Close open paths by dragging one endpoint to the other.
- Align selected anchor points relative to each other in vector edit mode — the standard alignment buttons in the position panel now operate on selected vertices when 2 or more are selected.
- Unified core IO format registry — `.fig` is now modeled as the native document format alongside shared export adapters for PNG, JPG, WEBP, SVG, and JSX.
- Export selection or current page as `.fig` from the app export UI and app menu.
- New CLI commands: `open-pencil convert` for document conversion, `open-pencil formats` to inspect readable/writable/exportable formats, and `open-pencil lint` for design consistency, structure, and accessibility checks.
- CLI export now supports `.fig` output and routes PNG/JPG/WEBP/SVG/JSX/`.fig` through the shared IO layer.
- `Open…` now supports `.pen` Pencil documents through the shared document reader pipeline while keeping `.fig` as the native save format.
- Display‑P3 document color space pipeline — documents now default to Display‑P3, `.fig` import/export preserves document color profiles, the live canvas requests P3 surfaces with sRGB fallback, and raster/SVG export paths accept explicit color-space targets.
- Color picker overhaul — unified `RGB` / `HSL` / `HSB` / `OkHCL` field formats, slider-space-aware track/thumb previews, and better neutral-color editing behavior for fills, strokes, gradient stops, and component fills.
- OkHCL metadata now round-trips through `.fig` plugin data and integrates directly into the main fill/stroke color workflow with preview gamut diagnostics.
- Vue SDK now exposes reusable color-picker model helpers and solid fill/stroke commit helpers for custom editor shells.
- Update built-in Z.ai and MiniMax model lists — Z.ai now uses the Anthropic-compatible endpoint for GLM coding models, adds GLM-5.1, and MiniMax adds M2.7 / M2.7-highspeed.
- Arabic and RTL support across text rendering, editing, layout, export, and AI tooling — text nodes support `Auto`/`LTR`/`RTL`, auto-layout frames support `Auto`/`LTR`/`RTL` flow, and JSX/AI prompts/tools can now generate and edit both explicitly.

### Fixed

- Fix shortcuts, now work on non-English keyboard layouts.
- Fix imported `.fig` file open and page-switch regressions — loaded documents now keep graph/store state in sync, remap imported canvas/page children correctly, and recompute imported auto-layout descendants when switching pages.
- Fix first canvas render happening before fonts load — wait for fonts before the initial draw to avoid Safari and text measurement glitches.
- Preserve `fig-kiwi` version on `.fig` roundtrip — imports keep the original header version instead of rewriting everything to a hardcoded value; new files default to version 101.
- Normalize auto-layout text export for Figma — text children inside auto-layout frames now serialize with `NONE` auto-resize to match Figma behavior and avoid overflow on reimport.
- Fix keyboard editing regressions after the refactor — canvas shortcuts no longer fire while editing text, and Delete/Backspace no longer delete nodes during text entry.
- Fix MCP page switching persistence — `switch_page` now survives across tool calls in the same session.
- Improve CJK font fallback coverage — load multiple Google Fonts for broader Han/Japanese/Korean text support.
- Normalize more visible UI strings for localized app chrome — menus, panels, variables dialog, code panel, chat setup, and editor controls now respect the selected locale instead of falling back to English in common flows.
- Fix imported text rendering in browser and headless export — preserve stored bounds until fonts are ready, restore missing font-loaded guards, use natural width for `WIDTH_AND_HEIGHT` text, and clip text to node bounds.
- Fix browser/headless rendering mismatch for imported toolbar/instance content by correcting runtime imported layout recomputation instead of diverging browser rendering behavior.
- Fix `set_layout` tool not defaulting to HUG sizing when enabling auto-layout — frames now shrink/grow to fit children instead of keeping fixed dimensions.
- Normalize font family names on `.fig` export — strip optical size suffixes (e.g. "DM Sans 9pt" → "DM Sans") so Figma recognizes the font.
- TEXT nodes now default to a solid black fill — previously exported with no fill, making text invisible when opened in Figma.
- Fix save crash when COLOR variable is missing alpha channel.
- Fix console error spam on deployed web app from automation WebSocket reconnect loop.
- Fix headless CLI font fallback — bundled Inter font now ships with `@open-pencil/core` and loads without a web server.
- Locked nodes now block move, resize, rotate, and delete on canvas.
- Locked containers block double-click enter.
- Marquee selection skips locked and hidden nodes.
- COMPONENT/INSTANCE containers are now enterable via double-click.
- Replaced the alignment and reflection icons with the correct ones.

## 0.10.0 — 2026-03-15

### Added

- ACP agent support — use Claude Code, Codex, or Gemini CLI as AI assistants in the desktop chat panel.
- Permission confirmation dialog — ACP agents request user approval for file/shell operations, MCP design tools auto-approved.
- Unified MCP server — single HTTP + WebSocket proxy replaces Vite SSR bridge.
- Stock photo integration — `stock_photo` tool fetches images from Pexels or Unsplash and applies to design nodes. Provider adapter supports custom providers.
- Skeleton-first AI workflow — 4-phase design process (plan → skeleton → content fill via `replace_id` → polish) for more reliable AI-generated layouts.
- Batched AI tools — `calc` accepts arrays of expressions, `stock_photo` fetches all images in parallel, `batch_update` applies multiple property changes in one call, `describe` accepts `ids` array for multi-node inspection.
- AI visual feedback — blue pulsing border on nodes being modified, green flash on completion.
- Auto-depth `describe` — adapts inspection depth to subtree size (small block → deeper, large page → shallower).
- `set_fill` gradient support — linear gradients with `color_end` and `gradient` direction params.
- `render` tool `replace_id` — atomically swap skeleton placeholders with real content.
- MCP `export_image_file` tool for headless PNG rendering.
- Grid layout in AI chat — JSX renderer supports `grid`, `columns`, `rows`, `gap` props.
- Configurable max output tokens in AI provider settings (default 16384).
- Z.ai AI provider with GLM-5, GLM-4.7, GLM-4.6, GLM-4.5 model families.
- MiniMax AI provider with M2.5, M2.1, M2 models.

### Fixed

- Resolve variable-bound fill colors through alias chains.
- Fix SCALE constraint resizing for auto-layout instances.
- Propagate SCALE constraints through instance clone chains.
- Skip self-referencing symbolOverrides on nodes with explicit kiwi properties.
- Fix DSD resolution for swapped instance children.
- Fix instance swap override propagation through clone chains.
- Fix component property override resolution through clone chains.
- Fix text/property overrides clobbered by second transitive sync.

- Fix text rendering with wrong fonts on file open — all font weights (including default family) are now loaded before the first render.
- Fix `weightToStyle` mapping: weight 400 now correctly maps to "Regular" instead of "Medium".
- Fix detached ArrayBuffer crash when switching pages after saving — export worker now copies image buffers before transferring.
- Show warning toast when fonts fail to load, error toast when file open fails.
- Fix FillPicker crash when selecting image fills (missing `ref` import from #92).
- Fix Google Fonts TLS/network errors not cached — failed families no longer retry on every render.
- Fix CJK text garbled when font is unavailable — fallback now renders through paragraph shaper instead of raw `drawText`, preserving CJK characters via the fallback font chain.
- Fix auto-layout overflow in AI-generated designs — text wrapping, min/max constraints, absolute positioning, and FILL sizing now work correctly.
- Fix `layoutAlignSelf` limited to STRETCH — full range supported (CENTER, MAX, MIN, BASELINE).
- Fix hidden auto-layout children losing their dimensions on layout recompute.
- Fix ProviderSettings popover not visible in AI chat.
- Fix paste/copy/cut intercepted by canvas in AI chat input.
- Strip TypeScript casts from AI-generated JSX (`as any`, `as const`).
- Fix parsing complex .fig files crashing on missing GUIDs in component overrides.
- Fix headless text layout using 100×100 default size instead of estimated dimensions — multi-line wrapping now estimated correctly.
- Fix clipboard roundtrip losing properties — clipsContent, constraints, arcData, strokeCap/Join, layoutAlignSelf, textAutoResize, autoRename now preserved in Figma Kiwi serialization.
- Fix MCP headless export crashing on `window.queryLocalFonts` in non-browser runtimes (Bun/Node).
- Fix MCP `export_image` rendering blank text — fonts now loaded before rasterization.
- Fix text always using paragraph rendering with Inter fallback chain (no more missing-font garbling).
- Clip children to rounded corners when `clipsContent` is true.
- Use child shape for drop shadows on transparent containers.
- Treat `FOREGROUND_BLUR` as layer blur wrapping children.
- Fix radial, angular, and diamond gradient rendering.
- Fix .fig export roundtrip: variable GUIDs colliding with document.
- Fix file open dialog not working on first click in Safari.
- Skip variable fonts from local font access, use Google Fonts instead.
- Disable autosave by default.

### Performance

- Offload .fig parsing (unzip + Kiwi decode) to a Web Worker — main thread stays responsive during file open.
- Offload .fig compression to a Web Worker during save (was blocking 450ms+).
- Add instance index (`componentId → Set<nodeId>`) — `getInstances()` is O(1) instead of scanning all nodes.
- Defer graph event subscription until after layout computation during file open — eliminates redundant `syncInstances` calls.
- Cache label collection (sections/components) per scene mutation instead of walking the full tree every frame.
- Blocking font loading — fonts load before first render to ensure correct glyphs.

## 0.9.0 — 2026-03-09

### Added

- XPath query command — `open-pencil query design.fig "//FRAME[@width < 300]"` to find nodes by type, attributes, and tree structure using XPath selectors.
- CSS Grid layout mode — select a frame, click the grid icon in the auto layout toolbar to switch from flex to grid. Configure column/row tracks (fr, fixed px, auto), column and row gaps, and per-side padding. Powered by a [Yoga fork](https://github.com/open-pencil/yoga/tree/grid) with cherry-picked CSS Grid PRs from upstream.
- JSX and Tailwind CSS export for grid layouts — `grid grid-cols-N`, `gap-x-*`/`gap-y-*`, child `col-start-*`/`row-start-*`/`col-span-*`/`row-span-*`.
- Multi-provider AI support — connect to Anthropic, OpenAI, Google AI, or any OpenAI-compatible endpoint directly, in addition to OpenRouter. Per-provider API key storage, provider settings popover, automatic migration from single OpenRouter key.
- Anthropic-compatible provider for custom API endpoints.
- New AI tools: `get_jsx` (JSX roundtrip view), `diff_jsx` (structural diff), `describe` (semantic role, visual style, layout, design issues).
- AI visual verification — `export_image` returns image content to the model for vision-based review.
- API type toggle (Completions/Responses) for OpenAI-compatible providers.
- Figma zoom shortcuts — ⌘0 (100%), ⌘1 (zoom to fit), ⌘2 (zoom to selection), ⇧1/⇧2 alternatives.
- XPath query tool — `query_nodes` for AI/MCP with attribute selectors, tree traversal, and type filtering.

### Changed

- Padding on a frame auto-enables vertical auto-layout.
- AI tools run `computeAllLayouts` after execution — layout updates immediately.
- Enhanced AI system prompt with full JSX prop reference and verification workflow.
- Chat panel preserves messages when toggling UI visibility.
- SceneGraph event bus (nanoevents) — `node:created`, `node:updated`, `node:deleted`, `node:reparented`, `node:reordered` events replace monkey-patching in collab sync and manual render invalidation.
- Replace esbuild-wasm (14 MB) with sucrase (201 KB) for JSX transform — `buildComponent()` and `renderJSX()` now synchronous and browser-compatible.
- `useMagicKeys` keyboard shortcut system — replaces tinykeys with VueUse built-in, cross-platform Meta/Control handling, modifier exclusion for combo conflicts.
- Dev-only debug toolbar for copying chat logs.
- Auto-layout icons in layer tree — vertical (rows), horizontal (columns), and grid icons for auto-layout frames; components keep their purple diamond.
- Frame titles on canvas are now draggable — clicking a selected top-level frame's name label starts a drag.
- Compact layout controls — icon-based gap (↔/↕) and padding (T/R/B/L) inputs instead of text labels.
- Auto-detect horizontal vs vertical direction when wrapping in auto layout (Shift+A).
- Fix alignment grid for vertical layouts — visual positions now match spatial axes.
- Fix grid switch from HUG-sized frames — frame expands to fit children.
- Remove unwanted white fill when wrapping in auto layout.

### Fixed

- Serialize variables, collections, and bindings to `.fig` files — previously lost on save (#65).
- Text nodes created via MCP now render in Figma — emit `derivedTextData` with font metadata and layout size (#64).
- Double-click on layer tree no longer toggles expand/collapse — use the chevron instead.
- Page rename input matches layer rename styling.
- Fix `w="fill"`/`h="fill"` in JSX renderer — now direction-aware based on parent flex axis.
- Fix text auto-resize defaulting to fixed 100×100 — text without explicit width uses `WIDTH_AND_HEIGHT`.
- Fix `clipsContent` not propagated to Yoga — frames with clip enabled now set `Overflow.Hidden`.
- Fix `COUNTER_ALIGN_MAP` mapping stretch to `MIN` instead of `STRETCH`.
- Fix JSX export omitting x/y for absolute-positioned children.
- Fix JSX export ignoring `textAutoResize` for text sizing.
- Fix drag terminating on mouseleave — drags now continue outside the canvas.
- Fix `export_image` stack overflow on large nodes — chunked base64 encoding.
- Undo support for auto-layout reorder, layer tree reorder, and drag reparent.
- Page snapshot undo for AI tool mutations.
- Fix collab sync for same-parent reorder — `node:reordered` events now propagated to Yjs peers.
- Fix orphaned instances on clipboard paste — detach to FRAME when component is missing.
- Fix text typography lost on Figma clipboard import — preserve fontFamily, fontWeight, fontSize, lineHeight.
- Fix `copyFill` missing `gradientTransform` and `imageTransform` — gradient fills now round-trip correctly.

### Performance

- Event-driven rendering and component sync — `SceneGraph` emits typed events on mutations; `requestRender()` calls reduced from 94 to 22, component instance sync uses microtask batching with deduplication.
- Replace `structuredClone` with typed copy helpers for fills, strokes, effects, and style runs (~24× faster in hot paths).
- Filter .fig unzip to only decompress canvas and image entries, skipping metadata cruft.

## 0.8.0 — 2026-03-07

### Added

- Mobile layout & PWA — responsive editor with touch-optimized toolbar, swipeable bottom drawer (layers/properties/design/code), HUD overlay, and installable PWA with icons and service worker.
- Tailwind CSS v4 JSX export — export selections as HTML with Tailwind utility classes (`<div className="flex gap-4 p-3">`) from the Code panel, CLI (`bun open-pencil export --format jsx --style tailwind`), or programmatically via `sceneNodeToJSX(id, graph, 'tailwind')`. Supports layout, sizing, colors, border radius, opacity, rotation, overflow, shadows, blur, and typography. Uses v4 spacing semantics (px/4 multiplier) with automatic fallback to arbitrary values.
- Code panel format toggle — switch between OpenPencil (custom components) and Tailwind (HTML + utility classes) output.
- Homebrew tap — `brew install open-pencil/tap/open-pencil` for macOS (arm64 + x64), auto-updated on each release.
- Double-click to rename layers — inline rename in layer panel, shared `useInlineRename` composable.
- New AI/MCP tools: `analyze_colors`, `analyze_typography`, `analyze_spacing`, `analyze_clusters`, `diff_create`, `diff_show`, `get_components`, `get_current_page`, `arrange`, `node_to_component`.
- CLI-to-app RPC bridge — all CLI commands work against the running app when no file is specified. Start the app, then run `bun open-pencil tree` to inspect the live document.
- VitePress docs site — user guide, reference, architecture, and development docs at openpencil.dev with 6 locales (en, de, fr, es, it, pl), SEO (OG tags, hreflang, JSON-LD, sitemap), and dark theme.

### Changed

- Refactor mobile drawer tabs, layout sizing dropdowns, and inline rename to use Reka UI primitives.
- Add shared UI style helpers with tailwind-variants for menus, selects, buttons, and surfaces.
- Unified tool definitions — define once in `packages/core/src/tools/`, automatically available in AI chat, CLI, and MCP.
- Harden FigmaAPI — hide internals via Symbols, freeze arrays, fix `layoutSizing`, 30+ new properties and methods.
- Split tools into domain files (read, create, modify, structure, variables, vector, analyze) — easier to navigate and extend.
- Replace inline type definitions with named types (`Color`, `Vector`, `SceneNode`) across the codebase.
- Split 3200-line `renderer.ts` into `packages/core/src/renderer/` with 10 focused files (scene, overlays, fills, strokes, shapes, effects, rulers, labels).
- Centralize all color utilities in `packages/core/src/color.ts` — `colorToHex8`, `colorToCSSCompact`, `normalizeColor`, `colorDistance`; remove 5 duplicate implementations across the codebase.
- Add `geometry.ts` with shared rotation math (`degToRad`, `radToDeg`, `rotatePoint`, `rotatedCorners`, `rotatedBBox`).
- Extract `isArrayMixed()` helper for multi-selection property panels.

- Add `motion-v` for declarative animations — used in mobile drawer (spring-animated height with pan gestures) and toolbar (layout-animated category switching with directional slide transitions).
- Mobile drawer: replace `useSwipe` + manual rAF animation with `motion.div` `:animate` + `@pan`/`@panEnd`; always-on tab state (no more null `activeRibbonTab`); content stays rendered when closed.
- Mobile toolbar: replace manual `scrollWidth` measuring + inline CSS transitions with `motion.div layout` + `AnimatePresence` directional slide variants.
- Mobile UI cleanup: extract shared `colorToCSS` util to core, `initials` to `src/utils/text`, `toolIcons` to `src/utils/tools`; replace hand-rolled dropdowns with reka-ui Popover/DropdownMenu; narrow `mobileDrawerSnap` type to string union; move magic numbers to constants; disable PWA service worker in dev mode.
- 83 new E2E tests (57 → 140): design panel, code panel, components, copy/paste, multi-page, text editing, keyboard shortcuts, context menu.
- 150 new unit tests (588 → 738): color, undo, snap, vector, style-runs, text-editor.
- 48 new E2E tests (9 spec files) + 26 mutation unit tests + store/canvas test helpers.
- Add `data-test-id` attributes to AppearanceSection, LayoutSection, TypographySection, VariablesDialog, EditorView.

### Fixed

- Fix drawer animation jump on close — single spring transition instead of two-phase.
- Fix `ALL_TOOLS` registry missing newer tools (`analyzeColors`, `diffCreate`, `exportImage`, `arrangeNodes`).
- Fix `renderJSX` typo in tool definitions (`renderJsx` → `renderJSX`).
- Fix all oxlint warnings and tsgo errors — replace `!` non-null assertions in `use-collab.ts` with local const captures.
- Fix broken test imports — stale `../../src/engine/` paths updated to `@open-pencil/core`.
- Fix flaky E2E tests: layers panel navigates to `/demo`, zoom-to-fit test zooms in first, snapshot rendering stabilized with `workers: 1` and `colorScheme: dark`.
- Fix bogus .fig import mappings for `expanded` and `strokeMiterLimit` fields.
- Fix PWA manifest error in dev mode, handle invalid font data gracefully.
- Fix eval response unwrapping and `export_jsx` page selection in RPC bridge.
- Fix automation commands not recomputing layouts after mutations.
- Fix workspace dependency not resolved when installing from npm (switch CI to pnpm publish).

## 0.7.0 — 2026-03-05

### Added

- SVG export — export selections as SVG from the export panel, context menu, CLI (`bun open-pencil export --format svg`), or MCP/AI tools (`export_svg`). Supports rectangles, ellipses, lines, stars, polygons, vectors, text with style runs, gradients, image fills, effects, blend modes, clip paths, and nested groups (#46).
- Copy/Paste as submenu in context menu — Copy as text, Copy as SVG, Copy as PNG (⇧⌘C), Copy as JSX.
- Stroke align (Inside/Center/Outside) with clip-based rendering matching Figma behavior.
- Individual stroke weights per side (Top/Right/Bottom/Left) with side selector dropdown.
- Google Fonts fallback — automatically loads fonts from Google Fonts API when not available locally.
- Auto-save toggle in File menu — disable to prevent automatic writes to the opened .fig file.
- Renderer profiler with in-canvas HUD overlay, GPU timing, and phase instrumentation.

### Changed

- Replace custom color picker with Reka UI Color components (ColorArea, ColorSlider, ColorField) — adds keyboard navigation and accessibility to the color area, hue, and alpha controls.

### Fixed

- CJK text rendering — load a system CJK font (PingFang SC, Microsoft YaHei, Noto Sans CJK) as fallback; falls back to Noto Sans SC from Google Fonts when no system font is available (#48).
- Font registration errors no longer cache invalid font data — `loadFont` only caches after successful CanvasKit registration.
- Fix `render` tool failing on Windows + Bun with "Cannot find module" error (#43).
- Fix hover highlighting nodes from internal component pages — scope hit-test to current page.
- Fix hit-testing on transparent frames and groups — empty containers without fills or strokes are now click-through, clipping parents reject hits outside their bounds, matching Figma behavior.
- Fix instance overrides on .fig import and clipboard paste — resolve guidPaths by overrideKey, handle component swaps (`overriddenSymbolID`), propagate through nested clone chains. Import and paste now share a single override engine.
- Apply Figma component property assignments on import — boolean visibility toggles and instance swaps via `componentPropRefs`/`componentPropAssignments`.
- Apply `derivedSymbolData` sizes on import — containers now shrink correctly when component properties hide children.
- Fix override resolution for nested instance targets — check the current node before searching descendants.
- Fix component property assignments for nested instances — resolve scoped `componentPropAssignments` inside `symbolOverrides` via guidPath, handle `guidValue` for instance swaps, reorder phases so transitive sync doesn't clobber visibility.
- Pixel-perfect vector rendering using pre-computed `fillGeometry`/`strokeGeometry` blobs from .fig files — eliminates white gaps between adjacent stroked shapes.
- Stroke outlines on clipboard paste — convert vectorNetwork paths to filled outlines via CanvasKit when geometry blobs are unavailable.
- Apply `derivedSymbolData` transforms and geometry during import — instance children render at correct scale and position.
- Fix internal pages becoming visible after .fig round-trip — preserve `internalOnly` flag on export.
- Scope layout recomputation to current page for paste/undo/font-load (major speedup on large multi-page files).
- Show loading overlay until all document fonts are loaded (no more partially rendered text).
- Load fonts when switching pages (previously only loaded for the first page).
- Always show visibility toggle on fill, stroke, and effect rows (matches Figma).
- Fix renderer crash on double destroy when closing files quickly.
- Fix .fig page ordering — use deterministic byte comparison for fractional index positions.
- Fix text truncation using `textTruncation` field instead of `textAutoResize`.
- Fix horizontal scrollbar on design and pages panels.
- Style scrollbars for Tauri (thin dark overlay instead of default OS chrome).
- Enable file watcher in Tauri — `watch` feature was missing from `tauri-plugin-fs`.

## 0.6.0 — 2026-03-04

### Added

- Multi-selection properties panel — edit position, size, appearance, fill, stroke, and effects across multiple selected nodes.
- Shared values display normally, differing values show "Mixed".
- W/H inputs in multi-selection mode.
- Flip horizontal/vertical using scale transform instead of rotation.
- Single-node alignment aligns to parent frame bounds.
- ACP agent package — Agent Communication Protocol server for AI coding tools, reusing core ToolDefs.

### Changed

- Apple code signing and notarization for macOS builds.
- Git LFS storage moved from GitHub to Cloudflare R2.

### Fixed

- Fix Figma clipboard paste: extract shared kiwi→SceneNode conversion, fixing broken auto-layout, missing gradient/image fills, effects, style runs, and text properties.
- Fix vector rendering on paste — scale path coordinates from Figma's normalizedSize to actual node bounds.
- Fix pasted instances having no children — populate from component via symbolData when both are in clipboard.
- Detect component sets on import — promote FRAME nodes with VARIANT componentPropDefs to COMPONENT_SET.
- Skip internal canvas on paste — components on Figma's hidden internal page populate instances but are not pasted as visible nodes.
- Apply instance overrides on paste — text content, fills, visibility, layoutGrow, and textAutoResize from symbolOverrides.
- Fix auto-layout child ordering — sort by geometric position instead of z-order position strings.
- Load fonts on paste and .fig import — collect font families from text nodes and load into CanvasKit.
- Text measurement in auto-layout — use CanvasKit paragraph metrics for WIDTH_AND_HEIGHT text nodes.
- Recompute layouts after font loading completes.
- Fix PERCENT line height conversion — was stored as raw value instead of pixels.
- Fix InvalidCharacterError when copying nodes with non-ASCII text.
- Load all font weight/style variants needed by pasted text nodes.
- Fix font loading not registering in core cache.
- Fix halfLeading applied to text measurement — enable only for rendering.
- Clear hover on zoom/pinch to keep scene picture cache valid.
- Fix flip buttons using rotation math instead of actual mirroring.
- Fix flip transform encoding — scale first matrix column only (was incorrectly producing 180° rotation).
- Decode flip state from .fig transform matrix on import.

## 0.5.1 — 2026-03-03

### Fixed

- Fix File → Save crash when document has layer blur effects.

## 0.5.0 — 2026-03-03

### Added

- Effects rendering: drop shadow, inner shadow, shadow spread, layer blur, background blur, foreground blur.
- Text shadows render on glyphs instead of bounding box.
- Multi-file tabs — open multiple documents in tabs within a single window.
- Tab bar with close buttons, middle-click to close, and new tab (+) button.
- Keyboard shortcuts: ⌘N/⌘T new tab, ⌘W close tab, ⌘O opens in new tab.
- Native Tauri menu: File → New and File → Close Tab wired to tab actions.
- Render text from SkPicture cache when fonts are missing — pixel-perfect display without the font installed.
- Missing font indicator (⚠) next to font picker in the sidebar.
- Right-click context menu on layers panel — same actions as the canvas context menu.
- 40+ new AI/MCP tools ported from figma-use:
  - Granular set tools: `set_rotation`, `set_opacity`, `set_radius`, `set_minmax`, `set_text`, `set_font`, `set_font_range`, `set_text_resize`, `set_visible`, `set_blend`, `set_locked`, `set_stroke_align`
  - Node operations: `node_bounds`, `node_move`, `node_resize`, `node_ancestors`, `node_children`, `node_tree`, `node_bindings`, `node_replace_with`
  - Variable CRUD: `get_variable`, `find_variables`, `create_variable`, `set_variable`, `delete_variable`, `bind_variable`
  - Collection CRUD: `get_collection`, `create_collection`, `delete_collection`
  - Boolean operations: `boolean_union`, `boolean_subtract`, `boolean_intersect`, `boolean_exclude`
  - Vector path tools: `path_get`, `path_set`, `path_scale`, `path_flip`, `path_move`
  - Create tools: `create_page`, `create_vector`, `create_slice`
  - Viewport: `viewport_get`, `viewport_set`, `viewport_zoom_to_fit`, `page_bounds`
  - Misc: `flatten_nodes`, `list_fonts`
- `set_text_properties` tool: alignment, auto-resize, decoration.
- `set_layout_child` tool: sizing, grow, align_self, positioning.
- 13 MCP server integration tests via `InMemoryTransport`.

### Changed

- Resizable pages/layers split in left panel with reka-ui Splitter.
- Layers tree auto-expands and scrolls to reveal selected node.
- Loading overlay on canvas while opening .fig files.
- Hide internal-only pages (e.g. "Internal Only Canvas" in design systems).
- Render page dividers — pages named with only dashes/asterisks/spaces show as horizontal lines.
- Only show component labels for COMPONENT and COMPONENT_SET, not instances.
- Replace all native `<select>` dropdowns with reka-ui `AppSelect` component.
- Smoother trackpad pinch-to-zoom with `Math.exp` curve and deltaMode normalization.
- Fix font picker dropdown truncating long font names.
- Show explanation in font picker when Local Font Access API unavailable (Safari/Firefox).

- Auto-populate GitHub Release notes from CHANGELOG.md via `ffurrer2/extract-release-notes@v2`.
- Skip already-published npm versions on CI re-runs instead of failing.
- Exclude non-app directories from Vite file watcher.

- Extract shared color constants (`BLACK`, `TRANSPARENT`, `DEFAULT_SHADOW_COLOR`) — replaces 8 inline literals across core.
- Extract shared `NodeContextMenuContent` component to avoid menu duplication.
- Fix `@open-pencil/core` dep in MCP package: `workspace:*` for local dev (pnpm resolves at publish time).
- Replace store thunks with a late-binding proxy.

- Clipboard roundtrip tests: encode to Figma Kiwi binary → decode → verify.
- 9 visual regression snapshot tests for effects rendering.
- Zoom/pan E2E tests and pipeline benchmark.
- MCP server edge-case tests for `find_nodes` and Zod validation.
- 6 unit tests for absolute position cache.

### Fixed

- Fix drop shadow rendering on top of fills — shadow now draws behind opaque content.
- Fix effect property changes not recorded in undo/redo history.
- Fix active tab text invisible against same-color background.
- Fix clipboard "Outside int range" error — `pasteID` used unsigned int exceeding Kiwi's signed 32-bit field.
- Error toasts are now sticky (don't auto-dismiss), with selectable text, copy button, and close button.
- Truncate long node names in export button.

### Performance

- Per-node SkPicture cache for effect rendering — unchanged shadow/blur nodes replay from cache on scene redraws.
- Drop shadows use `MaskFilter` direct draw instead of `saveLayer` offscreen buffers.
- Cached `ImageFilter`, `MaskFilter`, reusable effect paint — zero per-frame WASM allocations for effects.
- Reuse GL context on panel resize — swap surface without recreating renderer, preserving all caches.
- Per-frame absolute position cache — avoids repeated parent-chain walks during rendering.
- Optimize zoom/pan smoothness with `shallowReactive`, `useRafFn`, and input coalescing.

## 0.4.2 — 2026-03-02

### Changed

- Import additional properties from Figma clipboard: `layoutAlignSelf`, `clipsContent`, `fontWeight`, `italic`, `letterSpacing`, `lineHeight`.
- Convert `letterSpacing` PERCENT units to pixels based on font size.

- 7 new clipboard import unit tests (14 total).

### Fixed

- Fix Figma clipboard paste: skip non-visual node types (variables, widgets, stickies, connectors).
- Fix text not rendering after paste — `letterSpacing` from Figma is a `{value, units}` object, was passed as-is → `NaN` broke CanvasKit paragraph layout.
- Fix undo/redo for Figma paste — no undo entry was recorded; redo duplicated `childIds`.
- Center pasted Figma content in viewport instead of using original coordinates.
- Compute auto-layouts after clipboard paste (same as .fig import and demo creation).

## 0.4.1 — 2026-03-02

### Changed

- Highlight copy & paste with Figma in README and feature docs.
- Replace "fig-kiwi" format name with "Kiwi binary" — the format is shared between .fig files and clipboard.

### Fixed

- Fix text disappearing after hover when SkPicture cache was recorded before fonts loaded.
- Invalidate scene picture cache on font load to prevent stale fallback text.

## 0.4.0 — 2026-03-02

### Added

- MCP server (`@open-pencil/mcp`) — 29 tools for headless .fig editing via stdio (Claude Code, Cursor, Windsurf) or HTTP (Hono + Streamable HTTP with sessions).
- `openpencil-mcp` and `openpencil-mcp-http` binaries — install globally via `bun add -g @open-pencil/mcp`.

### Changed

- All packages emit JS via tsgo + fix-esm-import-path — `@open-pencil/core` and `@open-pencil/mcp` work on Node.js without Bun.
- Core package exports: `bun` condition → src (dev), `import` condition → dist (npm consumers).
- `@open-pencil/mcp` added to CI publish workflow.

## 0.3.2 — 2026-03-02

### Changed

- Visual regression tests for SkPicture cache: hover on/off cycle, multiple cycles, mouse hover, scene change + hover.
- Type `window.__OPEN_PENCIL_STORE__` globally, remove ad-hoc casts from tests.

### Performance

- Re-apply SkPicture scene caching for ~7x faster pan/zoom (0.98ms vs 6.8ms per frame at 500 nodes).

## 0.3.1 — 2026-03-02

### Fixed

- Fix text disappearing after hovering a frame (revert SkPicture scene caching).
- Fix macOS startup hang: async font loading, show window on reopen.

## 0.3.0 — 2026-03-01

### Fixed

- Fix npm publish: use pnpm for workspace dependency resolution with provenance.
- CLI version now reads from package.json instead of hardcoded value.
- Update README: accurate app size (~7 MB), streamlined feature list, current project structure.

### Performance

- SkPicture scene caching — pan/zoom replays cached display list instead of re-rendering all nodes.
- Cache vector network paths — avoid rebuilding WASM paths every frame.
- Cache ruler and pen overlay paints — eliminate 10 WASM Paint allocations per frame.
- Only enable `preserveDrawingBuffer` in test mode.
- Hoist URL param parsing out of render loop.

## 0.2.1 — 2026-03-01

### Changed

- Panel header with app logo, editable document name, and sidebar toggle.
- ⌘\\ to toggle side panels for distraction-free canvas.
- Panels hidden by default on mobile (< 768px).
- Floating bar with logo, filename, and restore button when panels hidden.
- Always show local user avatar in collab header.
- Touch support for pan and pinch-zoom on iOS.

### Performance

- Stubbed shiki to remove 9MB of unused language grammars (20MB → 11MB bundle).

## 0.2.0 — 2026-03-01

### Added

- Real-time P2P collaboration via Trystero (WebRTC) + Yjs CRDT.
- Peer-to-peer sync — no server relay, zero hosting cost.
- WebRTC signaling via MQTT public brokers.
- STUN (Google, Cloudflare) + TURN (Open Relay) for NAT traversal.
- Awareness protocol: live cursors, selections, presence.
- Figma-style colored cursor arrows with name pills.
- Click peer avatar to follow their viewport, click again to stop.
- Stale cursor cleanup on peer disconnect.
- Local persistence via y-indexeddb — room survives page refresh.
- Share link at `/share/<room-id>` with vue-router.
- Secure room IDs via `crypto.getRandomValues()`.
- Removed Cloudflare Durable Object relay server (`packages/collab/`).

### Changed

- Toast notifications via Reka UI Toast — top-center blue pill for info, red for errors.
- Global error handler (window.error + unhandledrejection) shows errors as toasts.
- Link copied toast on share and copy link actions.
- HsvColorArea extracted as shared component (ColorPicker + FillPicker).
- Scrollable app menu without visible scrollbar.
- Selection broadcasting to remote peers.

## 0.1.0-alpha — 2026-03-01

First public alpha. The editor is functional but not production-ready.

### Added

- Canvas rendering via CanvasKit (Skia WASM) on WebGL surface.
- Rectangle, Ellipse, Line, Polygon, Star drawing tools.
- Pen tool with vector network model (bezier curves, open/closed paths).
- Inline text editing on canvas with phantom textarea for input/IME.
- Rich text formatting: bold, italic, underline per-character via style runs.
- Font picker with system font enumeration (font-kit on desktop, Local Font Access API in browser).
- Auto-layout via Yoga WASM (direction, gap, padding, justify, align, child sizing).
- Components, instances, component sets with live sync and override preservation.
- Variables with collections, modes, color bindings, alias chains.
- Undo/redo for all operations (inverse-command pattern).
- Snap guides with rotation-aware edge/center snapping.
- Canvas rulers with selection range badges.
- Marquee selection, multi-select, resize handles, rotation.
- Group/ungroup, z-order, visibility, lock.
- Sections with title pills and auto-adoption of overlapping nodes.
- Multi-page documents with independent viewport state.
- Hover highlight following node geometry (ellipses, rounded rects, vectors).
- Context menu with clipboard, z-order, grouping, component, and visibility actions.
- Color picker with HSV, gradients (linear, radial, angular, diamond), image fills.
- Properties panel: position, appearance, fill, stroke, effects, typography, layout, export.
- ScrubInput drag-to-change number controls.
- Resizable side panels via reka-ui Splitter.

- .fig file import via Kiwi binary codec (194 definitions, ~390 fields).
- .fig file export with Kiwi encoding, Zstd compression, thumbnail generation.
- Figma clipboard: copy/paste between OpenPencil and Figma.
- Round-trip fidelity for supported node types.

- Built-in AI chat in properties panel (⌘J).
- Direct browser → OpenRouter communication, no backend.
- Model selector: Claude, Gemini, GPT, DeepSeek, Qwen, Kimi, Llama.
- 10 AI tools: create_shape, set_fill, set_stroke, update_node, set_layout, delete_node, select_nodes, get_page_tree, get_selection, rename_node.
- Streaming markdown responses (vue-stream-markdown).
- Tool call timeline with collapsible details.

- JSX export of selected nodes with Tailwind-like shorthand props.
- Syntax highlighting via Prism.js.
- Copy to clipboard.

- `info` — document stats, node types, fonts.
- `tree` — visual node tree.
- `find` — search by name/type.
- `export` — render to PNG/JPG/WEBP at any scale.
- `node` — detailed properties by ID.
- `pages` — list pages with node counts.
- `variables` — list design variables and collections.
- `eval` — run scripts with Figma-compatible plugin API.
- `analyze colors` — color palette usage.
- `analyze typography` — font/size/weight distribution.
- `analyze spacing` — gap/padding values.
- `analyze clusters` — repeated patterns.
- All commands support `--json`.

- Scene graph with flat Map storage and parentIndex tree.
- FigmaAPI with ~65% Figma plugin API compatibility.
- JSX renderer (TreeNode builder functions with shorthand props).
- Kiwi binary codec (encode/decode).
- Vector network blob encoder/decoder.

- Tauri v2 (~5 MB).
- Native menu bar, save/open dialogs.
- System font enumeration via font-kit.
- Zstd compression in Rust.
- macOS and Windows builds via GitHub Actions.

- Runs at [app.openpencil.dev](https://app.openpencil.dev).
- No installation required.
- File System Access API for save/open (Chrome/Edge), download fallback elsewhere.

- [openpencil.dev](https://openpencil.dev) — VitePress site with user guide, reference, and development docs.
- Deployed via Cloudflare Pages.
