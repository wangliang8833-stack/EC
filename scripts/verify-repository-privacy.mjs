import { execFileSync } from 'node:child_process'

// Inspect the exact index contents, including force-added files. Never print matched values.
const git = (...args) => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 })
const files = git('ls-files', '-z').toString('utf8').split('\0').filter(Boolean)
const errors = []
const imagePaths = new Set(['icon.png', 'apps/desktop/resources/icon.png', 'apps/desktop/src/renderer/public/icon.png'])
const safeRootMarkdown = new Set(['README.md', 'THIRD_PARTY_NOTICES.md'])
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['provider access token', /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})/],
  ['credential-bearing URL', /https?:\/\/[^\s/:]{2,}:[^\s/@]{2,}@/],
  ['merchant name literal', /[\u4e00-\u9fffA-Za-z]{2,18}(?:旗舰店|专营店|专卖店|官方店)/g]
]
for (const path of files) {
  if (/^(?:docs\/|artifacts\/|output\/|dist\/|research-references\/|apps\/desktop\/prototypes\/)/.test(path)
    || (/^[^/]+\.md$/.test(path) && !safeRootMarkdown.has(path)) || /^[^/]+\.html$/.test(path)
    || /(?:^|\/)(?:Credential Vault|profiles|app-data|exports|screenshots)\//i.test(path)
    || /(?:^|\/)config\/accounts\//.test(path) || /(?:^|\/)data\/(?:raw|normalized|aggregate|report-datasets)\//.test(path)
    || /\.(?:rar|zip|7z|tar|gz|bak|bin|sqlite\w*|db|exe|asar|pdf|docx?|xlsx?)$/i.test(path)
    || /(?:^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('.env.example')) {
    errors.push(`${path}: local-only or sensitive file category`)
    continue
  }
  const buffer = git('show', `:${path}`)
  if (buffer.includes(0) || /\.(?:png|jpe?g|gif|webp)$/i.test(path)) {
    if (!imagePaths.has(path)) errors.push(`${path}: unreviewed binary asset`)
    continue
  }
  const content = buffer.toString('utf8')
  for (const [name, pattern] of rules) {
    for (const match of content.matchAll(new RegExp(pattern.source, 'g'))) {
      if (name === 'merchant name literal' && /测试|示例/.test(match[0])) continue
      // A deliberate negative URL parser test, with fixed dummy credentials.
      if (name === 'credential-bearing URL' && path.endsWith('/navigation-policy.test.ts') && match[0].endsWith('//user:pass@')) continue
      errors.push(`${path}:${content.slice(0, match.index).split('\n').length}: ${name}`)
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else console.log(`Repository privacy checks passed: ${files.length} indexed files; no restricted artifacts or recognized secret patterns.`)
