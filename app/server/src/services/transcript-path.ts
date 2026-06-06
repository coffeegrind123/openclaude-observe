export interface BindMountBase {
  host: string
  container: string
}

/**
 * Translate a host-side transcript path into the path the server can
 * read inside its runtime. In docker mode with the transcript-stats
 * feature enabled we bind-mount the host's Claude session dir into the
 * container (e.g. `~/.claude/projects` → `/host/.claude/projects`). The
 * transcript_path stored in the DB is always the host path; this helper
 * rewrites it for the container.
 *
 * Trailing-slash precision matters: a path equal to the base or one
 * that starts with `${base}/` is translated; everything else passes
 * through. This rejects e.g. `/Users/joe/.claude/projects-other`
 * from matching `/Users/joe/.claude/projects`.
 *
 * A null/empty base (local mode, or one side unset) short-circuits to
 * the identity function.
 */
export function resolveTranscriptPath(hostPath: string, base: BindMountBase | null): string {
  if (!base || !base.host || !base.container) return hostPath
  const { host, container } = base
  if (hostPath === host) return container
  if (hostPath.startsWith(host + '/')) {
    return container + hostPath.slice(host.length)
  }
  return hostPath
}
