import { expect, test } from 'bun:test'

import { guid } from '#fig-tests/helpers/guid'
import { interpretInstance } from '#fig/instance-overrides/interpret'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

for (const ownPositioning of [undefined, 'AUTO', 'ABSOLUTE'] as const) {
  test(`instance placement belongs to its own record: ${ownPositioning ?? 'omitted AUTO'}`, () => {
    const records = [
      { guid: guid(1), type: 'SYMBOL', stackPositioning: 'ABSOLUTE' },
      {
        guid: guid(2),
        type: 'INSTANCE',
        stackPositioning: ownPositioning,
        symbolData: { symbolID: guid(1) }
      }
    ] as NodeChange[]
    expect(interpretInstance(records, '1:2').properties.stackPositioning).toBe(
      ownPositioning ?? 'AUTO'
    )
  })
}

test('explicit root positioning override still wins over omitted placed AUTO', () => {
  const records = [
    { guid: guid(1), type: 'SYMBOL', stackPositioning: 'ABSOLUTE' },
    {
      guid: guid(2),
      type: 'INSTANCE',
      symbolData: {
        symbolID: guid(1),
        symbolOverrides: [{ guidPath: { guids: [guid(1)] }, stackPositioning: 'ABSOLUTE' }]
      }
    }
  ] as NodeChange[]
  expect(interpretInstance(records, '1:2').properties.stackPositioning).toBe('ABSOLUTE')
})
