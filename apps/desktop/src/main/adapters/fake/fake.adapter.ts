import type {
  AccountContext,
  CollectionError,
  DataTarget,
  DateRange,
  LoginState,
  PlatformAdapter,
  RawCollectionResult,
  RecoveryAction,
  ValidationResult
} from '@ecommerce/shared'

export class FakePlatformAdapter implements PlatformAdapter {
  readonly platform = 'fixture'
  readonly version = '1.0.0'
  private dateRange: DateRange | null = null

  async checkLogin(context: AccountContext): Promise<LoginState> {
    return context.account.enabled ? context.account.login_status : 'disabled'
  }

  async navigate(context: AccountContext, _target: DataTarget): Promise<void> {
    if (context.account.platform !== this.platform) {
      throw new Error(`Adapter ${this.platform} cannot navigate account platform ${context.account.platform}`)
    }
  }

  async setDateRange(_context: AccountContext, range: DateRange): Promise<void> {
    if (range.start > range.end) {
      throw new RangeError('Date range start must not be after end')
    }
    this.dateRange = { ...range }
  }

  async collect(context: AccountContext, target: DataTarget): Promise<RawCollectionResult> {
    if (!this.dateRange) {
      throw new Error('Date range must be configured before collection')
    }
    const collectedAt = new Date().toISOString()
    return {
      schema_version: '1.0.0',
      record_type: 'raw_collection',
      run_id: context.run_id,
      platform: context.account.platform,
      shop_id: context.account.shop_id,
      account_id: context.account.account_id,
      data_type: target.data_type,
      data_date: this.dateRange.end,
      collection_method: 'fixture',
      adapter_version: this.version,
      source: { fixture: true, page_key: target.page_key },
      collected_at: collectedAt,
      payload: {
        paid_amount_cent: 123_456,
        paid_order_count: 42,
        visitor_count: 880
      },
      validation: { status: 'passed', warnings: [] },
      integrity: { sha256: null, previous_run_id: null }
    }
  }

  async validate(result: RawCollectionResult): Promise<ValidationResult> {
    const errors: string[] = []
    if (result.platform !== this.platform) errors.push('platform does not match adapter')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result.data_date)) errors.push('data_date is invalid')
    return { valid: errors.length === 0, warnings: [...result.validation.warnings], errors }
  }

  async recover(error: CollectionError): Promise<RecoveryAction> {
    if (error.code === 'LOGIN_EXPIRED') return { type: 'need_human_login' }
    if (error.recoverable) return { type: 'retry', delay_ms: 1_000 }
    return { type: 'abort', reason: error.message }
  }
}

