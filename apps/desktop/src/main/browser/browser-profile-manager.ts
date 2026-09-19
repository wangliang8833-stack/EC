import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { ipcMain, session, WebContentsView, type BrowserWindow, type IpcMainEvent, type Session, type WebContents } from 'electron'
import type {
  AccountConfig,
  LoginState,
  WorkspaceBounds,
  WorkspaceBrowserState,
  WorkspaceNavigationAction,
  WorkspaceTabSummary,
  TmallWorkspaceShortcut
} from '@ecommerce/shared'
import type { AccountCredentialVault } from '../accounts/account-credential-vault.js'
import { getPlatformPreset } from '../accounts/platform-presets.js'
import { ACCOUNT_LOGIN_AUTOMATION_CHANNELS } from '../ipc/channels.js'
import { isAllowedAccountUrl } from '../security/navigation-policy.js'
import { isAllowedCredentialFrameUrl, selectCredentialFrame } from './login-automation-policy.js'
import { flushPersistentSession } from './session-persistence.js'
import { isAllowedCookieDomain, SessionCookieVault } from './session-cookie-vault.js'
import { OpeningWorkspaceLease, ownsWorkspaceLease } from './workspace-lease.js'
import { canOpenWorkspacePopup, nextWorkspaceTabId } from './workspace-tab-policy.js'
import { resolveWorkspaceShortcut, shouldClickBackendEntry } from './workspace-shortcuts.js'
import { runBoundedOperation, runCollectionSequence, type CollectionSequenceProgressPhase } from '../adapters/tmall/collection-execution.js'

export interface LoginInspection {
  status: LoginState
  currentUrl: string | null
}

export interface PageProbe {
  pageUrl: string
  pageTitle: string
  tableCount: number
  rowCount: number
  textLength: number
}

export interface TmallCapturedPage {
  key: 'store' | 'trade' | 'flow' | 'item' | 'service'
  sourcePage: string
  sourceUrl: string
  endpoints: Record<string, unknown>
}

export interface TmallDailySnapshot {
  bizDate: string
  capturedAt: string
  pages: TmallCapturedPage[]
}

export interface TmallCollectionOptions {
  signal?: AbortSignal | undefined
  navigationTimeoutMs?: number
  captureTimeoutMs?: number
  onProgress?: (phase: CollectionSequenceProgressPhase, page: TmallCapturedPage['key'], index: number, total: number) => void | Promise<void>
  onPageCaptured?: (page: TmallCapturedPage, index: number, total: number, capturedAt: string) => void | Promise<void>
}

interface TmallResourceSpec {
  path: string
  match?: Record<string, string>
  override?: Record<string, string>
}

interface BrowserWorkspaceTab {
  tabId: string
  fallbackTitle: string
  view: WebContentsView
  contents: WebContents
  statusHandler: (event: IpcMainEvent, status: unknown) => void
  shortcut: TmallWorkspaceShortcut | null
}

interface BrowserWorkspace {
  accountId: string
  leaseId: string
  host: BrowserWindow
  account: AccountConfig
  accountSession: Session
  bounds: WorkspaceBounds
  tabs: BrowserWorkspaceTab[]
  activeTabId: string
  revision: number
  autoLoginAttempted: boolean
  observedStatus: LoginState | null
  closing: boolean
  checkpointTimer: NodeJS.Timeout | undefined
}

export class BrowserProfileManager {
  private readonly downloadHandlers = new WeakSet<Session>()
  private readonly restoredSessions = new WeakSet<Session>()
  private readonly persistenceWatchers = new WeakMap<Session, { account: AccountConfig; timer: NodeJS.Timeout | undefined }>()
  private readonly persistenceOperations = new WeakMap<Session, Promise<void>>()
  private readonly openingWorkspace = new OpeningWorkspaceLease()
  private readonly backgroundCollectors = new Map<string, WebContents>()
  private workspace: BrowserWorkspace | undefined

  constructor(
    private readonly dataRoot: string,
    private readonly sessionCookieVault: SessionCookieVault,
    private readonly credentialVault: AccountCredentialVault,
    private readonly onLoginStatusChanged: (accountId: string, status: LoginState) => Promise<void>,
    private readonly onWorkspaceStateChanged: (state: WorkspaceBrowserState) => void
  ) {}

