import { expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile } from '@open-pencil/core'
import { SceneGraph } from '@open-pencil/scene-graph'

test('local preferred candidates follow exported IDs through two fresh saves; external keys stay intact', async () => {
  await initCodec()
  let serial = 0
  let graph = new SceneGraph(() => `local-${++serial}`)
  const page = graph.getPages()[0]
  const internal = graph.createNode('CANVAS', graph.rootId, {
    name: 'Internal',
    internalOnly: true
  })
  const draft = graph.createNode('COMPONENT', internal.id, { name: 'Draft' })
  const unknown = graph.createNode('COMPONENT', internal.id, { name: 'Unknown' })
  const keyed = graph.createNode('COMPONENT', internal.id, {
    name: 'Keyed',
    componentKey: 'stable-component-key'
  })
  graph.createNode('COMPONENT', page.id, {
    name: 'Host',
    componentPropertyDefinitions: [
      {
        id: 'swap',
        name: 'Opener',
        type: 'INSTANCE_SWAP',
        defaultValue: draft.id,
        preferredValues: [draft.id, unknown.id, keyed.id, 'external-key', '70:999']
      },
      {
        id: 'slot',
        name: 'Content',
        type: 'SLOT',
        defaultValue: '',
        preferredValues: [unknown.id, 'external-slot-key']
      }
    ]
  })
  for (let generation = 0; generation < 2; generation++) {
    graph = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    const host = [...graph.nodes.values()].find((node) => node.name === 'Host')
    if (!host) throw new Error('Host missing')
    const nodes = [...graph.nodes.values()]
    const find = (name: string) => {
      const node = nodes.find((node) => node.name === name)
      if (!node) throw new Error(`Candidate ${name} missing`)
      return node.id
    }
    expect(host.componentPropertyDefinitions[0]).toMatchObject({
      defaultValue: find('Draft'),
      preferredValues: [
        find('Draft'),
        find('Unknown'),
        'stable-component-key',
        'external-key',
        '70:999'
      ]
    })
    expect(find('Keyed')).toBeString()
    expect(host.componentPropertyDefinitions[1]?.preferredValues).toEqual([
      find('Unknown'),
      'external-slot-key'
    ])
    graph.createNode('RECTANGLE', graph.getPages()[0].id, { name: `Force writer ${generation}` })
  }
})
