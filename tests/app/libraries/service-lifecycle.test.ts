import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session/create'
import { useLibraryService } from '@/app/libraries/service'

const insertion = { libraryId: 'lifecycle-probe', assetKey: 'component', x: 0, y: 0 }

test('document disposal releases its library binding and rejects late binding without clearing another document', async () => {
  const closed = createEditorStore()
  const other = createEditorStore()
  const service = useLibraryService()
  service.bindEditor(closed)
  try {
    closed.dispose()
    await expect(service.insertComponent(insertion)).rejects.toThrow('No active editor')
    service.bindEditor(closed)
    await service.refresh(closed)
    await expect(service.insertComponent(insertion)).rejects.toThrow('No active editor')
    service.bindEditor(other)
    closed.dispose()
    await expect(service.insertComponent(insertion)).rejects.toThrow(
      'Library is not enabled: lifecycle-probe'
    )
  } finally {
    other.dispose()
  }
})
