// Valid binary name: alphanumeric, hyphens, dots, underscores — no shell special chars
const VALID_BINARY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Extract the binary/command name from a bash command string, skipping env vars, cd, and shell keywords. */
export function extractBashBinary(cmd: string): string | null {
  // Take first line only (multi-line commands)
  const first = cmd.split('\n')[0].trim()
  const tokens = first.split(/\s+/)
  let skipNext = false
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false
      continue
    }
    // Skip env vars (FOO=bar), shell operators, subshell markers
    if (token.includes('=') || token === '&&' || token === ';' || token === '||') continue
    if (token.startsWith('$(') || token.startsWith('`')) continue
    if (token === 'cd') {
      skipNext = true // skip the directory argument
      continue
    }
    // Skip shell keywords that aren't binaries
    if (
      token === 'for' ||
      token === 'do' ||
      token === 'done' ||
      token === 'if' ||
      token === 'then' ||
      token === 'else' ||
      token === 'fi' ||
      token === 'while' ||
      token === 'case' ||
      token === 'esac'
    )
      continue
    // Strip path prefix to get just the binary name
    const bin = token.replace(/^.*\//, '')
    // Validate: must look like a real binary name
    if (bin && VALID_BINARY_RE.test(bin)) return bin
  }
  return null
}
