// Map file extensions / basenames to highlight.js language identifiers.
// Returns null for unknown — callers fall back to plain text.

const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  lua: 'lua',
  php: 'php',
  pl: 'perl',
  pm: 'perl',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  json: 'json',
  jsonl: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  mdx: 'markdown',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  env: 'ini',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  vue: 'xml',
  svelte: 'xml',
  r: 'r',
}

const BASENAME_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  rakefile: 'ruby',
  gemfile: 'ruby',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.profile': 'bash',
  '.gitignore': 'bash',
  '.dockerignore': 'bash',
  '.env': 'ini',
  '.editorconfig': 'ini',
}

export function detectLanguage(fileName: string | undefined | null): string | null {
  if (!fileName) return null
  const base = fileName.split('/').pop() ?? fileName
  const lower = base.toLowerCase()
  if (BASENAME_MAP[lower]) return BASENAME_MAP[lower]
  const dotIdx = base.lastIndexOf('.')
  if (dotIdx <= 0) return null
  const ext = base.slice(dotIdx + 1).toLowerCase()
  return EXTENSION_MAP[ext] ?? null
}

export function getBaseName(fileName: string): string {
  return fileName.split('/').pop() ?? fileName
}