  async openWorkspace(
    account: AccountConfig,
    host: BrowserWindow,
    bounds: WorkspaceBounds,
    leaseId: string
  ): Promise<WorkspaceBrowserState | null> {
    if (!account.enabled || account.login_status === 'disabled') throw new Error(`Account ${account.account_id} is disabled`)
    if (host.isDestroyed()) throw new Error('Main workspace window is unavailable')

    const existing = this.workspace
    if (existing?.leaseId === leaseId && existing.accountId === account.account_id && this.activeTab(existing)) {
      existing.bounds = bounds
      this.attachActiveTab(existing)
      return this.workspaceState(existing)
    }

    try {
      await this.closeWorkspace()
      this.openingWorkspace.begin(leaseId)
      const accountSession = this.accountSession(account)
      await this.prepareSessionPersistence(account, accountSession)
      await this.prepareDownloads(account.account_id, accountSession)
      if (!this.openingWorkspace.isActive(leaseId) || host.isDestroyed()) return null

      const workspace: BrowserWorkspace = {
        accountId: account.account_id,
        leaseId,
        host,
        account,
        accountSession,
        bounds,
        tabs: [],
        activeTabId: '',
        revision: 0,
        autoLoginAttempted: false,
        observedStatus: null,
        closing: false,
        checkpointTimer: undefined
      }
      this.workspace = workspace
      const initialTab = this.createWorkspaceTab(workspace, `${getPlatformPreset(account.platform).label}-${account.shop_name}`)
      workspace.activeTabId = initialTab.tabId
      this.openingWorkspace.finish(leaseId)
      this.attachActiveTab(workspace)

      try {
        await initialTab.contents.loadURL(account.login_url)
      } catch (error) {
        if (initialTab.contents.isDestroyed() || this.workspace?.leaseId !== leaseId) return null
        const redirectedUrl = initialTab.contents.getURL()
        if (redirectedUrl !== account.login_url && isAllowedAccountUrl(redirectedUrl, account.allowed_hosts)) {
          this.startTmallSessionCheckpoint(workspace)
          return this.publishWorkspaceState(workspace)
        }
        throw error
      }
      this.startTmallSessionCheckpoint(workspace)
      return this.publishWorkspaceState(workspace)
    } finally {
      this.openingWorkspace.finish(leaseId)
    }
  }

  layoutWorkspace(leaseId: string, bounds: WorkspaceBounds): void {
    const workspace = this.workspace
    if (!workspace || workspace.leaseId !== leaseId) return
    workspace.bounds = bounds
    const tab = this.activeTab(workspace)
    if (tab && !tab.contents.isDestroyed()) tab.view.setBounds(bounds)
  }

  navigateWorkspace(leaseId: string, action: WorkspaceNavigationAction): WorkspaceBrowserState {
    const workspace = this.requireWorkspace(leaseId)
    const tab = this.requireActiveTab(workspace)
    if (action === 'back' && tab.contents.navigationHistory.canGoBack()) tab.contents.navigationHistory.goBack()
    if (action === 'forward' && tab.contents.navigationHistory.canGoForward()) tab.contents.navigationHistory.goForward()
    if (action === 'reload') tab.contents.reload()
    return this.publishWorkspaceState(workspace)
  }

  async openWorkspaceShortcut(leaseId: string, shortcut: TmallWorkspaceShortcut): Promise<WorkspaceBrowserState> {
    const workspace = this.requireWorkspace(leaseId)
    const target = resolveWorkspaceShortcut(workspace.account.platform, shortcut)
    let tab = workspace.tabs.find((candidate) => candidate.shortcut === shortcut && !candidate.contents.isDestroyed())
    if (!tab) {
      if (!canOpenWorkspacePopup(target.url, this.allowedWorkspaceHosts(workspace), workspace.tabs.length)) throw new Error('无法打开快捷入口：标签页数量已达上限或入口地址不受信任')
      tab = this.createWorkspaceTab(workspace, target.title, shortcut)
    }
    workspace.activeTabId = tab.tabId
    this.attachActiveTab(workspace)
    this.publishWorkspaceState(workspace)
    await tab.contents.loadURL(target.url)
    if (shouldClickBackendEntry(shortcut, tab.contents.getURL())) {
      const entered = await clickBackendEntry(tab.contents, shortcut)
      if (!entered) {
        const platformName = shortcut === 'dmp' ? '达摩盘' : '万相台'
        throw new Error(`${platformName}首页已打开，但未找到“进入后台”按钮，请在页面中手动点击进入。`)
      }
    }
    return this.publishWorkspaceState(workspace)
  }

  activateWorkspaceTab(leaseId: string, tabId: string): WorkspaceBrowserState {
    const workspace = this.requireWorkspace(leaseId)
    const tab = workspace.tabs.find((candidate) => candidate.tabId === tabId && !candidate.contents.isDestroyed())
    if (!tab) throw new Error('Workspace tab is unavailable')
    workspace.activeTabId = tabId
    this.attachActiveTab(workspace)
    this.inspectAndPublishLogin(workspace.account, tab.contents)
    return this.publishWorkspaceState(workspace)
  }

  closeWorkspaceTab(leaseId: string, tabId: string): WorkspaceBrowserState {
    const workspace = this.requireWorkspace(leaseId)
    if (workspace.tabs.length <= 1) throw new Error('The last workspace tab cannot be closed')
    const index = workspace.tabs.findIndex((tab) => tab.tabId === tabId)
    if (index < 0) throw new Error('Workspace tab is unavailable')
    const [tab] = workspace.tabs.splice(index, 1)
    if (!tab) throw new Error('Workspace tab is unavailable')
    if (!workspace.host.isDestroyed() && workspace.host.contentView.children.includes(tab.view)) {
      workspace.host.contentView.removeChildView(tab.view)
    }
    ipcMain.removeListener(ACCOUNT_LOGIN_AUTOMATION_CHANNELS.status, tab.statusHandler)
    if (!tab.contents.isDestroyed()) tab.contents.close({ waitForBeforeUnload: false })
    if (workspace.activeTabId === tabId) {
      const nextTabId = nextWorkspaceTabId(workspace.tabs.map((candidate) => candidate.tabId), index)
      if (!nextTabId) throw new Error('Workspace has no remaining tab')
      workspace.activeTabId = nextTabId
      this.attachActiveTab(workspace)
      this.inspectAndPublishLogin(workspace.account, this.requireActiveTab(workspace).contents)
    }
    return this.publishWorkspaceState(workspace)
  }

