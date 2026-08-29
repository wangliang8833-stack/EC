import { appendFile, copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const dataRoot = resolve(readOption('--data-root') ?? '')
const mappings = args.filter((value) => value.startsWith('--map=')).map(parseMapping)

if (!readOption('--data-root') || mappings.length === 0) {
  throw new Error('Usage: node scripts/migrate-shop-identifiers.mjs --data-root=<absolute-path> --map=<old>=<new> [--map=...] [--apply]')
}
if (new Set(mappings.map(({ from }) => from)).size !== mappings.length || new Set(mappings.map(({ to }) => to)).size !== mappings.length) {
  throw new Error('Migration mappings must have unique source and destination identifiers')
}
for (const { from, to } of mappings) {
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(from) || !/^[TPJADKQ]\d{4}$/.test(to)) throw new Error(`Invalid mapping ${from} -> ${to}`)
}

const scanRoots = [join(dataRoot, 'config'), join(dataRoot, 'data')]
const files = (await Promise.all(scanRoots.map(walkFiles))).flat().filter(isJsonArtifact)
const directories = (await walkDirectories(join(dataRoot, 'data')))
  .filter((path) => mappings.some(({ from }) => basename(path) === from))
  .sort((left, right) => right.length - left.length)

const rewritten = []
for (const path of files) {
  const originalText = await readFile(path, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(originalText)
  } catch (error) {
    throw new Error(`JSON artifact cannot be parsed: ${path}`, { cause: error })
  }
  const updated = rewriteJson(parsed)
  const updatedText = `${JSON.stringify(updated, null, 2)}\n`
  if (updatedText !== originalText && mappings.some(({ from }) => originalText.includes(from))) {
    rewritten.push({ path, originalText, updatedText })
  }
}

for (const path of directories) {
  const mapping = mappings.find(({ from }) => basename(path) === from)
  const destination = join(dirname(path), mapping.to)
  if (await exists(destination)) throw new Error(`Migration destination already exists: ${destination}`)
}

const summary = {
  mode: apply ? 'apply' : 'dry-run',
  dataRoot,
  mappings,
  rewrittenFiles: rewritten.length,
  renamedDirectories: directories.length
}

if (!apply) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  process.exit(0)
}

const migrationId = `shop-id-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}`
const migrationRoot = join(dataRoot, 'migrations', migrationId)
const backupRoot = join(migrationRoot, 'backup')
await mkdir(backupRoot, { recursive: true })

const fileRecords = []
for (const item of rewritten) {
  const relativePath = relative(dataRoot, item.path)
  const backupPath = join(backupRoot, relativePath)
  await mkdir(dirname(backupPath), { recursive: true })
  await copyFile(item.path, backupPath)
  fileRecords.push({
    path: slash(relativePath),
    beforeSha256: sha256(item.originalText),
    afterSha256: sha256(item.updatedText)
  })
}

const startedAt = new Date().toISOString()
const manifestPath = join(migrationRoot, 'manifest.json')
await writeFile(manifestPath, `${JSON.stringify({ schemaVersion: '1.0.0', migrationId, status: 'backed_up', startedAt, ...summary, files: fileRecords, directories: [] }, null, 2)}\n`, 'utf8')

for (const item of rewritten) await atomicWrite(item.path, item.updatedText)

const directoryRecords = []
for (const path of directories) {
  const mapping = mappings.find(({ from }) => basename(path) === from)
  const destination = join(dirname(path), mapping.to)
  await rename(path, destination)
  directoryRecords.push({ from: slash(relative(dataRoot, path)), to: slash(relative(dataRoot, destination)) })
}

const remaining = await findRemainingReferences()
if (remaining.length > 0) {
  await writeManifest('failed_validation', remaining)
  throw new Error(`Migration left ${remaining.length} legacy references; restore from ${backupRoot}`)
}

