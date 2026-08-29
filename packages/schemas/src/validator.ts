import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import { accountSchema, jobSchema, rawCollectionSchema, shopSchema } from './schemas.js'

export type SchemaId =
  | 'account-config-1.0.0'
  | 'shop-config-1.0.0'
  | 'job-config-1.0.0'
  | 'raw-collection-1.0.0'

export class SchemaValidationError extends Error {
  constructor(
    public readonly schemaId: SchemaId,
    public readonly validationErrors: ErrorObject[]
  ) {
    super(`JSON validation failed for ${schemaId}: ${formatErrors(validationErrors)}`)
    this.name = 'SchemaValidationError'
  }
}

function formatErrors(errors: ErrorObject[]): string {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ')
}

export class SchemaRegistry {
  private readonly validators: ReadonlyMap<SchemaId, ValidateFunction>

  constructor() {
    const ajv = new Ajv({ allErrors: true, strict: true })
    ajv.addFormat('uri', {
      type: 'string',
      validate(value: string) {
        try {
          const url = new URL(value)
          return url.protocol === 'https:' || url.protocol === 'http:'
        } catch {
          return false
        }
      }
    })

    this.validators = new Map<SchemaId, ValidateFunction>([
      ['account-config-1.0.0', ajv.compile(accountSchema)],
      ['shop-config-1.0.0', ajv.compile(shopSchema)],
      ['job-config-1.0.0', ajv.compile(jobSchema)],
      ['raw-collection-1.0.0', ajv.compile(rawCollectionSchema)]
    ])
  }

  validate<T>(schemaId: SchemaId, value: unknown): value is T {
    const validator = this.validators.get(schemaId)
    if (!validator) {
      throw new Error(`Unknown schema: ${schemaId}`)
    }
    return validator(value)
  }

  assert<T>(schemaId: SchemaId, value: unknown): asserts value is T {
    const validator = this.validators.get(schemaId)
    if (!validator) {
      throw new Error(`Unknown schema: ${schemaId}`)
    }
    if (!validator(value)) {
      throw new SchemaValidationError(schemaId, [...(validator.errors ?? [])])
    }
  }
}

