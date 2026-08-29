import { constants } from 'node:fs'
import { access, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, parse, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { UpdateStorageSettingsInput } from '@ecommerce/shared'

export interface PersistedStorageSettings {
  schema_version: '1.0.0'
  local_data_directory: string
  environment_data_directory: string
  updated_at: string | null
}

export class StorageSettingsRepository {
  private readonly settingsPath: string
  private readonly defaultLocalDataDirectory: string
  private readonly defaultEnvironmentDataDirectory: string

  constructor(private readonly userDataDirectory: string) {
    this.settingsPath = resolve(userDataDirectory, 'system', 'storage-settings.json')
    this.defaultLocalDataDirectory = resolve(userDataDirectory, 'app-data')
    this.defaultEnvironmentDataDirectory = resolve(userDataDirectory)
  }

  defaults(): PersistedStorageSettings {
    return {
      schema_version: '1.0.0',
      local_data_directory: this.defaultLocalDataDirectory,
      environment_data_directory: this.defaultEnvironmentDataDirectory,
      updated_at: null
    }
  }

  loadSync(): PersistedStorageSettings {
    if (!existsSync(this.settingsPath)) return this.defaults()
    const value: unknown = JSON.parse(readFileSync(this.settingsPath, 'utf8'))
    return this.assertSettings(value)
  }

  async save(input: UpdateStorageSettingsInput): Promise<PersistedStorageSettings> {
    const settings: PersistedStorageSettings = {
      schema_version: '1.0.0',
      local_data_directory: normalizeDirectory(input.localDataDirectory, 'localDataDirectory'),
      environment_data_directory: normalizeDirectory(input.environmentDataDirectory, 'environmentDataDirectory'),
      updated_at: new Date().toISOString()
    }
    assertDistinctDirectories(settings.local_data_directory, settings.environment_data_directory)
    await Promise.all([
      ensureWritableDirectory(settings.local_data_directory),
      ensureWritableDirectory(settings.environment_data_directory)
    ])
    await mkdir(dirname(this.settingsPath), { recursive: true })
    const temporary = `${this.settingsPath}.tmp-${randomUUID()}`
    try {
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      if (existsSync(this.settingsPath)) await copyFile(this.settingsPath, `${this.settingsPath}.bak`)
      await rename(temporary, this.settingsPath)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
    return settings
  }

  private assertSettings(value: unknown): PersistedStorageSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('storage settings must be an object')
    }
    const settings = value as Partial<PersistedStorageSettings> & Record<string, unknown>
    const allowedFields = new Set(['schema_version', 'local_data_directory', 'environment_data_directory', 'updated_at'])
    if (Object.keys(settings).length !== allowedFields.size || Object.keys(settings).some((field) => !allowedFields.has(field))) {
      throw new TypeError('storage settings contain unsupported fields')
    }
    if (settings.schema_version !== '1.0.0') throw new TypeError('storage settings version is unsupported')
    const localData = normalizeDirectory(settings.local_data_directory, 'local_data_directory')
    const environmentData = normalizeDirectory(settings.environment_data_directory, 'environment_data_directory')
    if (settings.updated_at !== null && typeof settings.updated_at !== 'string') {
      throw new TypeError('storage settings updated_at is invalid')
    }
    assertDistinctDirectories(localData, environmentData)
    return {
      schema_version: '1.0.0',
      local_data_directory: localData,
      environment_data_directory: environmentData,
      updated_at: settings.updated_at
    }
  }
}

function normalizeDirectory(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > 4096 || !isAbsolute(value)) {
    throw new TypeError(`${field} must be an absolute directory path`)
  }
  const normalized = resolve(value)
  if (normalized === parse(normalized).root) throw new TypeError(`${field} must not be a drive or filesystem root`)
  return normalized
}

function assertDistinctDirectories(localData: string, environmentData: string): void {
  const left = process.platform === 'win32' ? localData.toLowerCase() : localData
  const right = process.platform === 'win32' ? environmentData.toLowerCase() : environmentData
  if (left === right) {
    throw new TypeError('local data and environment data directories must be different')
  }
}

async function ensureWritableDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await access(path, constants.W_OK)
}
