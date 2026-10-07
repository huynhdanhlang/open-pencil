import { FigmaAPI } from '@open-pencil/core/figma-api'
import { createCanvasKitRasterCodec } from '@open-pencil/core/io/formats/raster'
import { computeBounds } from '@open-pencil/scene-graph/geometry'

import type { EditorStore } from '@/app/editor/active-store'
import { listFamilies, listFonts } from '@/app/editor/fonts'

export function makeFigmaFromStore(
  store: EditorStore,
  pageId = store.state.currentPageId
): FigmaAPI {
  const api = new FigmaAPI(store.graph)
  api.setRenderer(store.renderer ?? null)
  api.runtimeHistory = () => store.undo.diagnostics
  api.runtimePersistence = store.getPersistenceStatus
  api.runtimeRenderers = () => store.canvasRenderers.map((renderer) => renderer.getResourceUsage())
  api.theme = store.state.theme ?? 'light'
  api.currentPage = api.wrapNode(pageId)
  const requireShownPage = () => {
    if (store.state.currentPageId !== pageId) {
      throw new Error(`Activate page "${pageId}" before changing its selection or viewport`)
    }
  }
  // The user's selection belongs to the page on screen.
  Object.defineProperty(api.currentPage, 'selection', {
    get: () =>
      pageId === store.state.currentPageId
        ? [...store.state.selectedIds]
            .map((id) => api.getNodeById(id))
            .filter((n): n is NonNullable<typeof n> => n !== null)
        : [],
    set: (nodes: FigmaAPI['currentPage']['selection']) => {
      requireShownPage()
      if (nodes.some((node) => !store.graph.isDescendant(node.id, pageId))) {
        throw new Error('Selection contains a node outside the target page')
      }
      store.select(nodes.map((node) => node.id))
    },
    configurable: true
  })
  Object.defineProperty(api, 'viewport', {
    get: () => ({
      ...store.getViewport(),
      scrollAndZoomIntoView: (
        nodes: Parameters<FigmaAPI['viewport']['scrollAndZoomIntoView']>[0]
      ) => {
        if (nodes.length === 0) return
        requireShownPage()
        const bounds = computeBounds(nodes.map((node) => node.absoluteBoundingBox))
        store.zoomToBounds(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height)
      }
    }),
    set: (view: Pick<FigmaAPI['viewport'], 'center' | 'zoom'>) => {
      requireShownPage()
      store.centerOn(view.center.x, view.center.y, view.zoom)
    },
    configurable: true
  })
  api.exportImage = (nodeIds, opts) =>
    store.renderExportImage(nodeIds, opts.scale ?? 1, opts.format ?? 'PNG', opts.pageId ?? pageId)
  if (store.renderer) api.rasterCodec = createCanvasKitRasterCodec(store.renderer.ck)
  api.listAvailableFontsAsync = async () => {
    const [systemFonts, familyOptions] = await Promise.all([listFonts(), listFamilies()])
    const fonts = systemFonts.flatMap(({ family, styles }) =>
      styles.map((style) => ({ fontName: { family, style } }))
    )
    const seenFamilies = new Set(systemFonts.map(({ family }) => family))
    for (const { family } of familyOptions) {
      if (!seenFamilies.has(family)) fonts.push({ fontName: { family, style: 'Regular' } })
    }
    return fonts
  }
  return api
}
