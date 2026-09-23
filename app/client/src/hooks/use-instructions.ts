import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type InstructionsWritePayload } from '@/lib/api-client'
import type { InstructionsFile } from '@/types/instructions'

/**
 * The list of instruction stores. Returns the discriminated-union response so
 * the UI can distinguish "disabled" from a real error.
 */
export function useInstructionsStores() {
  return useQuery({
    queryKey: ['instructions', 'stores'],
    queryFn: api.instructions.listStores,
    staleTime: 10_000,
  })
}

export function useInstructionsSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['instructions', 'search', query],
    queryFn: () => api.instructions.search(query),
    enabled,
    staleTime: 5_000,
  })
}

export function useInstructionsFiles(storeId: string | null) {
  return useQuery({
    queryKey: ['instructions', 'files', storeId],
    queryFn: () => api.instructions.listFiles(storeId!),
    enabled: !!storeId,
  })
}

export function useInstructionsFile(storeId: string | null, relPath: string | null) {
  return useQuery({
    queryKey: ['instructions', 'file', storeId, relPath],
    queryFn: () => api.instructions.getFile(storeId!, relPath!),
    enabled: !!storeId && !!relPath,
    retry: false,
  })
}

/** Cross-store link graph — also the source of truth for links/backlinks. */
export function useInstructionsGraph(enabled = true) {
  return useQuery({
    queryKey: ['instructions', 'graph'],
    queryFn: api.instructions.graph,
    enabled,
    staleTime: 10_000,
  })
}

/** What pi sends on every request for this store, per pi home. */
export function useInstructionsContext(storeId: string | null) {
  return useQuery({
    queryKey: ['instructions', 'context', storeId],
    queryFn: () => api.instructions.context(storeId!),
    enabled: !!storeId,
  })
}

/**
 * Refresh everything derived from file contents after a write. A single edit
 * can change counts, token totals, other stores' effective context (ancestor
 * files) and cross-store graph edges, so invalidate the whole family except
 * the file we just set from the response.
 */
function useInstructionsInvalidate() {
  const qc = useQueryClient()
  return () => {
    for (const key of ['stores', 'files', 'graph', 'context', 'search']) {
      qc.invalidateQueries({ queryKey: ['instructions', key] })
    }
  }
}

export function useSaveInstructionsFile(storeId: string | null) {
  const qc = useQueryClient()
  const invalidate = useInstructionsInvalidate()
  return useMutation({
    mutationFn: ({ relPath, payload }: { relPath: string; payload: InstructionsWritePayload }) =>
      api.instructions.saveFile(storeId!, relPath, payload),
    onSuccess: (file: InstructionsFile) => {
      qc.setQueryData(['instructions', 'file', storeId, file.relPath], file)
      invalidate()
    },
  })
}

export function useCreateInstructionsFile(storeId: string | null) {
  const qc = useQueryClient()
  const invalidate = useInstructionsInvalidate()
  return useMutation({
    mutationFn: (payload: { path: string } & InstructionsWritePayload) =>
      api.instructions.createFile(storeId!, payload),
    onSuccess: (file: InstructionsFile) => {
      qc.setQueryData(['instructions', 'file', storeId, file.relPath], file)
      invalidate()
    },
  })
}

export function useDeleteInstructionsFile(storeId: string | null) {
  const qc = useQueryClient()
  const invalidate = useInstructionsInvalidate()
  return useMutation({
    mutationFn: (relPath: string) => api.instructions.deleteFile(storeId!, relPath),
    onSuccess: (_: unknown, relPath: string) => {
      qc.removeQueries({ queryKey: ['instructions', 'file', storeId, relPath] })
      invalidate()
    },
  })
}
