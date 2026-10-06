import { expect, test } from 'bun:test'

import { guid } from '#fig-tests/helpers/guid'
import { componentDependencies } from '#fig/document/component/dependencies'
import { linkComponentPropertyValues } from '#fig/document/component/values'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

test('native preferred reference remapping preserves actual asset keys even when shaped like a source ID', () => {
  const graph = new SceneGraph()
  const node = graph.createNode('COMPONENT', graph.getPages()[0].id, {
    componentPropertyDefinitions: [
      {
        id: 'swap',
        name: 'Opener',
        type: 'INSTANCE_SWAP',
        defaultValue: '1:7',
        preferredValues: ['1:5', '1:7', 'external']
      }
    ]
  })
  linkComponentPropertyValues(
    graph,
    new Map([
      ['1:5', 'local-five'],
      ['1:7', 'local-seven']
    ]),
    [node],
    undefined,
    (key) => key === '1:5'
  )
  expect(node.componentPropertyDefinitions[0]).toMatchObject({
    defaultValue: 'local-seven',
    preferredValues: ['1:5', 'local-seven', 'external']
  })
})

test('collects component dependencies from instances, inactive defaults and nested assignments', () => {
  const source = {
    symbolData: {
      symbolID: guid(1),
      symbolOverrides: [
        {
          overriddenSymbolID: guid(2),
          componentPropAssignments: [
            { defID: guid(90), varValue: { value: { symbolIdValue: { guid: guid(3) } } } }
          ]
        }
      ]
    },
    componentPropDefs: [
      { type: 'INSTANCE_SWAP', initialValue: { guidValue: guid(4) } },
      { type: 'TEXT', initialValue: { textValue: '1:999' } }
    ],
    componentPropAssignments: [{ defID: guid(91), value: { guidValue: guid(1) } }]
  } as NodeChange
  const before = structuredClone(source)
  expect([...componentDependencies(source)].sort()).toEqual(['1:1', '1:2', '1:3', '1:4'])
  expect(source).toEqual(before)
})
