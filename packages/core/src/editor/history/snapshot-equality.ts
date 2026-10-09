import { isEqualWith } from 'es-toolkit'

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  const l = new DataView(left.buffer, left.byteOffset, left.byteLength)
  const r = new DataView(right.buffer, right.byteOffset, right.byteLength)
  let offset = 0
  for (; offset + 4 <= left.byteLength; offset += 4)
    if (l.getUint32(offset) !== r.getUint32(offset)) return false
  for (; offset < left.byteLength; offset++) if (left[offset] !== right[offset]) return false
  return true
}

function byteCustomizer(
  cache?: WeakMap<Uint8Array, WeakMap<Uint8Array, boolean>>
) {
  return (left: unknown, right: unknown): boolean | undefined => {
    if (
      !(left instanceof Uint8Array) ||
      !(right instanceof Uint8Array) ||
      left.constructor !== Uint8Array ||
      right.constructor !== Uint8Array
    )
      return undefined
    if (left === right) return true
    if (left.byteLength !== right.byteLength) return false
    if (!left.byteLength) return true
    // Shared memory can change during this synchronous capture. Exact ordinary
    // view pairs are stable until it returns; offsets/lengths belong to each view.
    if (!cache || !(left.buffer instanceof ArrayBuffer) || !(right.buffer instanceof ArrayBuffer))
      return equalBytes(left, right)
    let pairs = cache.get(left)
    const cached = pairs?.get(right)
    if (cached !== undefined) return cached
    const equal = equalBytes(left, right)
    if (!pairs) {
      pairs = new WeakMap()
      cache.set(left, pairs)
    }
    pairs.set(right, equal)
    return equal
  }
}

const compareBytes = byteCustomizer()

/** Keep deep equality semantics; compare imported binary payloads in four-byte chunks. */
export function equalSnapshotValues(a: unknown, b: unknown): boolean {
  return isEqualWith(a, b, compareBytes)
}

/** Only reuse within one synchronous, read-only capture; never across graph edits. */
export function createSnapshotEquality(): typeof equalSnapshotValues {
  const compare = byteCustomizer(new WeakMap())
  return (a, b) => isEqualWith(a, b, compare)
}
