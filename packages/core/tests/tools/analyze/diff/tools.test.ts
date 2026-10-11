import { describe, expect, test } from 'bun:test'

import { expectDefined, getNodeOrThrow } from '#core-tests/helpers/assert'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { ALL_TOOLS, diffDocuments, prepareDiffApply } from '@open-pencil/core/tools'
import { SceneGraph, type Color } from '@open-pencil/scene-graph'

import { buildIconData } from '#core/icons/svg'

type DiffResult = { diff?: string | null; message?: string; error?: string }
type ApplyResult = {
  error?: string
  applied?: number
  failed?: number
  results?: {
    status: string
    id: string | null
    error?: string
    changes?: string[]
  }[]
}

function tool(name: string) {
  return expectDefined(
    ALL_TOOLS.find((candidate) => candidate.name === name),
    name
  )
}

async function run<Result>(figma: FigmaAPI, name: string, args: Record<string, unknown>) {
  return (await tool(name).execute(figma, args)) as Result
}

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 }

function setup() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const card = figma.createFrame()
  card.name = 'Card'
  card.resize(200, 100)
  card.fills = [{ type: 'SOLID', color: WHITE, opacity: 1, visible: true }]
  const label = figma.createRectangle()
  label.name = 'Label'
  label.resize(80, 20)
  card.appendChild(label)
  const badge = figma.createEllipse()
  badge.name = 'Badge'
  card.appendChild(badge)
  return { graph, figma, card, label, badge }
}

async function createPatch(figma: FigmaAPI, from: string, to: string): Promise<string> {
  return expectDefined((await run<DiffResult>(figma, 'diff_create', { from, to })).diff, 'patch')
}

