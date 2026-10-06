import { mockIPC } from '@tauri-apps/api/mocks'

import { installTauriMockWindow } from './mocks'

installTauriMockWindow()

mockIPC((cmd, args) => {
  if (cmd !== 'build_fig_file_binary') throw new Error(`Unexpected command: ${cmd}`)
  if (!(args instanceof Uint8Array)) throw new Error('Expected raw binary IPC')
  if (new TextDecoder().decode(args.subarray(0, 4)) !== 'OPF1') throw new Error('Invalid packet')
  const headerLength = new DataView(args.buffer, args.byteOffset).getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(args.subarray(8, 8 + headerLength)))
  if (header.sizes.slice(0, 3).some((size: number) => size <= 0)) throw new Error('Empty section')
  if (header.images.length !== 1 || header.images[0] !== 'images/test')
    throw new Error('Images missing')
  const expectedLength =
    8 + headerLength + header.sizes.reduce((sum: number, n: number) => sum + n, 0)
  if (args.length !== expectedLength) throw new Error('Invalid packet length')
  if (args.at(-2) !== 123 || args.at(-1) !== 255) throw new Error('Image bytes changed')
  JSON.parse(header.metaJson)
  return new Uint8Array([7, 8, 9]).buffer
})

const [{ exportFigFile }, { SceneGraph }] = await Promise.all([
  import('@open-pencil/core/io/formats/fig/export'),
  import('@open-pencil/scene-graph')
])
const graph = new SceneGraph()
graph.images.set('test', new Uint8Array([0, 123, 255]))
const bytes = await exportFigFile(graph)
if (bytes.length !== 3 || bytes[0] !== 7 || bytes[1] !== 8 || bytes[2] !== 9) {
  throw new Error(`Unexpected export bytes: ${Array.from(bytes).join(',')}`)
}
