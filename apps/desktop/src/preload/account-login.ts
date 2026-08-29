import { ipcRenderer } from 'electron'
import type { AccountCredential } from '../main/accounts/account-credential-vault.js'

const ACCOUNT_LOGIN_AUTOMATION_CHANNELS = {
  credentials: 'account-login-automation:credentials',
  status: 'account-login-automation:status'
} as const

type AutomationStatus = 'need_human_login' | 'captcha_required' | 'login_failed'

let pendingCredential: AccountCredential | null = null
let attempted = false
let lastStatus: AutomationStatus | null = null

function visible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  const style = getComputedStyle(element)
  const rectangle = element.getBoundingClientRect()
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rectangle.width > 2 && rectangle.height > 2
}

function firstVisible<T extends HTMLElement>(selectors: readonly string[]): T | null {
  for (const selector of selectors) {
    const element = [...document.querySelectorAll<T>(selector)].find(visible)
    if (element) return element
  }
  return null
}

function report(status: AutomationStatus): void {
  if (lastStatus === status) return
  lastStatus = status
  ipcRenderer.send(ACCOUNT_LOGIN_AUTOMATION_CHANNELS.status, status)
}

function detectChallengeOrFailure(): AutomationStatus | null {
  const captcha = firstVisible([
    'iframe[src*="captcha" i]',
    'iframe[src*="verify" i]',
    '[id*="captcha" i]',
    '[class*="captcha" i]',
    '[id*="nocaptcha" i]',
    '[class*="nocaptcha" i]',
    '.nc-container',
    '[class*="slider" i][class*="verify" i]'
  ])
  if (captcha) return 'captcha_required'

  const error = firstVisible<HTMLElement>([
    '[role="alert"]',
    '.login-error',
    '[class*="login-error" i]',
    '[class*="error-msg" i]',
    '[class*="errorMessage" i]'
  ])
  const errorText = error?.innerText || error?.textContent || ''
  if (error && /密码错误|账号.*错误|账户.*错误|登录失败|账号不存在|账户不存在|请重新输入|login failed|incorrect password/i.test(errorText)) {
    return 'login_failed'
  }
  return null
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Input value setter is unavailable')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function attemptLogin(): void {
  if (attempted || !pendingCredential || document.readyState === 'loading') return
  const challenge = detectChallengeOrFailure()
  if (challenge === 'captcha_required') {
    report(challenge)
    return
  }

  const username = firstVisible<HTMLInputElement>([
    'input[name="fm-login-id"]',
    '#fm-login-id',
    'input[name="TPL_username"]',
    'input[autocomplete="username"]',
    'input[type="text"]'
  ])
  const password = firstVisible<HTMLInputElement>([
    'input[name="fm-login-password"]',
    '#fm-login-password',
    'input[name="TPL_password"]',
    'input[autocomplete="current-password"]',
    'input[type="password"]'
  ])
  const submit = firstVisible<HTMLElement>([
    'button[type="submit"]',
    'input[type="submit"]',
    '#J_SubmitStatic',
    '.fm-button',
    '[class*="login"] button'
  ])
  if (!username || !password || !submit) {
    report('login_failed')
    return
  }

  attempted = true
  setInputValue(username, pendingCredential.username)
  setInputValue(password, pendingCredential.password)
  report('need_human_login')
  setTimeout(() => submit.click(), 180)
}

ipcRenderer.on(ACCOUNT_LOGIN_AUTOMATION_CHANNELS.credentials, (_event, credential: AccountCredential) => {
  if (!credential || typeof credential.username !== 'string' || typeof credential.password !== 'string') return
  pendingCredential = credential
  attemptLogin()
})

function observeLoginPage(): void {
  const initial = detectChallengeOrFailure()
  if (initial) report(initial)
  attemptLogin()
  const observer = new MutationObserver(() => {
    const status = detectChallengeOrFailure()
    if (status) report(status)
    else attemptLogin()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeLoginPage, { once: true })
else observeLoginPage()