describe('diff_create and diff_apply', () => {
  test('explicit expected attributes survive artwork preparation and the commit boundary', async () => {
    const { graph, figma, card, label } = setup()
    figma.icons = {
      ...figma.icons,
      icons: async () => {
        label.resize(90, 20)
        return new Map([
          [
            'owned:dot',
            buildIconData({ body: '<path d="M0 0h24v24H0z"/>' }, 'owned', 'dot', 24, 24, 24)
          ]
        ])
      }
    }
    const prepared = await prepareDiffApply(figma, {
      operations: [
        { kind: 'update', id: label.id, attributes: 'name="Changed"', expected: 'w={80}' },
        { kind: 'add', parentId: card.id, index: 0, jsx: '<Icon name="owned:dot" />' }
      ]
    })
    expect(await prepared.execute()).toHaveProperty('error')
    expect(graph.getNode(label.id)).toMatchObject({ name: 'Label', width: 90 })
    const next = await prepareDiffApply(figma, {
      operations: [
        { kind: 'update', id: label.id, attributes: 'name="Changed"', expected: 'w={90}' }
      ]
    })
    label.resize(100, 20)
    await expect(next.execute()).rejects.toThrow('current state does not match')
    expect(graph.getNode(label.id)).toMatchObject({ name: 'Label', width: 100 })
  })
  test('structured edits update, add, remove and reorder in one request', async () => {
    const { graph, figma, card, label, badge } = setup()
    const result = await run<ApplyResult>(figma, 'diff_apply', {
      operations: [
        { kind: 'update', id: card.id, attributes: 'width={240} rounded={16}' },
        { kind: 'remove', id: label.id },
        { kind: 'move', id: badge.id, index: 1 },
        {
          kind: 'add',
          parentId: card.id,
          index: 0,
          jsx: '<Frame name="Note"><Text>Hello 🎬</Text></Frame>'
        }
      ]
    })
    expect(result).toMatchObject({ applied: 4, failed: 0 })
    expect(graph.getNode(card.id)).toMatchObject({ width: 240, cornerRadius: 16 })
    expect(graph.getNode(label.id)).toBeUndefined()
    const children = getNodeOrThrow(graph, card.id).childIds
    expect(children[1]).toBe(badge.id)
    expect(graph.getNode(children[0])?.name).toBe('Note')
  })

  test('structured updates preserve explicit stale guards and dry run', async () => {
    const { graph, figma, card } = setup()
    const operations = [{ kind: 'update', id: card.id, attributes: 'w={240}', expected: 'w={200}' }]
    expect(await run<ApplyResult>(figma, 'diff_apply', { operations, dryRun: true })).toMatchObject(
      { failed: 0 }
    )
    expect(graph.getNode(card.id)?.width).toBe(200)
    card.resize(210, 100)
    expect(await run<ApplyResult>(figma, 'diff_apply', { operations })).toHaveProperty('error')
    expect(graph.getNode(card.id)?.width).toBe(210)
  })

  test('rejects all edits when one target is outside the current page or removed by the group', async () => {
    const { graph, figma, card, label } = setup()
    const other = graph.createNode('FRAME', graph.addPage('Other').id)
    for (const operations of [
      [
        { kind: 'update', id: card.id, attributes: 'w={240}' },
        { kind: 'remove', id: other.id }
      ],
      [
        { kind: 'remove', id: card.id },
        { kind: 'update', id: label.id, attributes: 'w={120}' }
      ]
    ]) {
      expect(await run<ApplyResult>(figma, 'diff_apply', { operations })).toHaveProperty('error')
      expect(graph.getNode(card.id)?.width).toBe(200)
      expect(graph.getNode(label.id)).toBeDefined()
      expect(graph.getNode(other.id)).toBeDefined()
    }
  })

  test('edits related pages only when they are explicitly included', async () => {
    const { graph, figma, card } = setup()
    const page = graph.addPage('Related')
    const other = graph.createNode('FRAME', page.id)
    expect(
      await run<ApplyResult>(figma, 'diff_apply', {
        page_ids: [figma.currentPageId, page.id],
        operations: [
          { kind: 'update', id: card.id, attributes: 'rounded={12}' },
          { kind: 'update', id: other.id, attributes: 'rounded={12}' }
        ]
      })
    ).toMatchObject({ applied: 2, failed: 0 })
    expect(graph.getNode(card.id)?.cornerRadius).toBe(12)
    expect(graph.getNode(other.id)?.cornerRadius).toBe(12)
  })

  test('rejects ambiguous inputs and duplicate updates before changing content', async () => {
    const { graph, figma, card } = setup()
    const operation = { kind: 'update', id: card.id, attributes: 'opacity={0.5}' }
    expect(
      await run<ApplyResult>(figma, 'diff_apply', {
        patch: `@@ /Card #${card.id}\n+rounded={4}`,
        operations: [operation]
      })
    ).toHaveProperty('error')
    expect(
      await run<ApplyResult>(figma, 'diff_apply', { operations: [operation, operation] })
    ).toHaveProperty('error')
    expect(graph.getNode(card.id)).toMatchObject({ opacity: 1, cornerRadius: 0 })
  })

  test('normalizes unset aliases and rejects contradictions, unknown unsets and duplicate moves', async () => {
    const { graph, figma, card, badge } = setup()
    expect(
      await run<ApplyResult>(figma, 'diff_apply', {
        operations: [{ kind: 'update', id: card.id, attributes: '', unset: ['width'] }]
      })
    ).toMatchObject({ applied: 1 })
    expect(graph.getNode(card.id)?.width).not.toBe(200)
    for (const operations of [
      [{ kind: 'update', id: card.id, attributes: 'w={240}', unset: ['width'] }],
      [{ kind: 'update', id: card.id, attributes: 'w={240}', unset: ['unknown'] }],
      [
        { kind: 'move', id: badge.id, index: 0 },
        { kind: 'move', id: badge.id, index: 1 }
      ]
    ])
      expect(await run<ApplyResult>(figma, 'diff_apply', { operations })).toHaveProperty('error')
  })

  test('a patch from a modified copy makes the original match it', async () => {
    const { graph, figma, card, label, badge } = setup()
    const copy = card.clone()
    copy.name = 'Card copy'
    copy.opacity = 0.5
    copy.cornerRadius = 12
    expectDefined(copy.children[0], 'copied label').resize(120, 24)
    // Move the badge first and add a note at the end.
    copy.insertChild(0, expectDefined(copy.children[1], 'copied badge'))
    const note = figma.createText()
    note.name = 'Note'
    note.characters = 'Sale'
    copy.appendChild(note)

    const patch = await createPatch(figma, card.id, copy.id)
    expect(patch).toContain(`@@ /Card #${card.id}\n+rounded={12}\n+opacity={0.5}`)
    expect(patch).toContain(`@@ /Card/Label #${label.id}\n-w={80}\n-h={20}\n+w={120}\n+h={24}`)
    expect(patch).toContain(`@@ /Card/Badge #${badge.id} moved to 0`)
    expect(patch).toContain(`@@ /Card/Note added to #${card.id} at 2\n+<Text name="Note"`)

    const applied = await run<ApplyResult>(figma, 'diff_apply', { patch })
    expect(applied).toMatchObject({ applied: 4, failed: 0 })
    // Updates and moves keep their nodes; only the added note is new.
    expect(getNodeOrThrow(graph, card.id).childIds.slice(0, 2)).toEqual([badge.id, label.id])
    expect(getNodeOrThrow(graph, label.id).width).toBe(120)
    expect(
      await run<DiffResult>(figma, 'diff_create', {
        from: card.id,
        to: copy.id
      })
    ).toEqual({
      diff: null,
      message: 'No differences found'
    })
  })

  test('changes only the fields an attribute moves', async () => {
    const { graph, figma, card } = setup()
    card.setPluginData('note', 'kept')
    const copy = card.clone()
    copy.opacity = 0.5

    await run<ApplyResult>(figma, 'diff_apply', {
      patch: await createPatch(figma, card.id, copy.id)
    })
    expect(getNodeOrThrow(graph, card.id).opacity).toBe(0.5)
    expect(card.getPluginData('note')).toBe('kept')
  })

  test('rejects a stale patch without changing any node', async () => {
    const { graph, figma, card, label } = setup()
    const copy = card.clone()
    copy.opacity = 0.5
    expectDefined(copy.children[0], 'copied label').resize(120, 24)
    const patch = await createPatch(figma, card.id, copy.id)
    label.resize(90, 20)

    const applied = await run<ApplyResult>(figma, 'diff_apply', { patch })
    expect(applied.error).toBe('Patch does not apply')
    expect(applied.results?.[0]?.error).toContain('w: expected w={80}, found w={90}')
    // The card still matched, but a stale patch must not half-apply.
    expect(getNodeOrThrow(graph, card.id).opacity).toBe(1)
  })

  test.each([false, true])(
    'rejects a patch with an invalid value without changing any node (force: %p)',
    async (force) => {
      const { graph, figma, card, label } = setup()
      const copy = card.clone()
      copy.opacity = 0.5
      expectDefined(copy.children[0], 'copied label').resize(120, 24)
      const patch = (await createPatch(figma, card.id, copy.id)).replace('+w={120}', '+w={wide}')

      const applied = await run<ApplyResult>(figma, 'diff_apply', {
        patch,
        force
      })
      expect(applied.error).toBe('Patch does not apply')
      // The card's change was valid, but it must not land without the label's.
      expect(getNodeOrThrow(graph, card.id).opacity).toBe(1)
      expect(getNodeOrThrow(graph, label.id).width).toBe(80)
    }
  )

  test('rejects a patch that adds an attribute the node has since gained', async () => {
    const { figma, label } = setup()
    const shown = await run<DiffResult>(figma, 'diff_show', {
      id: label.id,
      attributes: 'opacity={0.5}'
    })
    label.opacity = 0.8

    const applied = await run<ApplyResult>(figma, 'diff_apply', {
      patch: expectDefined(shown.diff, 'patch')
    })
    expect(applied.results?.[0]?.error).toContain('opacity: expected none, found opacity={0.8}')
  })

  test('dry run reports changes without applying them', async () => {
    const { graph, figma, card } = setup()
    const copy = card.clone()
    copy.opacity = 0.25

    const applied = await run<ApplyResult>(figma, 'diff_apply', {
      patch: await createPatch(figma, card.id, copy.id),
      dryRun: true
    })
    expect(applied.results?.[0]?.changes).toEqual(['opacity'])
    expect(getNodeOrThrow(graph, card.id).opacity).toBe(1)
  })

  test('removes children the target no longer has', async () => {
    const { graph, figma, card, label } = setup()
    const copy = card.clone()
    expectDefined(copy.children[0], 'copied label').remove()

    const applied = await run<ApplyResult>(figma, 'diff_apply', {
      patch: await createPatch(figma, card.id, copy.id)
    })
    expect(applied.results?.map((result) => result.status)).toEqual(['removed'])
    expect(graph.getNode(label.id)).toBeUndefined()
  })

  test('rejects an attribute the renderer would ignore', async () => {
    const { graph, figma, card } = setup()
    const patch = `@@ /Card #${card.id}\n+opacity={0.5}\n+bogus={1}`

    const applied = await run<ApplyResult>(figma, 'diff_apply', { patch })
    expect(applied.error).toBe('Patch does not apply')
    expect(applied.results?.[0]?.error).toBe('Unsupported attribute "bogus"')
    expect(getNodeOrThrow(graph, card.id).opacity).toBe(1)
  })

  test('leaves the document as it was when an added node fails to render', async () => {
    const { graph, figma, card } = setup()
    const children = [...getNodeOrThrow(graph, card.id).childIds]
    // The JSX evaluates, so the check passes, but rendering finds no such component.
    const patch = [
      `@@ /Card #${card.id}`,
      '+opacity={0.5}',
      `@@ /Card/Dot added to #${card.id} at 0`,
      '+<Ellipse name="Dot" />',
      `@@ /Card/Button added to #${card.id} at 1`,
      '+<Instance component="Missing" />'
    ].join('\n')

    const applied = await run<ApplyResult>(figma, 'diff_apply', { patch })
    expect(applied.error).toBe('Patch does not apply')
    expect(applied.results?.[0]?.error).toContain('component not found: Missing')
    expect(getNodeOrThrow(graph, card.id).opacity).toBe(1)
    expect(getNodeOrThrow(graph, card.id).childIds).toEqual(children)
  })

  test('reports a hunk it cannot read', async () => {
    const { figma } = setup()
    const applied = await run<ApplyResult>(figma, 'diff_apply', {
      patch: 'w={1}'
    })
    expect(applied.error).toBe('Line 1: unexpected line: w={1}')
  })
})

