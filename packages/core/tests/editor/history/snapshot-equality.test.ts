import { expect, test } from 'bun:test'

import { isEqual } from 'es-toolkit'

import { equalSnapshotValues } from '#core/editor/history/snapshot-equality'

test('snapshot byte comparison respects offsets, lengths and trailing bytes', () => {
  const bytes = new Uint8Array([99, 1, 2, 3, 4, 5, 88])
  const view = bytes.subarray(1, 6)
  expect(equalSnapshotValues({ payload: view }, { payload: new Uint8Array([1, 2, 3, 4, 5]) })).toBe(
    true
  )
  expect(equalSnapshotValues(view, new Uint8Array([1, 2, 3, 4, 6]))).toBe(false)
  expect(equalSnapshotValues(view, new Uint8Array([1, 2, 3, 4]))).toBe(false)
  expect(equalSnapshotValues(new Uint8Array(), new Uint8Array())).toBe(true)
  bytes[3] = 9
  expect(equalSnapshotValues(view, new Uint8Array([1, 2, 3, 4, 5]))).toBe(false)
})

test('non-byte values retain existing deep equality semantics', () => {
  const pairs: [unknown, unknown][] = [
    [new Float32Array([NaN, -0]), new Float32Array([NaN, 0])],
    [new Uint8Array([1]), new Uint8ClampedArray([1])],
    [new Set([1, 2]), new Set([2, 1])],
    [new Map([['a', { name: 'A' }]]), new Map([['a', { name: 'A' }]])],
    [{ value: undefined }, {}],
    [new Uint8Array([1]), new Int8Array([1])]
  ]
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  const other: Record<string, unknown> = {}
  other.self = other
  pairs.push([cycle, other])
  for (const [a, b] of pairs) expect(equalSnapshotValues(a, b)).toBe(isEqual(a, b))
})
