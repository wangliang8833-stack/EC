import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { StorageSettingsRepository } from './storage-settings-repository.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; repository: StorageSettingsRepository }> {
  const root = await mkdtemp(join(tmpdir(), 'storage-settings-'))
  roots.push(root)
  return { root, repository: new StorageSettingsRepository(root) }
}

describe('StorageSettingsRepository', () => {
  it('uses backward-compatible default data and Electron session paths', async () => {
    const { root, repository } = await fixture()
    const settings = repository.loadSync()
    expect(settings.local_data_directory).toBe(join(root, 'app-data'))
    expect(settings.environment_data_directory).toBe(root)
    expect(settings.updated_at).toBeNull()
  })

  it('atomically saves writable absolute directories and reloads them', async () => {
    const { root, repository } = await fixture()
    const localDataDirectory = join(root, 'business-data')
    const environmentDataDirectory = join(root, 'browser-environment')
    const saved = await repository.save({ localDataDirectory, environmentDataDirectory })

    expect(saved.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(repository.loadSync()).toEqual(saved)
    const file = JSON.parse(await readFile(join(root, 'system', 'storage-settings.json'), 'utf8')) as Record<string, unknown>
    expect(file['local_data_directory']).toBe(localDataDirectory)
  })

  it('rejects relative, root and identical directories', async () => {
    const { root, repository } = await fixture()
    await expect(repository.save({ localDataDirectory: 'relative-data', environmentDataDirectory: join(root, 'environment') })).rejects.toThrow(/absolute/)
    await expect(repository.save({ localDataDirectory: root, environmentDataDirectory: root })).rejects.toThrow(/different/)
    const filesystemRoot = root.slice(0, 3)
    await expect(repository.save({ localDataDirectory: filesystemRoot, environmentDataDirectory: join(root, 'environment') })).rejects.toThrow(/root/)
  })
})
