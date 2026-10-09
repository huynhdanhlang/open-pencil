import { expect, spyOn, test } from 'bun:test'

import { isEqual } from 'es-toolkit'

import { createSnapshotEquality, equalSnapshotValues } from '#core/editor/history/snapshot-equality'

test('one capture scans aliased byte pairs once; a later capture sees mutation', () => {
  const live = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
  const saved = structuredClone(live)
  const reads = spyOn(DataView.prototype, 'getUint32')
  try {
    const equal = createSnapshotEquality()
    expect(equal({ payload: saved }, { payload: live })).toBe(true)
    const scanned = reads.mock.calls.length
    expect(scanned).toBeGreaterThan(0)
    expect(equal([saved, saved], [live, live])).toBe(true)
    expect(reads.mock.calls.length).toBe(scanned)
    live[8] = 10
    expect(createSnapshotEquality()(saved, live)).toBe(false)
    expect(equalSnapshotValues(saved, live)).toBe(false)
  } finally {
    reads.mockRestore()
  }
})

test('capture byte cache distinguishes views and bypasses concurrently mutable shared memory', () => {
  const equal = createSnapshotEquality()
  const left = new Uint8Array([1, 2, 3, 4, 5])
  const right = new Uint8Array([1, 2, 3, 4, 6])
  expect(equal(left, right)).toBe(false)
  expect(equal(left, right)).toBe(false)
  expect(equal(left.subarray(0, 4), right.subarray(0, 4))).toBe(true)
  expect(equal(left.subarray(1, 4), right.subarray(0, 3))).toBe(false)
  const shared = new Uint8Array(new SharedArrayBuffer(5))
  shared.set(left)
  expect(equal(left, shared)).toBe(true)
  shared[4] = 7
  expect(equal(left, shared)).toBe(false)
})

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
