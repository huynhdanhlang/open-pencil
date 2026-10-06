/** Binary IPC envelope: OPF1, little-endian metadata length, JSON metadata,
 * then schema/kiwi/thumbnail/image byte sections. Never expand bytes to JS numbers. */
export function encodeNativeFigPayload(
  schema: Uint8Array,
  kiwi: Uint8Array,
  thumbnail: Uint8Array,
  metaJson: string,
  images: Array<{ name: string; data: Uint8Array }>,
  figKiwiVersion?: number
): Uint8Array {
  const sections = [schema, kiwi, thumbnail, ...images.map((image) => image.data)]
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      sizes: sections.map((section) => section.byteLength),
      images: images.map((image) => image.name),
      metaJson,
      figKiwiVersion
    })
  )
  const length =
    8 + metadata.byteLength + sections.reduce((sum, section) => sum + section.byteLength, 0)
  if (metadata.byteLength > 1024 * 1024 || length > 512 * 1024 * 1024) {
    throw new RangeError('Native FIG export payload exceeds the 512 MiB transfer limit')
  }
  const payload = new Uint8Array(length)
  payload.set([79, 80, 70, 49]) // OPF1
  new DataView(payload.buffer).setUint32(4, metadata.byteLength, true)
  payload.set(metadata, 8)
  let offset = 8 + metadata.byteLength
  for (const section of sections) {
    payload.set(section, offset)
    offset += section.byteLength
  }
  return payload
}
