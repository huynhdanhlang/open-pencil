import { expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { buildFontDigestMapFromKeys } from '#core/kiwi/fig/node-change/font/digests'
import { fontManager } from '#core/text/fonts'

test('font digest follows the actual loaded bytes when a face is replaced under the same name', async () => {
  const family = 'Owned digest replacement fixture'
  let data = new TextEncoder().encode('first immutable font buffer').buffer
  const previous = fontManager.loadedData.bind(fontManager)
  const read = spyOn(fontManager, 'loadedData').mockImplementation((name, style) =>
    name === family ? data : previous(name, style)
  )
  const key = `${family}|Regular`
  const expected = () => createHash('sha1').update(new Uint8Array(data)).digest('hex')
  const digest = async () => {
    const result = await buildFontDigestMapFromKeys([key])
    return Buffer.from(result.get(key)!).toString('hex')
  }
  try {
    const first = await digest()
    expect(first).toEqual(expected())
    data = new TextEncoder().encode('second immutable font buffer').buffer
    const second = await digest()
    expect(second).toEqual(expected())
    expect(second).not.toEqual(first)
    expect(await digest()).toEqual(second)
  } finally {
    read.mockRestore()
  }
})

test('a failed font digest is reported and does not poison a later retry', async () => {
  const family = 'Owned digest retry fixture'
  const data = new TextEncoder().encode('immutable retry bytes').buffer
  const previous = fontManager.loadedData.bind(fontManager)
  const read = spyOn(fontManager, 'loadedData').mockImplementation((name, style) =>
    name === family ? data : previous(name, style)
  )
  const digest = spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(
    new Error('Owned hash failure')
  )
  const key = `${family}|Regular`
  try {
    await expect(buildFontDigestMapFromKeys([key])).rejects.toThrow('Owned hash failure')
    digest.mockRestore()
    const retried = await buildFontDigestMapFromKeys([key])
    expect(Buffer.from(retried.get(key)!).toString('hex')).toEqual(
      createHash('sha1').update(new Uint8Array(data)).digest('hex')
    )
  } finally {
    digest.mockRestore()
    read.mockRestore()
  }
})