  async closeWorkspace(leaseId?: string): Promise<void> {
    this.openingWorkspace.cancel(leaseId)
    const current = this.workspace
    if (!current || !ownsWorkspaceLease(current.leaseId, leaseId)) return
    this.workspace = undefined
    current.closing = true
    if (current.checkpointTimer) {
      clearInterval(current.checkpointTimer)
      current.checkpointTimer = undefined
    }
    for (const tab of current.tabs) {
      ipcMain.removeListener(ACCOUNT_LOGIN_AUTOMATION_CHANNELS.status, tab.statusHandler)
      if (!current.host.isDestroyed() && current.host.contentView.children.includes(tab.view)) {
        current.host.contentView.removeChildView(tab.view)
      }
    }
    try {
      const account = this.persistenceWatchers.get(current.accountSession)?.account
      if (account) await this.persistAccountEnvironment(account, current.accountSession)
      else await flushPersistentSession(current.accountSession)
    } finally {
      for (const tab of current.tabs) {
        if (!tab.contents.isDestroyed()) tab.contents.close({ waitForBeforeUnload: false })
      }
    }
  }

  async closeAccount(accountId: string): Promise<void> {
    if (this.workspace?.accountId === accountId) await this.closeWorkspace()
  }

  async refreshCredentials(account: AccountConfig): Promise<void> {
    const workspace = this.workspace
    if (!workspace || workspace.accountId !== account.account_id) return
    const tab = this.activeTab(workspace)
    if (!tab) return
    workspace.autoLoginAttempted = false
    await this.prepareAutomaticLogin(account, tab.contents)
  }

  inspectLogin(account: AccountConfig): LoginInspection {
    const contents = this.accountWebContents(account.account_id)
    if (!contents) return { status: 'need_human_login', currentUrl: null }
    const currentUrl = contents.getURL()
    try {
      new URL(currentUrl)
      const preset = getPlatformPreset(account.platform)
      const authenticated = isAuthenticatedUrl(currentUrl, preset.authenticatedHosts)
      const observed = this.workspace?.accountId === account.account_id ? this.workspace.observedStatus : null
      return { status: authenticated ? 'authenticated' : observed && observed !== 'authenticated' ? observed : 'need_human_login', currentUrl: sanitizeDisplayUrl(currentUrl) }
    } catch {
      return { status: 'need_human_login', currentUrl: currentUrl || null }
    }
  }

  async collectProbe(account: AccountConfig): Promise<PageProbe | null> {
    const contents = this.accountWebContents(account.account_id)
    if (!contents) return null

    const preset = getPlatformPreset(account.platform)
    const currentUrl = contents.getURL()
    let currentHost = ''
    try {
      currentHost = new URL(currentUrl).hostname
    } catch {
      // The controlled tab may still be on its initial blank document.
    }
    if (!isAuthenticatedUrl(currentUrl, preset.authenticatedHosts)) return null
    if (currentHost !== new URL(preset.collectionProbeUrl).hostname) await contents.loadURL(preset.collectionProbeUrl)

    const finalUrl = contents.getURL()
    let finalHost = ''
    try {
      finalHost = new URL(finalUrl).hostname
    } catch {
      return null
    }
    if (!isAuthenticatedUrl(finalUrl, preset.authenticatedHosts)) return null

    const counts = (await contents.executeJavaScript(
      `(() => ({
        tableCount: document.querySelectorAll('table, [role="table"]').length,
        rowCount: document.querySelectorAll('tbody tr, [role="row"]').length,
        textLength: document.body?.innerText?.length ?? 0
      }))()`,
      true
    )) as Partial<Record<'tableCount' | 'rowCount' | 'textLength', unknown>>

    return {
      pageUrl: finalUrl,
      pageTitle: contents.getTitle().slice(0, 300),
      tableCount: safeCount(counts.tableCount),
      rowCount: safeCount(counts.rowCount),
      textLength: safeCount(counts.textLength)
    }
  }

  async collectTmallDaily(account: AccountConfig, bizDate: string, options: TmallCollectionOptions = {}): Promise<TmallDailySnapshot | null> {
    if (account.platform !== 'tmall') throw new Error('Daily collection is only available for Tmall accounts')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) throw new TypeError('bizDate must use YYYY-MM-DD')
    const contents = this.accountWebContents(account.account_id)
    if (!contents) return null
    const preset = getPlatformPreset(account.platform)
    if (!isAuthenticatedUrl(contents.getURL(), preset.authenticatedHosts)) return null

