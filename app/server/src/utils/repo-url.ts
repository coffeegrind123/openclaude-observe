// Git remotes can embed credentials (`https://<token>@github.com/...`), and a
// session's metadata is served unauthenticated to every dashboard viewer.

const HTTP_SCHEMES = new Set(['http:', 'https:'])

/**
 * Remove credentials from a git remote URL.
 *
 * http(s): the whole userinfo goes, since a token is often the user name.
 * Other URL schemes (ssh://git@host/...): the user name is routing, not a
 * secret, so only a password goes. scp-style (`git@host:path`) and local paths
 * carry no password and are returned unchanged.
 */
export function stripRepoUrlCredentials(url: string | null): string | null {
  if (url === null) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (!parsed.username && !parsed.password) {
    return url
  }
  parsed.password = ''
  if (HTTP_SCHEMES.has(parsed.protocol)) {
    parsed.username = ''
  }
  return parsed.toString()
}
