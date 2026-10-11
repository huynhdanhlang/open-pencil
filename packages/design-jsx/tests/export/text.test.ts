import { describe, expect, test } from 'bun:test'

import { sceneNodeToJSX } from '#design-jsx/index'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { colorToFill } from '@open-pencil/scene-graph/color'

function exportText(fields: Partial<SceneNode>): string {
  const graph = new SceneGraph()
  const node = graph.createNode('TEXT', graph.getPages()[0].id, {
    name: 'Note',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    fills: [],
    ...fields
  })
  return sceneNodeToJSX(node.id, graph)
}

describe('rich text export', () => {
  test('writes styled characters as spans with only what differs', () => {
    const code = exportText({
      text: 'Hello world!',
      fontWeight: 700,
      styleRuns: [
        { start: 6, length: 5, style: { fontWeight: 700, fills: [colorToFill('#EE2222')] } }
      ]
    })
    expect(code).toBe(
      '<Text name="Note" weight="bold">Hello <Span color="#EE2222">world</Span>!</Text>'
    )
  })

  test('writes every character style under its Text prop name', () => {
    const code = exportText({
      text: 'ab',
      styleRuns: [
        {
          start: 0,
          length: 1,
          style: {
            fontSize: 20,
            fontFamily: 'Roboto',
            fontWeight: 500,
            italic: true,
            lineHeight: 30,
            letterSpacing: 1,
            textDecoration: 'STRIKETHROUGH'
          }
        },
        { start: 1, length: 1, style: { italic: false } }
      ]
    })
    expect(code).toBe(
      '<Text name="Note"><Span size={20} font="Roboto" weight="medium" italic lineHeight={30} letterSpacing={1} textDecoration="strikethrough">a</Span>b</Text>'
    )
  })

  test('writes paragraphs when one is a list item or spaced', () => {
    const code = exportText({
      text: 'Intro\nFirst\nNested',
      textParagraphs: [
        { listType: 'NONE', indentation: 0, paragraphSpacing: 12 },
        { listType: 'ORDERED', indentation: 1 },
        { listType: 'ORDERED', indentation: 2, listSpacing: 4, paragraphIndent: 8 }
      ],
      styleRuns: [{ start: 6, length: 5, style: { fontWeight: 700 } }]
    })
    expect(code).toBe(`<Text name="Note">
  <Paragraph spacing={12}>Intro</Paragraph>
  <Paragraph list="ordered"><Span weight="bold">First</Span></Paragraph>
  <Paragraph list="ordered" level={2} listSpacing={4} indent={8}>Nested</Paragraph>
</Text>`)
  })

  test('keeps spaces and syntax characters next to spans', () => {
    const code = exportText({
      text: ' a {b} ',
      styleRuns: [{ start: 1, length: 1, style: { fontWeight: 700 } }]
    })
    expect(code).toBe('<Text name="Note"> <Span weight="bold">a</Span>{" {b} "}</Text>')
  })

  test('writes plain text as before', () => {
    const code = exportText({
      text: 'One\nTwo',
      textParagraphs: [{ listType: 'NONE', indentation: 0 }],
      styleRuns: [{ start: 0, length: 3, style: { fontWeight: 400 } }]
    })
    expect(code).toBe('<Text name="Note">{"One\\nTwo"}</Text>')
  })
})
