import { createHash, randomUUID } from 'node:crypto'
import { appendFile, copyFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { SchemaRegistry, type SchemaId } from '@ecommerce/schemas'

export interface AtomicWriteResult {
  relativePath: string
  sha256: string
  byteLength: number
  writtenAt: string
}

export class UnsafeStoragePathError extends Error {
  constructor(path: string) {
    super(`Storage path escapes the configured root: ${path}`)
    this.name = 'UnsafeStoragePathError'
  }
}

export class JsonStorageService {
  private readonly root: string
  private readonly schemas: SchemaRegistry

  constructor(root: string, schemas: SchemaRegistry = new SchemaRegistry()) {
    this.root = resolve(root)
    this.schemas = schemas
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(resolve(this.root, 'config'), { recursive: true }),
      mkdir(resolve(this.root, 'data', 'raw'), { recursive: true }),
      mkdir(resolve(this.root, 'data', 'normalized'), { recursive: true }),
      mkdir(resolve(this.root, 'data', 'aggregate'), { recursive: true }),
      mkdir(resolve(this.root, 'data', 'report-datasets'), { recursive: true }),
      mkdir(resolve(this.root, 'data', 'indexes'), { recursive: true }),
      mkdir(resolve(this.root, 'logs', 'audit'), { recursive: true })
    ])
  }

  async writeJson<T>(relativePath: string, value: T, schemaId?: SchemaId): Promise<AtomicWriteResult> {
    if (schemaId) {
      this.schemas.assert<T>(schemaId, value)
    }

    const target = this.resolveSafe(relativePath)
    if (!target.endsWith('.json')) {
      throw new TypeError('Business data files must use the .json extension')
    }

    await mkdir(dirname(target), { recursive: true })
    const serialized = `${JSON.stringify(value, null, 2)}\n`
    const bytes = Buffer.from(serialized, 'utf8')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const temporary = `${target}.tmp-${randomUUID()}`

    try {
      const handle = await open(temporary, 'wx')
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }

      if (await this.exists(target)) {
        await copyFile(target, `${target}.bak`)
      }
      await rename(temporary, target)

      const result: AtomicWriteResult = {
        relativePath: relative(this.root, target).split(sep).join('/'),
        sha256,
        byteLength: bytes.byteLength,
        writtenAt: new Date().toISOString()
      }
      await this.appendAudit(result)
      return result
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async readJson<T>(relativePath: string, schemaId?: SchemaId): Promise<T> {
    const target = this.resolveSafe(relativePath)
    const value: unknown = JSON.parse(await readFile(target, 'utf8'))
    if (schemaId) {
      this.schemas.assert<T>(schemaId, value)
    }
    return value as T
  }

  private resolveSafe(path: string): string {
    if (!path || path.includes('\0')) {
      throw new UnsafeStoragePathError(path)
    }
    const candidate = resolve(this.root, path)
    if (candidate !== this.root && !candidate.startsWith(`${this.root}${sep}`)) {
      throw new UnsafeStoragePathError(path)
    }
    return candidate
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw error
    }
  }

  private async appendAudit(result: AtomicWriteResult): Promise<void> {
    const auditPath = resolve(this.root, 'logs', 'audit', 'storage.jsonl')
    await mkdir(dirname(auditPath), { recursive: true })
    await appendFile(auditPath, `${JSON.stringify({ event: 'json_written', ...result })}\n`, 'utf8')
  }
}
