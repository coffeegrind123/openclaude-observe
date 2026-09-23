// Which transcript files the server is willing to read.
//
// transcript_path is supplied by whoever posts to /api/events, and the
// transcript-stats route reads that file — while the docker setup mounts
// whole pi homes. So a path is only honoured when it is a .jsonl file inside
// `<home>/.pi/agent/sessions/` of a configured pi home, after resolving `..`
// and symlinks. pi homes are mounted at the same absolute path pi uses, so
// there is no host/container translation to do.

import { promises as fs } from 'node:fs'
import path from 'node:path'

export const SESSIONS_SUBDIR = path.join('.pi', 'agent', 'sessions')

function inside(child: string, parent: string): boolean {
  return child.startsWith(parent + path.sep)
}

async function realOrSelf(p: string): Promise<string> {
  try {
    return await fs.realpath(p)
  } catch {
    // Missing file: resolve the directory instead, so a symlinked parent
    // still can't smuggle a path out.
    try {
      return path.join(await fs.realpath(path.dirname(p)), path.basename(p))
    } catch {
      return p
    }
  }
}

/**
 * The readable path for a pi session transcript, or null when the path is not
 * one the server may read.
 */
export async function resolvePiTranscript(
  transcriptPath: string,
  homes: string[],
): Promise<string | null> {
  if (
    !path.isAbsolute(transcriptPath) ||
    !transcriptPath.endsWith('.jsonl') ||
    transcriptPath.includes('\0')
  ) {
    return null
  }
  const requested = path.resolve(transcriptPath)
  const real = await realOrSelf(requested)

  for (const home of homes) {
    const sessionsDir = path.join(path.resolve(home), SESSIONS_SUBDIR)
    const realSessionsDir = await realOrSelf(sessionsDir)
    if (inside(requested, sessionsDir) && inside(real, realSessionsDir)) {
      return requested
    }
  }
  return null
}
