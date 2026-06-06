import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { MemoryFile } from '@/types/memory'

/**
 * The list of memory stores. Returns the discriminated-union response so the
 * UI can distinguish "disabled / not configured" from a real error.
 */
export function useMemoryStores() {
  return useQuery({
    queryKey: ['memory', 'stores'],
    queryFn: api.memory.listStores,
    staleTime: 10_000,
  })
}

export function useMemorySearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['memory', 'search', query],
    queryFn: () => api.memory.search(query),
    enabled,
    staleTime: 5_000,
  })
}

export function useMemoryFiles(storeId: string | null) {
  return useQuery({
    queryKey: ['memory', 'files', storeId],
    queryFn: () => api.memory.listFiles(storeId!),
    enabled: !!storeId,
  })
}

export function useMemoryFile(storeId: string | null, relPath: string | null) {
  return useQuery({
    queryKey: ['memory', 'file', storeId, relPath],
    queryFn: () => api.memory.getFile(storeId!, relPath!),
    enabled: !!storeId && !!relPath,
  })
}

type SavePayload =
  | { content: string }
  | { frontmatter: Record<string, unknown> | null; body: string }

/** Invalidate the file list + store list so counts/mtimes refresh after a write. */
function useMemoryInvalidate(storeId: string | null) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['memory', 'files', storeId] })
    qc.invalidateQueries({ queryKey: ['memory', 'stores'] })
  }
}

export function useSaveMemoryFile(storeId: string | null) {
  const qc = useQueryClient()
  const invalidate = useMemoryInvalidate(storeId)
  return useMutation({
    mutationFn: ({ relPath, payload }: { relPath: string; payload: SavePayload }) =>
      api.memory.saveFile(storeId!, relPath, payload),
    onSuccess: (file: MemoryFile) => {
      qc.setQueryData(['memory', 'file', storeId, file.relPath], file)
      invalidate()
    },
  })
}

export function useCreateMemoryFile(storeId: string | null) {
  const qc = useQueryClient()
  const invalidate = useMemoryInvalidate(storeId)
  return useMutation({
    mutationFn: (payload: { name: string } & SavePayload) =>
      api.memory.createFile(storeId!, payload),
    onSuccess: (file: MemoryFile) => {
      qc.setQueryData(['memory', 'file', storeId, file.relPath], file)
      invalidate()
    },
  })
}

export function useDeleteMemoryFile(storeId: string | null) {
  const invalidate = useMemoryInvalidate(storeId)
  return useMutation({
    mutationFn: (relPath: string) => api.memory.deleteFile(storeId!, relPath),
    onSuccess: invalidate,
  })
}