await validateAccounts()
await writeManifest('completed', [])
await mkdir(join(dataRoot, 'logs', 'audit'), { recursive: true })
await appendFile(join(dataRoot, 'logs', 'audit', 'shop-identity-migration.jsonl'), `${JSON.stringify({
  event: 'shop_identity_migrated', migrationId, mappings, rewrittenFiles: rewritten.length,
  renamedDirectories: directoryRecords.length, completedAt: new Date().toISOString(), manifestPath
})}\n`, 'utf8')
process.stdout.write(`${JSON.stringify({ ...summary, migrationId, status: 'completed', manifestPath }, null, 2)}\n`)

async function writeManifest(status, remainingReferences) {
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: '1.0.0', migrationId, status, startedAt, completedAt: new Date().toISOString(),
    ...summary, files: fileRecords, directories: directoryRecords, remainingReferences
  }, null, 2)}\n`, 'utf8')
}

function rewriteJson(value, parentKey = '') {
  if (Array.isArray(value)) return value.map((item) => rewriteJson(item, parentKey))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      const mappedKey = mappings.find(({ from }) => key === from)?.to ?? key
      return [mappedKey, rewriteJson(item, key)]
    }))
  }
  if (typeof value !== 'string') return value
  for (const { from, to } of mappings) {
    if (value === from) return to
    if (/(?:path|dataset|shopIds|dashboard|relative)/i.test(parentKey) && value.includes(from)) return value.replaceAll(from, to)
  }
  return value
}

async function findRemainingReferences() {
  const currentFiles = (await Promise.all(scanRoots.map(walkFiles))).flat().filter(isJsonArtifact)
  const remaining = []
  for (const path of currentFiles) {
    const text = await readFile(path, 'utf8')
    if (mappings.some(({ from }) => text.includes(from))) remaining.push(slash(relative(dataRoot, path)))
  }
  const currentDirectories = await walkDirectories(join(dataRoot, 'data'))
  for (const path of currentDirectories) {
    if (mappings.some(({ from }) => basename(path) === from)) remaining.push(slash(relative(dataRoot, path)))
  }
  return remaining.sort()
}

async function validateAccounts() {
  const accountDirectory = join(dataRoot, 'config', 'accounts')
  const accountFiles = (await readdir(accountDirectory)).filter((name) => name.endsWith('.json'))
  const identifiers = []
  for (const fileName of accountFiles) {
    const account = JSON.parse(await readFile(join(accountDirectory, fileName), 'utf8'))
    if (!/^[TPJADKQ]\d{4}$/.test(account.shop_id)) throw new Error(`Account ${account.account_id} has non-standard shop_id ${account.shop_id}`)
    identifiers.push(account.shop_id)
  }
  if (new Set(identifiers).size !== identifiers.length) throw new Error('Duplicate shop identifiers found after migration')
}

async function atomicWrite(path, contents) {
  const temporaryPath = `${path}.${process.pid}.migration.tmp`
  await writeFile(temporaryPath, contents, 'utf8')
  await rename(temporaryPath, path)
}

async function walkFiles(root) {
  const results = []
  if (!(await exists(root))) return results
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) results.push(...await walkFiles(path))
    else if (entry.isFile()) results.push(path)
  }
  return results
}

async function walkDirectories(root) {
  const results = []
  if (!(await exists(root))) return results
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(root, entry.name)
    results.push(path, ...await walkDirectories(path))
  }
  return results
}

function isJsonArtifact(path) {
  return path.endsWith('.json') || path.endsWith('.json.bak')
}

async function exists(path) {
  try { await stat(path); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function slash(value) {
  return value.split(sep).join('/')
}

function readOption(name) {
  const prefix = `${name}=`
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

function parseMapping(value) {
  const raw = value.slice('--map='.length)
  const separator = raw.indexOf('=')
  if (separator <= 0 || separator === raw.length - 1) throw new Error(`Invalid mapping argument: ${value}`)
  return { from: raw.slice(0, separator), to: raw.slice(separator + 1) }
}
