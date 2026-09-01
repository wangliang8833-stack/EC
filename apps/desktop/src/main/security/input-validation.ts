import { ACCOUNT_PLATFORMS, type AccountCredentialInput, type CreateAccountInput, type DataUpdateRequest, type ReportQuery, type StorageDirectoryKind, type UpdateAccountInput, type UpdateStorageSettingsInput, type WorkspaceBounds } from '@ecommerce/shared'

const safeId = /^[A-Za-z0-9_-]{3,128}$/
const isoDate = /^\d{4}-\d{2}-\d{2}$/
const unsafeSecretField = /^(?:password|passwd|secret|cookie|token|authorization)(?:$|_)/i

export function assertSafeId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !safeId.test(value)) {
    throw new TypeError(`${field} must be a safe identifier`)
  }
}

export function assertReportQuery(value: unknown): asserts value is ReportQuery {
  if (!value || typeof value !== 'object') {
    throw new TypeError('report query must be an object')
  }
  const query = value as Partial<ReportQuery>
  if (typeof query.reportType !== 'string' || !safeId.test(query.reportType)) {
    throw new TypeError('reportType is invalid')
  }
  if (typeof query.dateStart !== 'string' || !isoDate.test(query.dateStart)) {
    throw new TypeError('dateStart is invalid')
  }
  if (typeof query.dateEnd !== 'string' || !isoDate.test(query.dateEnd)) {
    throw new TypeError('dateEnd is invalid')
  }
  for (const [field, values] of [
    ['platforms', query.platforms],
    ['shopIds', query.shopIds],
    ['ownerIds', query.ownerIds]
  ] as const) {
    if (!Array.isArray(values) || values.some((item) => typeof item !== 'string' || !safeId.test(item))) {
      throw new TypeError(`${field} is invalid`)
    }
  }
}

export function assertDataUpdateRequest(value: unknown): asserts value is DataUpdateRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('data update request must be an object')
  const input = value as Partial<DataUpdateRequest> & Record<string, unknown>
  const fields = Object.keys(input)
  if (fields.some((field) => !['bizDate', 'platforms', 'shopIds', 'forceRefresh'].includes(field))) throw new TypeError('data update request contains unsupported fields')
  if (fields.length < 3 || fields.length > 4) throw new TypeError('data update request fields are invalid')
  if (typeof input.bizDate !== 'string' || !isoDate.test(input.bizDate)) throw new TypeError('bizDate is invalid')
  if ('forceRefresh' in input && typeof input.forceRefresh !== 'boolean') throw new TypeError('forceRefresh is invalid')
  for (const [field, values] of [['platforms', input.platforms], ['shopIds', input.shopIds]] as const) {
    if (!Array.isArray(values) || values.length === 0 || values.some((item) => typeof item !== 'string' || !safeId.test(item))) {
      throw new TypeError(`${field} is invalid`)
    }
  }
}

export function assertCreateAccountInput(value: unknown): asserts value is CreateAccountInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('account input must be an object')
  }
  const input = value as Partial<CreateAccountInput> & Record<string, unknown>
  if (Object.keys(input).some((field) => unsafeSecretField.test(field))) {
    throw new TypeError('credentials must not be submitted in account configuration')
  }
  const allowedFields = new Set([
    'platform',
    'shopName',
    'subaccountName',
    'owner',
    'authorizationConfirmed'
  ])
  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new TypeError('account input contains unsupported fields')
  }
  if (!ACCOUNT_PLATFORMS.includes(input.platform as (typeof ACCOUNT_PLATFORMS)[number])) {
    throw new TypeError('account platform is unsupported')
  }
  assertTrimmedText(input.shopName, 'shopName', 200)
  assertTrimmedText(input.subaccountName, 'subaccountName', 200)
  assertTrimmedText(input.owner, 'owner', 100)
  if (input.authorizationConfirmed !== true) {
    throw new TypeError('authorized account confirmation is required')
  }
}

export function assertUpdateAccountInput(value: unknown): asserts value is UpdateAccountInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('account update must be an object')
  const input = value as Partial<UpdateAccountInput> & Record<string, unknown>
  const allowedFields = new Set(['shopName', 'subaccountName', 'owner'])
  if (Object.keys(input).length !== allowedFields.size || Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new TypeError('account update contains unsupported fields')
  }
  assertTrimmedText(input.shopName, 'shopName', 200)
  assertTrimmedText(input.subaccountName, 'subaccountName', 200)
  assertTrimmedText(input.owner, 'owner', 100)
}

export function assertAccountCredentialInput(value: unknown): asserts value is AccountCredentialInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('credential input must be an object')
  }
  const input = value as Partial<AccountCredentialInput> & Record<string, unknown>
  const fields = Object.keys(input)
  if (fields.length !== 3 || fields.some((field) => !['username', 'password', 'authorizationConfirmed'].includes(field))) {
    throw new TypeError('credential input contains unsupported fields')
  }
  if (typeof input.username !== 'string' || input.username.trim() !== input.username || input.username.length < 1 || input.username.length > 320) {
    throw new TypeError('username is invalid')
  }
  if (typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 1024) {
    throw new TypeError('password is invalid')
  }
  if (input.authorizationConfirmed !== true) throw new TypeError('credential storage authorization is required')
}

export function assertStorageDirectoryKind(value: unknown): asserts value is StorageDirectoryKind {
  if (value !== 'local_data' && value !== 'environment_data') {
    throw new TypeError('storage directory kind is invalid')
  }
}

export function assertWorkspaceBounds(value: unknown): asserts value is WorkspaceBounds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('workspace bounds must be an object')
  }
  const bounds = value as Partial<WorkspaceBounds> & Record<string, unknown>
  const fields = Object.keys(bounds)
  if (fields.length !== 4 || fields.some((field) => !['x', 'y', 'width', 'height'].includes(field))) {
    throw new TypeError('workspace bounds contain unsupported fields')
  }
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const number = bounds[field]
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0 || number > 16_384) {
      throw new TypeError(`workspace bounds ${field} is invalid`)
    }
  }
  const validated = bounds as WorkspaceBounds
  if (validated.width < 320 || validated.height < 240) {
    throw new TypeError('workspace bounds are too small')
  }
  if (validated.x < 180 || validated.y < 50) {
    throw new TypeError('workspace bounds must preserve the application navigation')
  }
}

export function assertUpdateStorageSettingsInput(value: unknown): asserts value is UpdateStorageSettingsInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('storage settings input must be an object')
  }
  const input = value as Partial<UpdateStorageSettingsInput> & Record<string, unknown>
  const fields = Object.keys(input)
  if (fields.length !== 2 || !fields.includes('localDataDirectory') || !fields.includes('environmentDataDirectory')) {
    throw new TypeError('storage settings input contains unsupported fields')
  }
  if (typeof input.localDataDirectory !== 'string' || typeof input.environmentDataDirectory !== 'string') {
    throw new TypeError('storage settings directories must be strings')
  }
}

function assertTrimmedText(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`${field} must be non-empty trimmed text`)
  }
}