    const snapshot = await this.collectTmallDailyWithContents(account, bizDate, contents, options)
    await this.persistAccountEnvironment(account, this.requireWorkspaceForAccount(account.account_id).accountSession)
    return snapshot
  }

  async collectTmallDailyBackground(account: AccountConfig, bizDate: string, options: TmallCollectionOptions = {}): Promise<TmallDailySnapshot | null> {
    if (account.platform !== 'tmall') throw new Error('Daily collection is only available for Tmall accounts')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) throw new TypeError('bizDate must use YYYY-MM-DD')
    if (this.backgroundCollectors.has(account.account_id)) throw new Error(`Account ${account.account_id} already has a background collector`)
    const accountSession = this.accountSession(account)
    await this.prepareSessionPersistence(account, accountSession)
    await this.prepareDownloads(account.account_id, accountSession)
    const collector = new WebContentsView({
      webPreferences: {
        session: accountSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })
    const contents = collector.webContents
    this.backgroundCollectors.set(account.account_id, contents)
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedAccountUrl(url, account.allowed_hosts)) event.preventDefault()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    try {
      await runBoundedOperation(
        () => contents.loadURL(account.login_url),
        { phase: 'navigate', pageKey: 'login', timeoutMs: options.navigationTimeoutMs ?? 30_000, signal: options.signal, onStop: () => this.stopPageCollection(contents) }
      )
      if (!isAuthenticatedUrl(contents.getURL(), getPlatformPreset(account.platform).authenticatedHosts)) return null
      return await this.collectTmallDailyWithContents(account, bizDate, contents, options)
    } finally {
      this.backgroundCollectors.delete(account.account_id)
      await this.persistAccountEnvironment(account, accountSession).catch(() => undefined)
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    }
  }

  private async collectTmallDailyWithContents(account: AccountConfig, bizDate: string, contents: WebContents, options: TmallCollectionOptions): Promise<TmallDailySnapshot | null> {
    const preset = getPlatformPreset(account.platform)

    const compactDate = bizDate.replaceAll('-', '')
    const itemIndexCodes = [
      'payAmt', 'sucRefundAmt', 'payItmCnt', 'payByrCnt', 'payRate', 'newPayByrCnt', 'payOldByrCnt',
      'olderPayAmt', 'juPayAmt', 'mtdPayAmt', 'mtdPayItmCnt', 'ytdPayAmt', 'itemStatus', 'itemCartCnt',
      'itemCartByrCnt', 'itemCltByrCnt', 'visitCartRate', 'visitCltRate', 'itmUv', 'itmPv', 'itmStayTime',
      'itmBounceRate', 'seGuideUv', 'seGuidePayByrCnt', 'seGuidePayRate', 'uvAvgValue', 'starLevel001',
      'itemUnitPrice1', 'fCharge', 'pDROI'
    ].join(',')
    const routeDefinitions: Array<{
      key: TmallCapturedPage['key']
      sourcePage: string
      url: string
      resources: TmallResourceSpec[]
    }> = [
      {
        key: 'store',
        sourcePage: '首页/数据概览',
        url: sycmRoute('/portal/home.htm', bizDate),
        resources: [
          { path: '/portal/live/new/index/overview/v3.json' },
          { path: '/portal/board/grow/factor/overview.json', match: { dateRange: `${bizDate}|${bizDate}`, dateType: 'day' } }
        ]
      },
      {
        key: 'trade',
        sourcePage: '交易/实时动态（昨日离线数据）',
        url: 'https://sycm.taobao.com/ipoll/index.htm',
        resources: [
          { path: '/ipoll/live/summary/getTradeCommonDate.json' },
          { path: '/ipoll/live/yesterday/getYesterdayTrade.json' },
          { path: '/ipoll/live/yesterday/getYesterdayFlow.json' }
        ]
      },
      {
        key: 'flow',
        sourcePage: '流量/流量看板',
        url: sycmRoute('/flow/monitor/overview', bizDate),
        resources: [
          { path: '/flow/new/guide/trend/overview.json', match: { dateRange: `${bizDate}|${bizDate}`, dateType: 'day' } },
          {
            path: '/flow/v3/overview/shopFlowSourceTop/v4.json',
            match: { dateRange: `${bizDate}|${bizDate}`, dateType: 'day' },
            override: { page: '1', pageSize: '500', device: '2', order: 'desc', orderBy: 'uv', indexCode: 'uv,pv,cartByrCnt,itmPayByrCnt,payAmt,payRate' }
          },
          {
            path: '/flow/new/overview/keywordTop.json',
            match: { dateRange: `${bizDate}|${bizDate}`, dateType: 'day' },
            override: { page: '1', pageSize: '500', device: '2', order: 'desc', orderBy: 'uv', indexCode: 'uv,pv,crtByrCnt,crtRate,payAmt' }
          }
        ]
      },
      {
        key: 'item',
        sourcePage: '商品/商品排行',
        url: sycmRoute('/cc/item_rank', bizDate),
        resources: [
          {
            path: '/cc/item/view/top.json',
            match: { dateRange: `${bizDate}|${bizDate}`, dateType: 'day' },
            override: { page: '1', pageSize: '500', indexCode: itemIndexCodes }
          }
        ]
      },
      {
        key: 'service',
        sourcePage: '服务/客服/核心监控',
        url: 'https://sycm.taobao.com/qos/service/core_monitor/new',
        resources: [
          { path: '/csp/api/core/monitor/overview/list', match: { startDate: compactDate, endDate: compactDate } },
          { path: '/csp/api/core/monitor/list', match: { startDate: compactDate, endDate: compactDate } }
        ]
      }
    ]

    let pages: TmallCapturedPage[]
    try {
      pages = await runCollectionSequence({
        definitions: routeDefinitions,
        signal: options.signal,
        navigationTimeoutMs: options.navigationTimeoutMs ?? 30_000,
        captureTimeoutMs: options.captureTimeoutMs ?? 45_000,
        navigate: async (definition) => {
          await contents.loadURL(definition.url)
          if (!isAuthenticatedUrl(contents.getURL(), preset.authenticatedHosts)) throw new TmallLoginRequiredError()
        },
        capture: async (definition, index) => {
          const endpoints = await this.capturePageResources(contents, definition.resources)
          const page: TmallCapturedPage = {
            key: definition.key,
            sourcePage: definition.sourcePage,
            sourceUrl: sanitizeDisplayUrl(contents.getURL()) ?? definition.url,
            endpoints
          }
          await options.onPageCaptured?.(page, index, routeDefinitions.length, new Date().toISOString())
          return page
        },
        onProgress: (phase, definition, index, total) => options.onProgress?.(phase, definition.key, index, total),
        onStop: () => this.stopPageCollection(contents)
      })
    } catch (error) {
      if (error instanceof TmallLoginRequiredError) return null
      throw error
    }
    return { bizDate, capturedAt: new Date().toISOString(), pages }
  }

  cancelDailyCollection(accountId: string): void {
    const contents = this.accountWebContents(accountId)
    if (contents) this.stopPageCollection(contents)
    const background = this.backgroundCollectors.get(accountId)
    if (background) this.stopPageCollection(background)
  }

  async closeAll(): Promise<void> {
    for (const contents of this.backgroundCollectors.values()) {
      this.stopPageCollection(contents)
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    }
    this.backgroundCollectors.clear()
    await this.closeWorkspace()
  }

  private createWorkspaceTab(workspace: BrowserWorkspace, fallbackTitle: string, shortcut: TmallWorkspaceShortcut | null = null): BrowserWorkspaceTab {
    const view = new WebContentsView({
      webPreferences: {
        session: workspace.accountSession,
        preload: join(__dirname, '../preload/account-login.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })
    view.setBackgroundColor('#ffffff')
    const contents = view.webContents
    const tabId = `tab_${randomUUID().replaceAll('-', '')}`
    const statusHandler = (event: IpcMainEvent, status: unknown): void => {
      const preset = getPlatformPreset(workspace.account.platform)
      const senderFrameUrl = event.senderFrame?.url ?? ''
      if (
        event.sender !== contents ||
        !isAutomationStatus(status) ||
        !isAllowedCredentialFrameUrl(senderFrameUrl, preset.credentialHosts)
      ) return
      this.setObservedLoginStatus(workspace.account, status)
    }
    const tab: BrowserWorkspaceTab = { tabId, fallbackTitle, view, contents, statusHandler, shortcut }
    workspace.tabs.push(tab)
    ipcMain.on(ACCOUNT_LOGIN_AUTOMATION_CHANNELS.status, statusHandler)
    this.guardNavigation(contents, workspace)
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame && this.workspace === workspace) workspace.observedStatus = null
      this.publishWorkspaceStateIfCurrent(workspace)
    })
    contents.on('did-start-loading', () => this.publishWorkspaceStateIfCurrent(workspace))
    contents.on('page-title-updated', () => this.publishWorkspaceStateIfCurrent(workspace))
    contents.on('did-navigate', () => this.publishWorkspaceStateIfCurrent(workspace))
    contents.on('did-navigate-in-page', () => this.publishWorkspaceStateIfCurrent(workspace))
    contents.on('dom-ready', () => {
      void this.prepareAutomaticLogin(workspace.account, contents).catch(() => this.setObservedLoginStatus(workspace.account, 'login_failed'))
    })
    contents.on('frame-created', (_event, details) => {
      details.frame?.on('dom-ready', () => {
        void this.prepareAutomaticLogin(workspace.account, contents).catch(() => this.setObservedLoginStatus(workspace.account, 'login_failed'))
      })
    })
    contents.on('did-stop-loading', () => {
      void this.persistAccountEnvironment(workspace.account, workspace.accountSession).catch(() => undefined)
      this.inspectAndPublishLogin(workspace.account, contents)
      this.publishWorkspaceStateIfCurrent(workspace)
    })
    contents.once('destroyed', () => {
      ipcMain.removeListener(ACCOUNT_LOGIN_AUTOMATION_CHANNELS.status, statusHandler)
      if (this.workspace !== workspace || workspace.closing) return
      const index = workspace.tabs.findIndex((candidate) => candidate.tabId === tabId)
      if (index >= 0) workspace.tabs.splice(index, 1)
      if (workspace.activeTabId === tabId && workspace.tabs.length > 0) {
        workspace.activeTabId = nextWorkspaceTabId(workspace.tabs.map((candidate) => candidate.tabId), index) ?? workspace.tabs[0]!.tabId
        this.attachActiveTab(workspace)
      }
      this.publishWorkspaceStateIfCurrent(workspace)
    })
    return tab
  }

  private guardNavigation(contents: WebContents, workspace: BrowserWorkspace): void {
    const allowedHosts = this.allowedWorkspaceHosts(workspace)
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedAccountUrl(url, allowedHosts)) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url, referrer, postBody }) => {
      if (this.workspace !== workspace || workspace.closing || !canOpenWorkspacePopup(url, allowedHosts, workspace.tabs.length)) return { action: 'deny' }
      setImmediate(() => {
        if (this.workspace !== workspace || workspace.closing) return
        const tab = this.createWorkspaceTab(workspace, '新标签页')
        workspace.activeTabId = tab.tabId
        this.attachActiveTab(workspace)
        this.publishWorkspaceState(workspace)
        const loadOptions = postBody
          ? { httpReferrer: referrer, postData: postBody.data, extraHeaders: `Content-Type: ${postBody.contentType}` }
          : { httpReferrer: referrer }
        void tab.contents.loadURL(url, loadOptions).catch(() => {
          if (!tab.contents.isDestroyed()) tab.contents.loadURL('about:blank').catch(() => undefined)
        })
      })
      return { action: 'deny' }
    })
  }

  private allowedWorkspaceHosts(workspace: BrowserWorkspace): string[] {
    return [...new Set([...workspace.account.allowed_hosts, ...getPlatformPreset(workspace.account.platform).allowedHosts])]
  }

  private attachActiveTab(workspace: BrowserWorkspace): void {
    if (workspace.host.isDestroyed()) return
    for (const tab of workspace.tabs) {
      if (workspace.host.contentView.children.includes(tab.view)) workspace.host.contentView.removeChildView(tab.view)
    }
    const active = this.activeTab(workspace)
    if (!active || active.contents.isDestroyed()) return
    workspace.host.contentView.addChildView(active.view)
    active.view.setBounds(workspace.bounds)
  }

  private activeTab(workspace: BrowserWorkspace): BrowserWorkspaceTab | undefined {
    return workspace.tabs.find((tab) => tab.tabId === workspace.activeTabId && !tab.contents.isDestroyed())
  }

  private requireActiveTab(workspace: BrowserWorkspace): BrowserWorkspaceTab {
    const tab = this.activeTab(workspace)
    if (!tab) throw new Error('Active workspace tab is unavailable')
    return tab
  }

  private requireWorkspace(leaseId: string): BrowserWorkspace {
    const workspace = this.workspace
    if (!workspace || workspace.leaseId !== leaseId || workspace.closing) throw new Error('Workspace lease is unavailable')
    return workspace
  }

  private requireWorkspaceForAccount(accountId: string): BrowserWorkspace {
    const workspace = this.workspace
    if (!workspace || workspace.accountId !== accountId || workspace.closing) throw new Error('Account workspace is unavailable')
    return workspace
  }

  private async capturePageResources(contents: WebContents, specs: TmallResourceSpec[]): Promise<Record<string, unknown>> {
    if (contents.isDestroyed()) throw new Error('Workspace contents are unavailable')
    return await contents.executeJavaScript(resourceCaptureScript(specs), true) as Record<string, unknown>
  }

  private stopPageCollection(contents: WebContents): void {
    if (contents.isDestroyed()) return
    contents.stop()
    void contents.executeJavaScript('globalThis.__ECOMMERCE_COLLECTION_ABORT__?.()', true).catch(() => undefined)
  }

  private workspaceState(workspace: BrowserWorkspace): WorkspaceBrowserState {
    const active = this.requireActiveTab(workspace)
    const closable = workspace.tabs.length > 1
    const tabs: WorkspaceTabSummary[] = workspace.tabs.filter((tab) => !tab.contents.isDestroyed()).map((tab) => ({
      tabId: tab.tabId,
      title: safeTabTitle(tab.contents.getTitle(), tab.fallbackTitle),
      active: tab.tabId === active.tabId,
      canGoBack: tab.contents.navigationHistory.canGoBack(),
      canGoForward: tab.contents.navigationHistory.canGoForward(),
      loading: tab.contents.isLoading(),
      closable
    }))
    return { leaseId: workspace.leaseId, accountId: workspace.accountId, revision: workspace.revision, activeTabId: active.tabId, tabs }
  }

  private publishWorkspaceState(workspace: BrowserWorkspace): WorkspaceBrowserState {
    workspace.revision += 1
    const state = this.workspaceState(workspace)
    this.onWorkspaceStateChanged(state)
    return state
  }

  private publishWorkspaceStateIfCurrent(workspace: BrowserWorkspace): void {
    if (this.workspace !== workspace || workspace.closing || !this.activeTab(workspace)) return
    this.publishWorkspaceState(workspace)
  }

  private accountSession(account: AccountConfig): Session {
    const expectedPartition = `persist:account-${account.account_id}`
    if (account.session_partition !== expectedPartition) throw new Error(`Refusing mismatched session partition for ${account.account_id}`)
    return session.fromPartition(account.session_partition, { cache: true })
  }

  private accountWebContents(accountId: string): WebContents | null {
    const workspace = this.workspace
    if (workspace?.accountId !== accountId) return null
    return this.activeTab(workspace)?.contents ?? null
  }

  private async prepareDownloads(accountId: string, accountSession: Session): Promise<void> {
    if (this.downloadHandlers.has(accountSession)) return
    const downloadDirectory = resolve(this.dataRoot, 'downloads', accountId)
    await mkdir(downloadDirectory, { recursive: true })
    accountSession.on('will-download', (_event, item) => item.setSavePath(resolve(downloadDirectory, basename(item.getFilename()))))
    this.downloadHandlers.add(accountSession)
  }

  private async prepareSessionPersistence(account: AccountConfig, accountSession: Session): Promise<void> {
    if (!this.restoredSessions.has(accountSession)) {
      await this.sessionCookieVault.restore(account, accountSession.cookies).catch(() => 0)
      this.restoredSessions.add(accountSession)
    }
    const existing = this.persistenceWatchers.get(accountSession)
    if (existing) {
      existing.account = account
      return
    }
    const watcher: { account: AccountConfig; timer: NodeJS.Timeout | undefined } = { account, timer: undefined }
    accountSession.cookies.on('changed', (_event, cookie) => {
      if (!cookie.domain || !isAllowedCookieDomain(cookie.domain, watcher.account.allowed_hosts)) return
      if (watcher.timer) clearTimeout(watcher.timer)
      watcher.timer = setTimeout(() => {
        watcher.timer = undefined
        void this.persistAccountEnvironment(watcher.account, accountSession).catch(() => undefined)
      }, 250)
    })
    this.persistenceWatchers.set(accountSession, watcher)
  }

  private startTmallSessionCheckpoint(workspace: BrowserWorkspace): void {
    if (workspace.account.platform !== 'tmall' || workspace.checkpointTimer) return
    workspace.checkpointTimer = setInterval(() => {
      void this.persistAccountEnvironment(workspace.account, workspace.accountSession).catch(() => undefined)
    }, 60_000)
    workspace.checkpointTimer.unref()
  }

  private persistAccountEnvironment(account: AccountConfig, accountSession: Session): Promise<void> {
    const previous = this.persistenceOperations.get(accountSession) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => this.persistAccountEnvironmentNow(account, accountSession))
    this.persistenceOperations.set(accountSession, current)
    return current.finally(() => {
      if (this.persistenceOperations.get(accountSession) === current) this.persistenceOperations.delete(accountSession)
    })
  }

  private async persistAccountEnvironmentNow(account: AccountConfig, accountSession: Session): Promise<void> {
    const watcher = this.persistenceWatchers.get(accountSession)
    if (watcher?.timer) {
      clearTimeout(watcher.timer)
      watcher.timer = undefined
    }
    await this.sessionCookieVault.snapshot(account, accountSession.cookies)
    await flushPersistentSession(accountSession)
  }

  private async prepareAutomaticLogin(account: AccountConfig, contents: WebContents): Promise<void> {
    const workspace = this.workspace
    if (!workspace || workspace.accountId !== account.account_id || !workspace.tabs.some((tab) => tab.contents === contents) || contents.isDestroyed()) return
    const preset = getPlatformPreset(account.platform)
    if (isAuthenticatedUrl(contents.getURL(), preset.authenticatedHosts)) {
      this.setObservedLoginStatus(account, 'authenticated')
      return
    }
    if (workspace.autoLoginAttempted) return
    const credentialFrame = selectCredentialFrame(contents.mainFrame, contents.mainFrame.framesInSubtree, preset.credentialHosts)
    if (!credentialFrame) return
    const credential = await this.credentialVault.load(account.credential_ref)
    if (!credential) {
      this.setObservedLoginStatus(account, 'need_human_login')
      return
    }
    if (this.workspace !== workspace || workspace.autoLoginAttempted || contents.isDestroyed()) return
    workspace.autoLoginAttempted = true
    try {
      credentialFrame.send(ACCOUNT_LOGIN_AUTOMATION_CHANNELS.credentials, credential)
    } catch (error) {
      workspace.autoLoginAttempted = false
      throw error
    }
  }

  private inspectAndPublishLogin(account: AccountConfig, contents: WebContents): void {
    if (contents.isDestroyed()) return
    const preset = getPlatformPreset(account.platform)
    if (isAuthenticatedUrl(contents.getURL(), preset.authenticatedHosts)) this.setObservedLoginStatus(account, 'authenticated')
    else if (!this.workspace?.observedStatus || this.workspace.observedStatus === 'authenticated') this.setObservedLoginStatus(account, 'need_human_login')
  }

  private setObservedLoginStatus(account: AccountConfig, status: LoginState): void {
    const workspace = this.workspace
    if (!workspace || workspace.accountId !== account.account_id || workspace.observedStatus === status) return
    workspace.observedStatus = status
    void this.onLoginStatusChanged(account.account_id, status).catch(() => undefined)
  }
}

