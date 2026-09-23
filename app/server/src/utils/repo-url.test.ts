import { describe, expect, test } from 'vitest'
import { stripRepoUrlCredentials } from './repo-url'

describe('stripRepoUrlCredentials', () => {
  test('drops a token or user:password from an http(s) remote', () => {
    expect(stripRepoUrlCredentials('https://ghp_abc123@github.com/me/repo.git')).toBe(
      'https://github.com/me/repo.git',
    )
    expect(stripRepoUrlCredentials('https://me:s3cret@gitlab.com/me/repo')).toBe(
      'https://gitlab.com/me/repo',
    )
    expect(stripRepoUrlCredentials('http://oauth2:tok@host:8080/r.git')).toBe(
      'http://host:8080/r.git',
    )
  })

  test('keeps an ssh user name but never a password', () => {
    expect(stripRepoUrlCredentials('ssh://git@github.com/me/repo.git')).toBe(
      'ssh://git@github.com/me/repo.git',
    )
    expect(stripRepoUrlCredentials('ssh://git:pw@host/repo.git')).toBe('ssh://git@host/repo.git')
  })

  test('leaves scp-style and local remotes alone', () => {
    expect(stripRepoUrlCredentials('git@github.com:me/repo.git')).toBe('git@github.com:me/repo.git')
    expect(stripRepoUrlCredentials('/srv/git/repo.git')).toBe('/srv/git/repo.git')
    expect(stripRepoUrlCredentials('file:///srv/git/repo.git')).toBe('file:///srv/git/repo.git')
  })

  test('passes clean URLs and null through', () => {
    expect(stripRepoUrlCredentials('https://github.com/me/repo.git')).toBe(
      'https://github.com/me/repo.git',
    )
    expect(stripRepoUrlCredentials(null)).toBeNull()
  })
})
