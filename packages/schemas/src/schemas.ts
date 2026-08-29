const isoDateTimePattern = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?(?:Z|[+-]\\d{2}:\\d{2})$'
const datePattern = '^\\d{4}-\\d{2}-\\d{2}$'
const safeIdPattern = '^[A-Za-z0-9_-]+$'

export const accountSchema = {
  $id: 'account-config-1.0.0',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'account_id',
    'platform',
    'shop_id',
    'shop_name',
    'subaccount_name',
    'owner',
    'session_partition',
    'credential_ref',
    'login_url',
    'allowed_hosts',
    'enabled',
    'login_status',
    'last_login_checked_at',
    'created_at',
    'updated_at'
  ],
  properties: {
    schema_version: { type: 'string', const: '1.0.0' },
    account_id: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 },
    platform: { type: 'string', pattern: safeIdPattern, minLength: 2, maxLength: 64 },
    shop_id: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 },
    shop_name: { type: 'string', minLength: 1, maxLength: 200 },
    subaccount_name: { type: 'string', minLength: 1, maxLength: 200 },
    owner: { type: 'string', minLength: 1, maxLength: 100 },
    session_partition: { type: 'string', pattern: '^persist:account-[A-Za-z0-9_-]+$' },
    credential_ref: { type: 'string', nullable: true, pattern: safeIdPattern, maxLength: 128 },
    login_url: { type: 'string', format: 'uri', maxLength: 2048 },
    allowed_hosts: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[A-Za-z0-9.-]+$', maxLength: 253 }
    },
    enabled: { type: 'boolean' },
    login_status: {
      type: 'string',
      enum: ['unknown', 'authenticated', 'expired', 'need_human_login', 'captcha_required', 'login_failed', 'locked', 'disabled']
    },
    last_login_checked_at: { type: 'string', nullable: true, pattern: isoDateTimePattern },
    created_at: { type: 'string', pattern: isoDateTimePattern },
    updated_at: { type: 'string', pattern: isoDateTimePattern }
  }
} as const

export const shopSchema = {
  $id: 'shop-config-1.0.0',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'shop_id', 'platform', 'shop_name', 'owner_id', 'enabled', 'created_at', 'updated_at'],
  properties: {
    schema_version: { type: 'string', const: '1.0.0' },
    shop_id: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 },
    platform: { type: 'string', pattern: safeIdPattern, minLength: 2, maxLength: 64 },
    shop_name: { type: 'string', minLength: 1, maxLength: 200 },
    owner_id: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 },
    enabled: { type: 'boolean' },
    created_at: { type: 'string', pattern: isoDateTimePattern },
    updated_at: { type: 'string', pattern: isoDateTimePattern }
  }
} as const

export const jobSchema = {
  $id: 'job-config-1.0.0',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'job_id',
    'name',
    'platform',
    'account_ids',
    'data_type',
    'schedule',
    'date_strategy',
    'retry',
    'timeout_seconds',
    'enabled'
  ],
  properties: {
    schema_version: { type: 'string', const: '1.0.0' },
    job_id: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    platform: { type: 'string', pattern: safeIdPattern, minLength: 2, maxLength: 64 },
    account_ids: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 }
    },
    data_type: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 },
    schedule: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'expression', 'timezone', 'jitter_seconds'],
      properties: {
        type: { type: 'string', const: 'cron' },
        expression: { type: 'string', minLength: 5, maxLength: 100 },
        timezone: { type: 'string', const: 'Asia/Shanghai' },
        jitter_seconds: { type: 'integer', minimum: 0, maximum: 90 }
      }
    },
    date_strategy: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', pattern: '^T-\\d+$' }
    },
    retry: {
      type: 'object',
      additionalProperties: false,
      required: ['max_attempts', 'backoff_seconds'],
      properties: {
        max_attempts: { type: 'integer', minimum: 1, maximum: 10 },
        backoff_seconds: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: { type: 'integer', minimum: 1, maximum: 86400 }
        }
      }
    },
    timeout_seconds: { type: 'integer', minimum: 1, maximum: 3600 },
    enabled: { type: 'boolean' }
  }
} as const

export const rawCollectionSchema = {
  $id: 'raw-collection-1.0.0',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'record_type',
    'run_id',
    'platform',
    'shop_id',
    'account_id',
    'data_type',
    'data_date',
    'collection_method',
    'adapter_version',
    'source',
    'collected_at',
    'payload',
    'validation',
    'integrity'
  ],
  properties: {
    schema_version: { type: 'string', const: '1.0.0' },
    record_type: { type: 'string', const: 'raw_collection' },
    run_id: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 },
    platform: { type: 'string', pattern: safeIdPattern, minLength: 2, maxLength: 64 },
    shop_id: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 },
    account_id: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 },
    data_type: { type: 'string', pattern: safeIdPattern, minLength: 3, maxLength: 128 },
    data_date: { type: 'string', pattern: datePattern },
    collection_method: {
      type: 'string',
      enum: ['network_response', 'download', 'dom', 'ocr', 'fixture']
    },
    adapter_version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    source: { type: 'object', required: [], additionalProperties: true },
    collected_at: { type: 'string', pattern: isoDateTimePattern },
    payload: { type: 'object', required: [], additionalProperties: true },
    validation: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'warnings'],
      properties: {
        status: {
          type: 'string',
          enum: ['passed', 'passed_with_warning', 'partial', 'failed', 'quarantined']
        },
        warnings: { type: 'array', items: { type: 'string' } }
      }
    },
    integrity: {
      type: 'object',
      additionalProperties: false,
      required: ['sha256', 'previous_run_id'],
      properties: {
        sha256: { type: 'string', nullable: true, pattern: '^[a-f0-9]{64}$' },
        previous_run_id: { type: 'string', nullable: true, pattern: safeIdPattern, maxLength: 128 }
      }
    }
  }
} as const