function isAutomationStatus(value: unknown): value is 'need_human_login' | 'captcha_required' | 'login_failed' {
  return value === 'need_human_login' || value === 'captcha_required' || value === 'login_failed'
}

function safeTabTitle(value: string, fallback: string): string {
  const title = value.trim().replaceAll(/\s+/g, ' ')
  return (title || fallback).slice(0, 80)
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function sycmRoute(path: string, bizDate: string): string {
  const url = new URL(path, 'https://sycm.taobao.com')
  url.searchParams.set('dateRange', `${bizDate}|${bizDate}`)
  url.searchParams.set('dateType', 'day')
  return url.toString()
}

function resourceCaptureScript(specs: TmallResourceSpec[]): string {
  const serializedSpecs = JSON.stringify(specs)
  return `(() => {
    const specs = ${serializedSpecs};
    const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const controllers = new Set();
    let aborted = false;
    globalThis.__ECOMMERCE_COLLECTION_ABORT__ = () => {
      aborted = true;
      for (const controller of controllers) controller.abort();
    };
    const resourceNames = () => performance.getEntriesByType('resource').map((entry) => entry.name);
    const findUrl = (spec) => [...resourceNames()].reverse().find((name) => {
      try {
        const url = new URL(name);
        if (url.pathname !== spec.path) return false;
        return Object.entries(spec.match || {}).every(([key, value]) => url.searchParams.get(key) === value);
      } catch {
        return false;
      }
    });
    return (async () => {
      try {
      const viewportStep = Math.max(window.innerHeight * 0.8, 480);
      for (let top = 0; top < document.documentElement.scrollHeight; top += viewportStep) {
        if (aborted) throw new DOMException('Collection cancelled', 'AbortError');
        window.scrollTo({ top, behavior: 'instant' });
        await sleep(160);
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
      await sleep(500);
      const deadline = Date.now() + 20000;
      while (!aborted && Date.now() < deadline && specs.some((spec) => !findUrl(spec))) await sleep(250);
      if (aborted) throw new DOMException('Collection cancelled', 'AbortError');
      const entries = await Promise.all(specs.map(async (spec) => {
        const observed = findUrl(spec);
        const controller = new AbortController();
        controllers.add(controller);
        const requestTimeout = setTimeout(() => controller.abort(), 12000);
        try {
          const requestUrl = new URL(observed || spec.path, location.origin);
          if (!observed) {
            const authenticatedSeed = [...resourceNames()].reverse().map((name) => {
              try { return new URL(name); } catch { return null; }
            }).find((url) => url?.origin === location.origin && url.searchParams.has('token'));
            const pageToken = authenticatedSeed?.searchParams.get('token');
            if (pageToken) requestUrl.searchParams.set('token', pageToken);
          }
          for (const [key, value] of Object.entries(spec.match || {})) requestUrl.searchParams.set(key, value);
          for (const [key, value] of Object.entries(spec.override || {})) requestUrl.searchParams.set(key, value);
          const response = await fetch(requestUrl, { credentials: 'include', method: 'GET', signal: controller.signal });
          const contentType = response.headers.get('content-type') || '';
          if (!response.ok || !contentType.includes('json')) {
            return [spec.path, { ok: false, status: response.status, error: 'UNEXPECTED_RESPONSE' }];
          }
          const requestDate = spec.match?.dateRange?.split('|')[0] || (spec.match?.startDate ? spec.match.startDate.replace(/^(\\d{4})(\\d{2})(\\d{2})$/, '$1-$2-$3') : null);
          return [spec.path, { ok: true, status: response.status, requestDate, capturedAt: new Date().toISOString(), body: await response.json() }];
        } catch {
          return [spec.path, { ok: false, status: 0, error: controller.signal.aborted ? 'FETCH_TIMEOUT' : 'FETCH_FAILED' }];
        } finally {
          clearTimeout(requestTimeout);
          controllers.delete(controller);
        }
      }));
      return Object.fromEntries(entries);
      } finally {
        delete globalThis.__ECOMMERCE_COLLECTION_ABORT__;
      }
    })();
  })()`
}

class TmallLoginRequiredError extends Error {
  constructor() {
    super('Tmall login is required after navigation')
    this.name = 'TmallLoginRequiredError'
  }
}

function isAuthenticatedUrl(value: string, authenticatedHosts: readonly string[]): boolean {
  try {
    const url = new URL(value)
    return authenticatedHosts.includes(url.hostname) && !/\/(?:custom\/login|login|passport)(?:[/.]|$)/iu.test(`${url.pathname}${url.hash}`)
  } catch {
    return false
  }
}

async function clickBackendEntry(contents: WebContents, shortcut: TmallWorkspaceShortcut): Promise<boolean> {
  if (contents.isDestroyed()) return false
  const labels = shortcut === 'wanxiang' ? ['进入后台', '进入万相台无界版'] : ['进入后台']
  return await contents.executeJavaScript(`(() => {
    const labels = ${JSON.stringify(labels)};
    const deadline = Date.now() + 12000;
    const normalize = (value) => String(value || '').replace(/\\s+/g, '');
    const visible = (element) => element instanceof HTMLElement && !element.hasAttribute('disabled') && element.getClientRects().length > 0;
    return new Promise((resolve) => {
      const findAndClick = () => {
        const elements = [...document.querySelectorAll('button, a, [role="button"]')];
        for (const label of labels) {
          const target = elements.find((element) => visible(element) && normalize(element.textContent).includes(label));
          if (target instanceof HTMLElement) {
            target.click();
            resolve(true);
            return;
          }
        }
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(findAndClick, 250);
      };
      findAndClick();
    });
  })()`, true) as boolean
}

function sanitizeDisplayUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}