describe('diff_show', () => {
  test('previews fontSize under its exported name and applies it with stale checks', async () => {
    const { graph, figma } = setup()
    const label = figma.createText()
    label.name = 'Request'
    label.fontSize = 17

    const shown = await run<DiffResult>(figma, 'diff_show', {
      id: label.id,
      attributes: 'fontSize={18}'
    })
    const patch = expectDefined(shown.diff, 'patch')
    expect(patch).toBe(`@@ /Request #${label.id}\n-size={17}\n+size={18}`)
    const preview = await run<ApplyResult>(figma, 'diff_apply', {
      patch,
      dryRun: true
    })
    expect(preview.results?.[0]?.changes).toEqual(['size'])
    expect(getNodeOrThrow(graph, label.id).fontSize).toBe(17)
    label.fontSize = 19
    expect((await run<ApplyResult>(figma, 'diff_apply', { patch })).error).toBe(
      'Patch does not apply'
    )
    expect(getNodeOrThrow(graph, label.id).fontSize).toBe(19)
    label.fontSize = 17
    expect(await run<ApplyResult>(figma, 'diff_apply', { patch })).toMatchObject({
      applied: 1,
      failed: 0
    })
    expect(getNodeOrThrow(graph, label.id).fontSize).toBe(18)
  })

  test('checks alias-only legacy additions against the existing canonical attribute', async () => {
    const { graph, figma } = setup()
    const label = figma.createText()
    label.fontSize = 17
    const patch = `@@ /Request #${label.id}\n+fontSize={18}`
    const stale = await run<ApplyResult>(figma, 'diff_apply', { patch })
    expect(stale.results?.[0]?.error).toContain('size: expected none, found size={17}')
    expect(getNodeOrThrow(graph, label.id).fontSize).toBe(17)
    expect(await run<ApplyResult>(figma, 'diff_apply', { patch, force: true })).toMatchObject({
      applied: 1,
      failed: 0
    })
    expect(getNodeOrThrow(graph, label.id).fontSize).toBe(18)
  })

  test.each([false, true])('rejects contradictory aliases even when force is %p', async (force) => {
    const { graph, figma, card } = setup()
    const shown = await run<DiffResult>(figma, 'diff_show', {
      id: card.id,
      attributes: 'w={220} width={240}'
    })
    expect(shown.error).toContain('Conflicting attributes for "w"')
    const applied = await run<ApplyResult>(figma, 'diff_apply', {
      patch: `@@ /Card #${card.id}\n-w={200}\n+w={220}\n+width={240}`,
      force
    })
    expect(applied.results?.[0]?.error).toContain('Conflicting attributes for "w"')
    expect(getNodeOrThrow(graph, card.id).width).toBe(200)
  })

  test('uses aliases for default text size and other exported properties', async () => {
    const { graph, figma, card } = setup()
    const label = figma.createText()
    label.fontSize = 14
    const textPatch = expectDefined(
      (
        await run<DiffResult>(figma, 'diff_show', {
          id: label.id,
          attributes: 'fontSize={18} fontFamily="Inter" fontWeight={700}'
        })
      ).diff,
      'text patch'
    )
    await run<ApplyResult>(figma, 'diff_apply', { patch: textPatch })
    expect(getNodeOrThrow(graph, label.id)).toMatchObject({
      fontSize: 18,
      fontFamily: 'Inter',
      fontWeight: 700
    })
    const framePatch = expectDefined(
      (
        await run<DiffResult>(figma, 'diff_show', {
          id: card.id,
          attributes: 'width={240} height={110} backgroundColor="#FF0000"'
        })
      ).diff,
      'frame patch'
    )
    await run<ApplyResult>(figma, 'diff_apply', { patch: framePatch })
    expect(getNodeOrThrow(graph, card.id)).toMatchObject({
      width: 240,
      height: 110
    })
    expect(getNodeOrThrow(graph, card.id).fills[0]?.color).toEqual({
      r: 1,
      g: 0,
      b: 0,
      a: 1
    })
  })

  test('previews attributes without changing the node, as a patch diff_apply applies', async () => {
    const { graph, figma, card } = setup()

    const shown = await run<DiffResult>(figma, 'diff_show', {
      id: card.id,
      attributes: 'bg="#FF0000" w={240} opacity={0.5}'
    })
    const patch = expectDefined(shown.diff, 'patch')
    expect(patch).toBe(
      `@@ /Card #${card.id}\n-bg="#FFFFFF"\n-w={200}\n+bg="#FF0000"\n+w={240}\n+opacity={0.5}`
    )
    expect(getNodeOrThrow(graph, card.id).width).toBe(200)

    await run<ApplyResult>(figma, 'diff_apply', { patch })
    const node = getNodeOrThrow(graph, card.id)
    expect(node.width).toBe(240)
    expect(node.opacity).toBe(0.5)
    expect(node.fills[0]?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  test.each([
    ['w={', 'Invalid JSX attributes'],
    ['opacity={half}', 'half is not defined']
  ])('rejects %p', async (attributes, error) => {
    const { figma, card } = setup()
    const shown = await run<DiffResult>(figma, 'diff_show', {
      id: card.id,
      attributes
    })
    expect(shown.error).toContain(error)
  })
})

describe('diffDocuments', () => {
  test('matches pages by name and nodes by path across documents', () => {
    const before = setup()
    const after = setup()
    after.label.resize(80, 40)
    const extra = after.figma.createEllipse()
    extra.name = 'Dot'

    const result = diffDocuments(before.graph, after.graph)
    expect(result.pages.map((page) => page.status)).toEqual(['changed'])
    const diff = expectDefined(result.diff, 'document diff')
    expect(diff).toContain(`@@ /Page 1/Card/Label #${before.label.id}\n-h={20}\n+h={40}`)
    expect(diff).toContain('@@ /Page 1/Dot added to')
  })

  test('reports identical documents as unchanged', () => {
    const result = diffDocuments(setup().graph, setup().graph)
    expect(result.diff).toBeNull()
    expect(result.changed).toBe(false)
    expect(result.pages.map((page) => page.status)).toEqual(['unchanged'])
  })

  test('reports a page only one document has by status, without a patch', () => {
    const before = setup()
    const after = setup()
    after.graph.addPage('Empty')
    const extra = after.graph.addPage('Extra')
    after.graph.createNode('FRAME', extra.id, { name: 'Card' })

    const result = diffDocuments(before.graph, after.graph)
    expect(result.changed).toBe(true)
    expect(result.diff).toBeNull()
    expect(result.pages.map(({ name, status, diff }) => ({ name, status, diff }))).toEqual([
      { name: 'Page 1', status: 'unchanged', diff: null },
      { name: 'Empty', status: 'added', diff: null },
      { name: 'Extra', status: 'added', diff: null }
    ])
  })
})
