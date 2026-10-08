import type { Image } from 'canvaskit-wasm'

import { ResourceCache } from '#core/cache/resource'

export const IMAGE_CACHE_BYTES = 128 * 1024 * 1024

/** Own decoded images, including an estimate for their mipmaps. Pictures may retain references. */
export function createImageCache<T extends Pick<Image, 'width' | 'height' | 'delete'> = Image>(
  maxBytes = IMAGE_CACHE_BYTES
) {
  return new ResourceCache<string, T>({
    maxEntries: 256,
    maxWeight: maxBytes,
    // Conservative RGBA plus mipmaps bound, including thin 1×N images.
    weight: (image) => image.width() * image.height() * 8,
    dispose: (image) => image.delete()
  })
}
