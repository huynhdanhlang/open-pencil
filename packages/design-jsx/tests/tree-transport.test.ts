import { expect, test } from 'bun:test'

import {
  decodeTreeFromTransport,
  designVar,
  encodeTreeForTransport,
  isVariable,
  node
} from '#design-jsx/index'
import * as v from 'valibot'

function wire(value: unknown): unknown {
  return v.parse(v.pipe(v.string(), v.parseJson(), v.unknown()), JSON.stringify(value))
}

test('transport restores only branded variables recursively and preserves ordinary data', () => {
  const plain = { id: 'plain', name: 'Plain', value: 0 }
  const tree = node('frame', {
    w: designVar('Width', 0),
    style: { fills: [{ color: designVar({ name: 'Canvas', value: { r: 0, g: 0, b: 0, a: 1 } }) }] },
    bind: { width: designVar({ id: '0:42' }) },
    plain,
    children: [node('text', { color: designVar('Canvas'), children: 'Text' })]
  })
  tree.source = { line: 3 }
  const decoded = decodeTreeFromTransport(wire(encodeTreeForTransport(tree)))
  expect(isVariable(decoded.props.w)).toBe(true)
  expect(decoded.props.w).toMatchObject({ id: 'Width', name: 'Width', value: 0 })
  expect(isVariable(decoded.props.plain)).toBe(false)
  expect(decoded.props.plain).toEqual(plain)
  expect(decoded).toEqual(tree)
  expect(decoded.props).not.toBe(tree.props)
  expect(isVariable(tree.props.w)).toBe(true)
})

test('transport rejects malformed tags and reserved-key collisions', () => {
  for (const tag of [
    { version: 2, name: 'Canvas' },
    { version: 1, name: 1 },
    { version: 1, name: 'Canvas', value: { r: 0 } }
  ]) {
    expect(() =>
      decodeTreeFromTransport(node('frame', { w: { '$openpencil.variable': tag } }))
    ).toThrow('variable')
  }
  expect(() =>
    encodeTreeForTransport(
      node('frame', { w: { '$openpencil.variable': { version: 1, name: 'Fake' } } })
    )
  ).toThrow('reserved')
  expect(() => decodeTreeFromTransport({ type: 'frame', props: {}, children: [42] })).toThrow(
    'tree'
  )
})
