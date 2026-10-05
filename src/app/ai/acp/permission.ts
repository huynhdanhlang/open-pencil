import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import { computed, shallowRef } from 'vue'

import { ACP_PERMISSION_TIMEOUT_MS } from '@/constants'

export interface PendingPermission {
  request: RequestPermissionRequest
  resolve: (response: RequestPermissionResponse) => void
  timer: ReturnType<typeof setTimeout>
  onRemove?: () => void
}

export function permissionWithToolContext(
  request: RequestPermissionRequest,
  known?: RequestPermissionRequest['toolCall']
): RequestPermissionRequest {
  return {
    ...request,
    toolCall: {
      ...request.toolCall,
      title: request.toolCall.title ?? known?.title,
      rawInput: request.toolCall.rawInput ?? known?.rawInput
    }
  }
}

export const permissionQueue = shallowRef<PendingPermission[]>([])
export const currentPermission = computed(() => permissionQueue.value[0] ?? null)

function rejection(request: RequestPermissionRequest): RequestPermissionResponse {
  const reject = request.options.find((o) => o.kind.startsWith('reject'))
  return reject
    ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
    : { outcome: { outcome: 'cancelled' } }
}

function removeEntry(entry: PendingPermission) {
  clearTimeout(entry.timer)
  entry.onRemove?.()
  permissionQueue.value = permissionQueue.value.filter((e) => e !== entry)
}

export function requestPermissionFromUser(
  params: RequestPermissionRequest,
  signal?: AbortSignal
): Promise<RequestPermissionResponse> {
  if (signal?.aborted) return Promise.resolve({ outcome: { outcome: 'cancelled' } })
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      removeEntry(entry)
      resolve(rejection(params))
    }, ACP_PERMISSION_TIMEOUT_MS)

    const onAbort = () => {
      removeEntry(entry)
      resolve({ outcome: { outcome: 'cancelled' } })
    }
    const entry: PendingPermission = {
      request: params,
      resolve,
      timer,
      onRemove: () => signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    permissionQueue.value = [...permissionQueue.value, entry]
  })
}

export function respondToPermission(optionId: string) {
  const entry = permissionQueue.value.at(0)
  if (!entry) return
  removeEntry(entry)
  entry.resolve({ outcome: { outcome: 'selected', optionId } })
}

export function rejectCurrentPermission() {
  const entry = permissionQueue.value.at(0)
  if (!entry) return
  removeEntry(entry)
  entry.resolve(rejection(entry.request))
}
