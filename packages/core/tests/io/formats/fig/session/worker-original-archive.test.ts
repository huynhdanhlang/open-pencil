import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { exportFigFile } from '@open-pencil/core/io'
import { initCodec } from '@open-pencil/core/kiwi'
import { SceneGraph } from '@open-pencil/scene-graph'

import { parseFigFileViaWorker } from '#core/io/formats/fig/read'
import {
  createFigPopulationWorker,
  releaseFigPopulationWorker
} from '#core/kiwi/fig/population/client'

test('saving an unedited worker-opened .fig returns its original bytes', async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'First' })
  source.createNode('TEXT', source.addPage('Second').id, { text: 'Second' })
  const bytes = await exportFigFile(source)

  const opened = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    expect(Buffer.from(await exportFigFile(opened)).equals(bytes)).toBe(true)
  } finally {
    releaseFigPopulationWorker(opened)
  }
}, 20000)

test('populating another imported page and deriving layout preserves the original archive fast path', async () => {
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'First' })
  source.createNode('TEXT', source.addPage('Second').id, { text: 'Second' })
  const bytes = await exportFigFile(source)
  const opened = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    const client = expectDefined(createFigPopulationWorker(opened))
    expect(await client.populate(opened.getPages()[1].id)).toBe(true)
    opened.withLayoutMutations(() => opened.updateNode(opened.getPages()[0].id, { width: 12 }))
    expect(Buffer.from(await exportFigFile(opened)).equals(bytes)).toBe(true)
  } finally {
    releaseFigPopulationWorker(opened)
  }
}, 20000)

test('worker retirement preserves the opening archive when the caller reuses its input buffer', async () => {
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'First' })
  source.createNode('TEXT', source.addPage('Second').id, { text: 'Second' })
  const bytes = await exportFigFile(source)
  const input = bytes.slice().buffer
  const pending = parseFigFileViaWorker(input, { populate: 'first-page' })
  new Uint8Array(input).fill(0)
  const opened = await pending
  try {
    const client = expectDefined(createFigPopulationWorker(opened))
    expect(await client.populate(opened.getPages()[1].id)).toBe(true)
    expect(Buffer.from(await exportFigFile(opened)).equals(bytes)).toBe(true)
  } finally {
    releaseFigPopulationWorker(opened)
  }
}, 20000)
