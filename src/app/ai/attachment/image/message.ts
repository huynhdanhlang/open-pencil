import type { FileUIPart } from 'ai'
import { fromUint8Array } from 'js-base64'

import type { PreparedImageAttachment } from './types'

export function preparedImageFiles(images: PreparedImageAttachment[]): FileUIPart[] {
  return images.map(({ data, mediaType }) => ({
    type: 'file',
    mediaType,
    url: `data:${mediaType};base64,${fromUint8Array(data)}`
  }))
}
