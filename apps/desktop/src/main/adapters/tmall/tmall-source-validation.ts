import type { TmallCapturedPage, TmallDailySnapshot } from '../../browser/browser-profile-manager.js'

export interface TmallSourceValidation {
  status: 'passed' | 'partial' | 'failed'
  loginRequired: boolean
  criticalEndpointCount: number
  warningCount: number
  warnings: string[]
}

const CORE_ENDPOINTS = new Set([
  'store:/portal/live/new/index/overview/v3.json',
  'trade:/ipoll/live/yesterday/getYesterdayTrade.json',
  'trade:/ipoll/live/yesterday/getYesterdayFlow.json',
  'flow:/flow/new/guide/trend/overview.json'
])
const LOGIN_ERROR_CODES = new Set([5810])
const LOGIN_MESSAGE = /must\s+login|login\s+(?:is\s+)?required|请.*登录|未登录|登录.*(?:失效|过期)|重新登录/iu
const LOGIN_PATH = /\/(?:custom\/login|login|passport)(?:[/.]|$)/iu

export function validateTmallSnapshot(snapshot: TmallDailySnapshot): TmallSourceValidation {
  const inspected = inspectPages(snapshot.pages)
  if (inspected.loginRequired) {
    return result('failed', true, inspected.criticalEndpointCount, [
      '生意参谋登录状态已失效，采集响应未通过业务校验。'
    ])
  }
  if (inspected.criticalEndpointCount === 0) {
    return result('failed', false, 0, [
      '首页、交易和流量核心接口均未返回可用业务数据，本次采集不能生成正式报表。'
    ])
  }
  if (inspected.endpointWarnings.length > 0) {
    return result('partial', false, inspected.criticalEndpointCount, inspected.endpointWarnings)
  }
  return result('passed', false, inspected.criticalEndpointCount, [])
}

export function validateTmallPage(page: TmallCapturedPage): TmallSourceValidation {
  const inspected = inspectPages([page])
  if (inspected.loginRequired) {
    return result('failed', true, inspected.criticalEndpointCount, ['生意参谋登录状态已失效。'])
  }
  if (inspected.endpointWarnings.length > 0 || Object.keys(page.endpoints).length === 0) {
    return result('partial', false, inspected.criticalEndpointCount, inspected.endpointWarnings.length > 0 ? inspected.endpointWarnings : ['页面未捕获到目标接口响应。'])
  }
  return result('passed', false, inspected.criticalEndpointCount, [])
}

function inspectPages(pages: TmallCapturedPage[]): {
  loginRequired: boolean
  criticalEndpointCount: number
  endpointWarnings: string[]
} {
  let loginRequired = false
  let criticalEndpointCount = 0
  const endpointWarnings: string[] = []
  for (const page of pages) {
    if (isLoginUrl(page.sourceUrl)) loginRequired = true
    for (const [path, rawEndpoint] of Object.entries(page.endpoints)) {
      if (!isRecord(rawEndpoint) || rawEndpoint['ok'] !== true) {
        endpointWarnings.push(`${page.sourcePage}接口 ${path} 网络响应不可用。`)
        continue
      }
      const body = rawEndpoint['body']
      if (containsLoginError(body)) {
        loginRequired = true
        continue
      }
      const code = topLevelBusinessCode(body)
      const businessSuccessful = code === null || code === 0 || code === 200
      if (!businessSuccessful) {
        endpointWarnings.push(`${page.sourcePage}接口 ${path} 返回业务状态 ${code}。`)
        continue
      }
      if (CORE_ENDPOINTS.has(`${page.key}:${path}`)) criticalEndpointCount += 1
    }
  }
  return { loginRequired, criticalEndpointCount, endpointWarnings: [...new Set(endpointWarnings)] }
}

function containsLoginError(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsLoginError)
  if (!isRecord(value)) return typeof value === 'string' && LOGIN_MESSAGE.test(value)
  const code = toFiniteNumber(value['code'])
  if (code !== null && LOGIN_ERROR_CODES.has(code)) return true
  for (const key of ['msg', 'message', 'error', 'errorMessage']) {
    const message = value[key]
    if (typeof message === 'string' && LOGIN_MESSAGE.test(message)) return true
  }
  return Object.values(value).some(containsLoginError)
}

function topLevelBusinessCode(value: unknown): number | null {
  return isRecord(value) ? toFiniteNumber(value['code']) : null
}

function isLoginUrl(value: string): boolean {
  try {
    return LOGIN_PATH.test(new URL(value).pathname)
  } catch {
    return false
  }
}

function result(status: TmallSourceValidation['status'], loginRequired: boolean, criticalEndpointCount: number, warnings: string[]): TmallSourceValidation {
  return { status, loginRequired, criticalEndpointCount, warningCount: warnings.length, warnings }
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
