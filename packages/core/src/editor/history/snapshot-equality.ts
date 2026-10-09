import { isEqualWith } from 'es-toolkit'

/** Keep deep equality semantics; compare imported binary payloads in four-byte chunks. */
export function equalSnapshotValues(a: unknown, b: unknown): boolean {
  return isEqualWith(a, b, (left, right) => {
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
    const l = new DataView(left.buffer, left.byteOffset, left.byteLength)
    const r = new DataView(right.buffer, right.byteOffset, right.byteLength)
    let offset = 0
    for (; offset + 4 <= left.byteLength; offset += 4)
      if (l.getUint32(offset) !== r.getUint32(offset)) return false
    for (; offset < left.byteLength; offset++) if (left[offset] !== right[offset]) return false
    return true
  })
}
