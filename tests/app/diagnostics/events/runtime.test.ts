import 'fake-indexeddb/auto'
import { beforeEach, expect, test } from 'bun:test'

import { diagnostics } from '@/app/diagnostics'
import { recordRuntimeError } from '@/app/diagnostics/events/runtime'

beforeEach(async () => {
  await diagnostics.clear()
})

test('records an uncaught error with its details', async () => {
  const error = new TypeError('Attempting to define property on object that is not extensible.')
  recordRuntimeError(error, 'vue', 'render function')

  const [event] = await diagnostics.list()
  expect(event).toMatchObject({
    category: 'runtime',
    level: 'error',
    name: 'runtime.error',
    attributes: {
      source: 'vue',
      errorName: 'TypeError',
      message: 'Attempting to define property on object that is not extensible.',
      info: 'render function'
    }
  })
  expect(event.attributes.stack).toContain('TypeError')
})

test('records one of a burst of identical errors, and each distinct one', async () => {
  const error = new Error('loop')
  for (let i = 0; i < 5; i++) recordRuntimeError(error, 'window')
  recordRuntimeError(new Error('other'), 'window')

  const events = await diagnostics.list()
  expect(events.map((event) => event.attributes.message)).toEqual(['other', 'loop'])
})
