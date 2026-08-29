import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const workspaceRoot = resolve(import.meta.dirname, '..')
const manifests = [
  'package.json',
  'apps/desktop/package.json',
  'packages/shared/package.json',
  'packages/schemas/package.json'
]

const lock = JSON.parse(await readFile(resolve(workspaceRoot, 'licenses.lock.json'), 'utf8'))
const approved = new Map(
  lock.dependencies
    .filter((entry) => entry.approved && entry.distribution !== 'excluded')
    .map((entry) => [entry.name, entry])
)
const errors = []

for (const manifestPath of manifests) {
  const manifest = JSON.parse(await readFile(resolve(workspaceRoot, manifestPath), 'utf8'))
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, declaredVersion] of Object.entries(manifest[section] ?? {})) {
      if (String(declaredVersion).startsWith('workspace:')) continue
      if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(String(declaredVersion))) {
        errors.push(`${manifestPath}: ${name} must use an exact version, found ${declaredVersion}`)
        continue
      }
      const record = approved.get(name)
      if (!record) {
        errors.push(`${manifestPath}: ${name}@${declaredVersion} is missing an approved license record`)
      } else if (record.version !== declaredVersion) {
        errors.push(`${manifestPath}: ${name}@${declaredVersion} does not match license lock ${record.version}`)
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`License lock verified: ${approved.size} approved direct dependency records`)
}

