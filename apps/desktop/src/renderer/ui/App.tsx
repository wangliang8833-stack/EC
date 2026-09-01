import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Dropdown, Form, Input, InputNumber, Modal, Popover, Select, Space, Steps, Switch, Table, Tag, message } from 'antd'
import type { AccountCredentialInput, AccountPlatform, AccountSummary, CollectionProgress, CreateAccountInput, JobSummary, LoginState, ReportDataset, ScheduledJobInput, StorageDirectoryKind, SystemHealth, SystemStorageSettings, TmallWorkspaceShortcut, UpdateAccountInput, WorkspaceBounds, WorkspaceBrowserState, WorkspaceNavigationAction } from '@ecommerce/shared'
import { EChart, type DashboardChartOption } from './EChart.js'
import { mergeWorkspaceBrowserState } from './workspace-browser-state.js'
import { markNotificationsRead, upsertNotification, type AppNotification, type NotificationInput } from './notifications.js'
import { ProductReport } from './ProductReport.js'
import { PromotionReport } from './PromotionReport.js'
import { RoiCalculator } from './RoiCalculator.js'

type ViewKey = 'overview' | 'product-report' | 'promotion-report' | 'roi-calculator' | 'quality' | 'jobs' | 'accounts' | 'settings' | 'help'
type ShopAction = 'open' | 'check' | 'probe'
type WorkspaceAction = Exclude<ShopAction, 'open'>
type IconName = 'dashboard' | 'database' | 'shop' | 'tasks' | 'settings' | 'folder' | 'cloud' | 'server' | 'chevron' | 'back' | 'forward' | 'refresh' | 'download' | 'bell' | 'help' | 'shield' | 'chart' | 'calculator' | 'copy' | 'check'

interface NavGroup {
  key: string
  label: string
  icon: IconName
  pending?: boolean
  view?: ViewKey
  children: Array<{ key: ViewKey; label: string; pending?: boolean }>
}

const navGroups: NavGroup[] = [
  { key: 'dashboard', label: '仪表盘', icon: 'dashboard', children: [
    { key: 'overview', label: '销售总览' },
    { key: 'product-report', label: '商品报表' },
    { key: 'promotion-report', label: '推广报表' }
  ] },
  { key: 'roi-calculator', label: 'ROI计算器', icon: 'calculator', view: 'roi-calculator', children: [] },
  { key: 'ai-operations', label: 'AI自动运营', icon: 'tasks', pending: true, children: [] },
  { key: 'ai-analysis', label: 'AI数据分析', icon: 'chart', pending: true, children: [] },
  { key: 'shops', label: '店铺列表', icon: 'shop', children: [] }
]

const systemViewLabels: Partial<Record<ViewKey, string>> = {
  accounts: '账号环境',
  quality: '数据质量',
  jobs: '采集任务',
  settings: '系统设置',
  help: '帮助与反馈'
}

const salesTrendOption: DashboardChartOption = {
  animationDuration: 500,
  grid: { left: 12, right: 12, top: 22, bottom: 8, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
  tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => `¥${Number(value).toLocaleString('zh-CN')}` },
  xAxis: { type: 'category' as const, boundaryGap: false, data: ['8-01', '8-05', '8-09', '8-13', '8-17', '8-21', '8-25'], axisLine: { lineStyle: { color: '#e9e7e2' } }, axisTick: { show: false }, axisLabel: { color: '#8a8883', margin: 12 } },
  yAxis: { type: 'value' as const, axisLabel: { color: '#8a8883', formatter: (value: number) => `${Math.round(value / 1000)}k` }, splitLine: { lineStyle: { color: '#efede9' } } },
  series: [{ type: 'line' as const, smooth: 0.35, symbol: 'circle', symbolSize: 7, data: [32000, 38000, 35000, 42000, 39000, 45000, 47000], lineStyle: { width: 3, color: '#2383e2' }, itemStyle: { color: '#2383e2', borderColor: '#ffffff', borderWidth: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(35,131,226,.20)' }, { offset: 1, color: 'rgba(35,131,226,.015)' }] } } }]
}

const platformOption: DashboardChartOption = {
  tooltip: { trigger: 'item', formatter: '{b}<br/>{c}% · {d}%' },
  legend: { bottom: 0, left: 'center', itemWidth: 8, itemHeight: 8, itemGap: 14, textStyle: { color: '#787774', fontSize: 11 } },
  series: [{ type: 'pie' as const, radius: ['52%', '72%'], center: ['50%', '43%'], avoidLabelOverlap: true, itemStyle: { borderColor: '#ffffff', borderWidth: 3 }, label: { show: false }, emphasis: { scale: true, scaleSize: 5 }, data: [
    { name: '天猫', value: 38, itemStyle: { color: '#2383e2' } }, { name: '拼多多', value: 27, itemStyle: { color: '#2f9e54' } }, { name: '京东', value: 18, itemStyle: { color: '#f0a43c' } }, { name: '京喜', value: 10, itemStyle: { color: '#e0533d' } }, { name: '淘工厂', value: 7, itemStyle: { color: '#aaa7a0' } }
  ] }],
  graphic: [{ type: 'text', left: 'center', top: '34%', style: { text: '8,932', fill: '#37352f', fontSize: 22, fontWeight: 600 } }, { type: 'text', left: 'center', top: '47%', style: { text: '订单', fill: '#8a8883', fontSize: 11 } }]
}

const volumeOption: DashboardChartOption = {
  grid: { left: 8, right: 8, top: 16, bottom: 8, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  xAxis: { type: 'category' as const, data: ['W1', 'W2', 'W3', 'W4'], axisTick: { show: false }, axisLine: { lineStyle: { color: '#e9e7e2' } }, axisLabel: { color: '#8a8883' } },
  yAxis: { type: 'value' as const, axisLabel: { color: '#8a8883' }, splitLine: { lineStyle: { color: '#efede9' } } },
  series: [{ type: 'bar' as const, barWidth: '44%', data: [1850, 2120, 2380, 2682], itemStyle: { color: '#2383e2', borderRadius: [5, 5, 0, 0] } }]
}

const rankingRows = [
  { rank: 1, shop: '示例店铺3', platform: '天猫', amount: '¥31,240', trend: '+16.2%' },
  { rank: 2, shop: '示例店铺2', platform: '天猫', amount: '¥26,880', trend: '+9.8%' },
  { rank: 3, shop: '示例店铺6', platform: '京东', amount: '¥18,450', trend: '+8.4%' },
  { rank: 4, shop: '示例店铺1', platform: '天猫', amount: '¥15,920', trend: '-1.6%' },
  { rank: 5, shop: '示例工厂店', platform: '拼多多', amount: '¥12,060', trend: '+12.1%' }
]

const demoAccounts: AccountSummary[] = [
  { accountId: 'demo_pdd_01', platform: 'pinduoduo', shopId: 'P0001', shopName: '示例工厂店', subaccountName: '运营子账号', owner: '示例负责人甲', enabled: true, loginStatus: 'authenticated', lastLoginCheckedAt: '2026-08-27T02:30:00.000Z' },
  { accountId: 'demo_tm_01', platform: 'tmall', shopId: 'TEST_SHOP_5', shopName: '示例店铺3', subaccountName: '数据测试账号', owner: '示例负责人乙', enabled: true, loginStatus: 'need_human_login', lastLoginCheckedAt: null }
]

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ViewKey>('overview')
  const [openGroups, setOpenGroups] = useState(() => new Set(['dashboard']))
  const [isBrowserPreview, setIsBrowserPreview] = useState(false)
  const [restartRequired, setRestartRequired] = useState(false)
  const [activeShopId, setActiveShopId] = useState<string | null>(null)
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null)
  const [pendingShopAction, setPendingShopAction] = useState<{ accountId: string; action: WorkspaceAction } | null>(null)
  const [workspaceAction, setWorkspaceAction] = useState<WorkspaceAction | null>(null)
  const [collectionProgress, setCollectionProgress] = useState<Record<string, CollectionProgress>>({})
  const [workspaceClosing, setWorkspaceClosing] = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [notificationOpen, setNotificationOpen] = useState(false)
  const workspaceNavigationRef = useRef(false)
  const notify = useCallback((input: NotificationInput): void => {
    setNotifications((previous) => upsertNotification(previous, input))
  }, [])

  async function refresh(): Promise<void> {
    try {
      if (!window.desktopApi) {
        setIsBrowserPreview(true)
        setHealth({ status: 'ok', version: '0.1.0-preview', dataRoot: '浏览器视觉预览', developmentLogPath: '仅 Electron 主程序生成日志', timestamp: new Date().toISOString() })
        setAccounts(demoAccounts)
        setJobs([])
        setRestartRequired(false)
        setError(null)
        notify({ id: 'preview:mode', tone: 'info', title: '浏览器视觉预览', description: '当前为浏览器视觉预览；Electron 主程序才会读取本地账号、通知和任务数据。' })
        return
      }
      const [nextHealth, nextAccounts, nextJobs, nextStorageSettings] = await Promise.all([
        window.desktopApi.system.getHealth(),
        window.desktopApi.accounts.list(),
        window.desktopApi.jobs.list(),
        window.desktopApi.system.getStorageSettings()
      ])
      setHealth(nextHealth)
      setAccounts(nextAccounts)
      setJobs(nextJobs)
      setRestartRequired(nextStorageSettings.restartRequired)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (error) notify({ id: 'system:refresh-error', tone: 'error', title: '本地服务读取失败', description: error })
  }, [error, notify])
  useEffect(() => {
    if (!window.desktopApi) return
    return window.desktopApi.accounts.onLoginStatusChanged((updated) => {
      setAccounts((previous) => previous.map((account) => account.accountId === updated.accountId ? updated : account))
      if (updated.loginStatus !== 'authenticated') {
        notify({
          id: `login:${updated.accountId}`,
          tone: updated.loginStatus === 'captcha_required' || updated.loginStatus === 'login_failed' ? 'error' : 'warning',
          title: `${platformLabel(updated.platform)}-${updated.shopName} · ${loginStatusLabel(updated.loginStatus)}`,
          description: updated.loginStatus === 'captcha_required' ? '平台要求人工完成验证码，请打开对应店铺处理。' : '店铺登录状态需要处理，请打开对应店铺查看。'
        })
      }
    })
  }, [notify])
  useEffect(() => {
    if (!window.desktopApi) return
    return window.desktopApi.accounts.onCollectionProgress((progress) => {
      setCollectionProgress((previous) => ({ ...previous, [progress.accountId]: progress }))
    })
  }, [])
  useEffect(() => {
    if (!window.desktopApi) return
    return window.desktopApi.jobs.onChanged(setJobs)
  }, [])

  function toggleGroup(key: string): void {
    setOpenGroups((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function closeActiveWorkspace(): Promise<boolean> {
    if (!activeShopId || isBrowserPreview || !window.desktopApi) return true
    if (workspaceNavigationRef.current) return false
    workspaceNavigationRef.current = true
    setWorkspaceClosing(true)
    try {
      await window.desktopApi.accounts.closeWorkspace()
      return true
    } catch (reason) {
      notify({ id: 'workspace:close-error', tone: 'error', title: '关闭店铺工作区失败', description: errorMessage(reason) })
      return false
    } finally {
      workspaceNavigationRef.current = false
      setWorkspaceClosing(false)
    }
  }

  async function selectView(groupKey: string, view: ViewKey): Promise<void> {
    if (!await closeActiveWorkspace()) return
    setActiveShopId(null)
    setPendingShopAction(null)
    setOpenGroups((previous) => new Set(previous).add(groupKey))
    setActiveView(view)
  }

  async function selectSystemView(view: 'accounts' | 'quality' | 'jobs' | 'settings' | 'help'): Promise<void> {
    if (!await closeActiveWorkspace()) return
    setActiveShopId(null)
    setPendingShopAction(null)
    setActiveView(view)
  }

  function activateShop(account: AccountSummary, action: ShopAction): void {
    setOpenGroups((previous) => new Set(previous).add('shops'))
    setPendingShopAction(action === 'open' ? null : { accountId: account.accountId, action })
    setActiveShopId(account.accountId)
  }

  function selectShop(account: AccountSummary, action: ShopAction = 'open'): void {
    if (!account.enabled) {
      notify({ id: `account:${account.accountId}:disabled`, tone: 'warning', title: '店铺尚未启用', description: `请先打开 ${platformLabel(account.platform)}-${account.shopName} 的启用开关。` })
      return
    }
    if (action !== 'probe' || isBrowserPreview || !window.desktopApi) {
      activateShop(account, action)
      return
    }
    void (async () => {
      const bizDate = shanghaiYesterday()
      try {
        const report = await window.desktopApi!.reports.query({ reportType: 'tmall_daily_dashboard', dateStart: bizDate, dateEnd: bizDate, platforms: ['tmall'], shopIds: [account.shopId], ownerIds: [] })
        if (isExactCompletedReport(report, account, bizDate)) {
          notify({ id: `collection:${account.accountId}:${bizDate}:completed`, tone: 'info', title: '目标日期数据已采集', description: completedCollectionMessage(report, bizDate) })
          return
        }
      } catch {
        // Main 进程会再次执行权威校验；预检读取失败时继续打开工作区。
      }
      activateShop(account, action)
    })()
  }

  async function runWorkspaceAction(account: AccountSummary, action: WorkspaceAction): Promise<void> {
    if (isBrowserPreview || !window.desktopApi) {
      notify({ id: 'preview:no-account-access', tone: 'info', title: '浏览器视觉预览', description: '浏览器预览不访问真实账号环境。' })
      return
    }
    setWorkspaceAction(action)
    try {
      if (action === 'check') {
        const result = await window.desktopApi.accounts.checkLogin(account.accountId)
        await refresh()
        result.status === 'authenticated'
          ? notify({ id: `login:${account.accountId}:check`, tone: 'success', title: '登录检测完成', description: `已检测到 ${platformLabel(account.platform)}-${account.shopName} 的后台登录状态。` })
          : notify({ id: `login:${account.accountId}:check`, tone: 'warning', title: '尚未检测到有效登录', description: '请在当前右侧店铺后台完成人工登录。' })
      } else {
        const result = await window.desktopApi.accounts.testCollection(account.accountId)
        await refresh()
        if (result.status === 'SUCCESS') notify({ id: `collection:${account.accountId}:${result.bizDate ?? 'latest'}`, tone: 'success', title: '测试采集完成', description: `已抓取 ${result.bizDate ?? '昨日'} 的 ${result.datasetCount ?? 0} 类数据，仪表盘数据集：${result.dashboardRelativePath ?? result.relativePath ?? '已写入'}` })
        else if (result.status === 'ALREADY_COLLECTED') notify({ id: `collection:${account.accountId}:${result.bizDate ?? 'latest'}`, tone: 'info', title: '数据已采集', description: result.warning ?? `目标日期 ${result.bizDate ?? ''} 的数据已抓取完成，本次未重复执行。` })
        else notify({ id: `collection:${account.accountId}:login`, tone: 'warning', title: '采集等待登录', description: result.warning ?? '需要先在当前右侧店铺后台完成人工登录。' })
      }
    } catch (reason) {
      notify({ id: `workspace:${account.accountId}:${action}:error`, tone: 'error', title: action === 'probe' ? '测试采集失败' : '登录检测失败', description: errorMessage(reason) })
    } finally {
      setWorkspaceAction(null)
    }
  }

  async function cancelCollection(account: AccountSummary): Promise<void> {
    if (isBrowserPreview || !window.desktopApi) return
    try {
      await window.desktopApi.accounts.cancelCollection(account.accountId)
      notify({ id: `collection:${account.accountId}:cancelling`, tone: 'info', title: '正在取消采集任务', description: `${platformLabel(account.platform)}-${account.shopName} 的采集任务正在停止。` })
    } catch (reason) {
      notify({ id: `collection:${account.accountId}:cancel-error`, tone: 'error', title: '取消采集失败', description: errorMessage(reason) })
    }
  }

  async function leaveShopWorkspace(account: AccountSummary): Promise<void> {
    if (workspaceAction === 'probe' && window.desktopApi) await window.desktopApi.accounts.cancelCollection(account.accountId).catch(() => undefined)
    setWorkspaceAction(null)
    await selectView('shops', 'accounts')
  }

  function handleWorkspaceReady(account: AccountSummary): void {
    if (!pendingShopAction || pendingShopAction.accountId !== account.accountId) {
      void refresh()
      return
    }
    const { action } = pendingShopAction
    setPendingShopAction(null)
    void runWorkspaceAction(account, action)
  }

  async function toggleAccount(account: AccountSummary, enabled: boolean): Promise<void> {
    setSwitchingAccountId(account.accountId)
    try {
      if (isBrowserPreview || !window.desktopApi) {
        setAccounts((previous) => previous.map((item) => item.accountId === account.accountId ? { ...item, enabled, loginStatus: enabled ? 'need_human_login' : 'disabled' } : item))
        notify({ id: 'preview:account-toggle', tone: 'info', title: '浏览器视觉预览', description: '浏览器预览仅展示开关交互，不会写入账号配置。' })
      } else {
        const updated = await window.desktopApi.accounts.setEnabled(account.accountId, enabled)
        setAccounts((previous) => previous.map((item) => item.accountId === updated.accountId ? updated : item))
      }
      if (!enabled && activeShopId === account.accountId) {
        if (window.desktopApi) await window.desktopApi.accounts.closeWorkspace()
        setActiveShopId(null)
        setPendingShopAction(null)
        setActiveView('accounts')
      }
    } catch (reason) {
      notify({ id: `account:${account.accountId}:toggle-error`, tone: 'error', title: '店铺启用状态修改失败', description: errorMessage(reason) })
    } finally {
      setSwitchingAccountId(null)
    }
  }

  const activeShop = accounts.find((account) => account.accountId === activeShopId) ?? null
  const activeLabel = activeShop
    ? `${platformLabel(activeShop.platform)}-${activeShop.shopName}`
    : systemViewLabels[activeView]
    ? systemViewLabels[activeView]!
    : navGroups.find(({ view }) => view === activeView)?.label ?? navGroups.flatMap((group) => group.children).find(({ key }) => key === activeView)?.label ?? '销售总览'
  const isSystemView = !activeShop && activeView in systemViewLabels
  const unreadCount = notifications.filter(({ read }) => !read).length

  return <>
    <div className="app-shell">
      <header className={`topbar ${navigator.userAgent.includes('Macintosh') ? 'platform-macos' : ''}`}>
        <div className="topbar-primary">
          <div className="brand-block"><img className="brand-mark" src="./icon.png" alt="" /><div className="brand-title">电商多平台管理器</div></div>
        </div>
        <div className="topbar-actions">
          <Popover placement="bottomRight" trigger="click" open={notificationOpen} onOpenChange={(open) => { setNotificationOpen(open); if (open) setNotifications(markNotificationsRead) }} content={<NotificationCenter notifications={notifications} />}>
            <button className="icon-button notification-button" type="button" aria-label={`通知中心${unreadCount > 0 ? `，${unreadCount} 条未读` : ''}`}><Icon name="bell" />{unreadCount > 0 ? <span className="notification-unread-dot" aria-hidden="true" /> : null}</button>
          </Popover>
          <button className="icon-button" type="button" onClick={() => void refresh()} aria-label="刷新系统状态"><Icon name="refresh" /></button>
          <div className="system-state"><span className={`state-dot ${health?.status === 'ok' ? 'online' : ''}`} /><span>{health?.status === 'ok' ? '系统正常' : '检查中'}</span></div>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <nav className="nav-list" aria-label="主导航">
            {navGroups.map((group) => {
              const isOpen = openGroups.has(group.key)
              const containsActive = group.view === activeView || group.children.some(({ key }) => key === activeView) || (group.key === 'shops' && activeShop !== null)
              return <div className={`nav-group ${isOpen ? 'open' : ''}`} key={group.key}>
                <button className={`nav-group-button ${containsActive ? 'group-active' : ''} ${group.pending ? 'pending' : ''}`} type="button" disabled={group.pending} onClick={() => group.view ? void selectView(group.key, group.view) : toggleGroup(group.key)}>
                  <span className="nav-group-label"><Icon name={group.icon} />{group.label}</span>
                  {group.pending ? <span className="nav-pending-badge">待接入</span> : group.view ? null : <Icon name="chevron" />}
                </button>
                <div className="nav-children">
                  {group.children.map((item) => <button key={item.key} type="button" disabled={item.pending} className={`nav-child ${activeView === item.key && !activeShop ? 'active' : ''} ${item.pending ? 'pending' : ''}`} onClick={() => void selectView(group.key, item.key)}>
                    <span>{item.label}</span>{item.pending ? <span className="nav-pending-badge">待接入</span> : null}
                  </button>)}
                  {group.key === 'shops' ? accounts.map((account) => <div className={`nav-shop-row ${activeShopId === account.accountId ? 'active' : ''} ${account.enabled ? '' : 'disabled'}`} key={account.accountId}>
                    <button type="button" className="nav-shop-button" title={`${platformLabel(account.platform)}-${account.shopName} · ${loginStatusLabel(account.loginStatus)}`} onClick={() => selectShop(account)}>
                      <span className="shop-nav-label">{platformLabel(account.platform)}-{account.shopName}</span>
                    </button>
                    <span className={`shop-nav-status status-${account.loginStatus}`}>{loginStatusLabel(account.loginStatus)}</span>
                    <Switch size="small" checked={account.enabled} loading={switchingAccountId === account.accountId} aria-label={`${platformLabel(account.platform)}-${account.shopName}启用状态`} onChange={(enabled) => void toggleAccount(account, enabled)} />
                  </div>) : null}
                </div>
              </div>
            })}
          </nav>
          <Dropdown
            placement="topLeft"
            trigger={['click']}
            classNames={{ root: 'system-nav-dropdown' }}
            menu={{
              selectedKeys: isSystemView ? [activeView] : [],
              items: [
                { key: 'accounts', icon: <Icon name="shop" />, label: '账号环境' },
                { key: 'jobs', icon: <Icon name="tasks" />, label: '采集任务' },
                { type: 'divider' },
                { key: 'settings', icon: <Icon name="settings" />, label: '系统设置' },
                { key: 'help', icon: <Icon name="help" />, label: '帮助与反馈' }
              ],
              onClick: ({ key }) => {
                if (key === 'accounts' || key === 'quality' || key === 'jobs' || key === 'settings' || key === 'help') void selectSystemView(key)
              }
            }}
          >
            <button type="button" className={`sidebar-settings ${isSystemView ? 'active' : ''}`} aria-label="打开系统菜单">
              <span className="settings-mark"><img src="./icon.png" alt="" /></span>
              <span className="settings-copy"><strong>系统</strong><small>设置、账号与采集任务</small></span>
              <span className="settings-arrow" aria-hidden="true">⌃</span>
            </button>
          </Dropdown>
        </aside>

        <main className={`main-canvas ${activeShop ? 'shop-workspace-active' : ''}`}>{activeShop ? <ShopWorkspace account={activeShop} isPreview={isBrowserPreview} action={workspaceAction} progress={collectionProgress[activeShop.accountId] ?? null} closing={workspaceClosing} onReady={handleWorkspaceReady} onCheck={() => void runWorkspaceAction(activeShop, 'check')} onProbe={() => void runWorkspaceAction(activeShop, 'probe')} onCancel={() => void cancelCollection(activeShop)} onBack={() => void leaveShopWorkspace(activeShop)} onError={(reason) => notify({ id: `workspace:${activeShop.accountId}:browser-error`, tone: 'error', title: '店铺后台打开失败', description: errorMessage(reason) })} /> : <div className="content-container">
          <div className="page-heading">
            <div><div className="breadcrumb">工作台 / {activeLabel}</div><h1>{activeLabel === '销售总览' ? '多平台销售看板' : activeLabel}</h1><p>{activeView === 'overview' ? '按自然日查看全部有效店铺经营数据' : activeView === 'product-report' ? '查看商品流量、成交、退款与经营机会' : activeView === 'promotion-report' ? '查看推广消耗、成交归因、计划覆盖与数据质量' : activeView === 'roi-calculator' ? '测算商品推广的保本 ROAS、盈利周期与逐月现金流' : activeView === 'settings' ? '管理数据目录、程序环境与远程服务' : activeView === 'jobs' ? '管理自动采集时间、平台范围与批次执行策略' : activeView === 'help' ? '了解系统核心功能、业务架构与使用支持' : '阶段 0 本地管理工作台'}</p></div>
            {activeView === 'settings' || activeView === 'help' ? null : <div className="heading-actions"><span className="demo-badge">{activeView === 'roi-calculator' ? '本地计算' : isBrowserPreview ? '演示数据' : '本地数据'}</span>{activeView === 'roi-calculator' ? null : <Button icon={<Icon name="download" />} disabled>导出 CSV</Button>}</div>}
          </div>
          {activeView === 'overview' ? <Dashboard accounts={accounts} isPreview={isBrowserPreview} progress={collectionProgress} onNotify={notify} /> : null}
          {activeView === 'product-report' ? <ProductReport accounts={accounts} isPreview={isBrowserPreview} onNotify={notify} /> : null}
          {activeView === 'promotion-report' ? <PromotionReport accounts={accounts} isPreview={isBrowserPreview} onNotify={notify} /> : null}
          {activeView === 'roi-calculator' ? <RoiCalculator /> : null}
          {activeView === 'accounts' ? <AccountsView accounts={accounts} isPreview={isBrowserPreview} onAccountsChanged={refresh} onShopAction={selectShop} /> : null}
          {activeView === 'jobs' ? <JobsView jobs={jobs} accounts={accounts} isPreview={isBrowserPreview} onJobsChanged={setJobs} onNotify={notify} /> : null}
          {activeView === 'quality' ? <QualityView /> : null}
          {activeView === 'settings' ? <SystemSettingsView isPreview={isBrowserPreview} health={health} onRestartRequired={() => setRestartRequired(true)} /> : null}
          {activeView === 'help' ? <HelpFeedbackView health={health} isPreview={isBrowserPreview} onNavigate={(view) => void selectSystemView(view)} onNotify={notify} /> : null}
        </div>}</main>
      </div>
      <Modal
        open={restartRequired}
        title="目录设置已保存"
        footer={null}
        closable={false}
        mask={{ closable: false }}
        keyboard={false}
        centered
        width={520}
      >
        <div className="restart-lock-content">
          <Alert type="warning" showIcon title="请手动重启主程序后继续使用" description="为避免新旧目录同时写入，其他所有功能已暂时锁定。程序不会自动关闭或重启；请由您关闭当前窗口并重新打开，重启后将自动解锁并使用新目录。" />
          <p>系统不会自动复制、删除或覆盖旧目录中的数据。更换程序环境目录后，平台账号可能需要重新登录。</p>
        </div>
      </Modal>
    </div>
  </>
}

function NotificationCenter({ notifications }: { notifications: AppNotification[] }): React.JSX.Element {
  return <section className="notification-center" aria-label="通知内容">
    <div className="notification-center-header"><strong>通知</strong><span>{notifications.length > 0 ? `最近 ${notifications.length} 条` : '暂无新消息'}</span></div>
    <div className="notification-list">
      {notifications.length === 0 ? <div className="notification-empty"><Icon name="bell" /><span>暂无通知</span></div> : notifications.map((notification) => <article className={`notification-item tone-${notification.tone}`} key={notification.id}>
        <span className="notification-tone-dot" aria-hidden="true" />
        <div className="notification-copy"><div className="notification-title-row"><strong>{notification.title}</strong>{notification.read ? null : <span className="notification-item-unread">未读</span>}</div><p>{notification.description}</p><time>{new Date(notification.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time></div>
      </article>)}
    </div>
  </section>
}

function ShopWorkspace({ account, isPreview, action, progress, closing, onReady, onCheck, onProbe, onCancel, onBack, onError }: {
  account: AccountSummary
  isPreview: boolean
  action: WorkspaceAction | null
  progress: CollectionProgress | null
  closing: boolean
  onReady: (account: AccountSummary) => void
  onCheck: () => void
  onProbe: () => void
  onCancel: () => void
  onBack: () => void
  onError: (reason: unknown) => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const leaseIdRef = useRef<string | null>(null)
  const [browserState, setBrowserState] = useState<WorkspaceBrowserState | null>(null)
  const [browserBusy, setBrowserBusy] = useState(false)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || isPreview || !window.desktopApi) return
    const hostElement = host
    let observer: ResizeObserver | undefined
    let animationFrame = 0
    let disposed = false
    let previousBounds = ''
    const leaseId = crypto.randomUUID()
    leaseIdRef.current = leaseId
    setBrowserState(null)
    const unsubscribeState = window.desktopApi.accounts.onWorkspaceStateChanged((state) => {
      if (!disposed && state.leaseId === leaseId && state.accountId === account.accountId) {
        setBrowserState((current) => mergeWorkspaceBrowserState(current, state))
      }
    })

    function bounds(): WorkspaceBounds {
      const rectangle = hostElement.getBoundingClientRect()
      const x = Math.ceil(rectangle.x)
      const y = Math.ceil(rectangle.y)
      return {
        x,
        y,
        width: Math.floor(rectangle.right) - x,
        height: Math.floor(rectangle.bottom) - y
      }
    }

    async function initialize(): Promise<void> {
      try {
        const initialBounds = bounds()
        previousBounds = JSON.stringify(initialBounds)
        const opened = await window.desktopApi.accounts.openWorkspace(account.accountId, initialBounds, leaseId)
        if (disposed) {
          await window.desktopApi.accounts.closeWorkspace(leaseId)
          return
        }
        if (opened) setBrowserState((current) => mergeWorkspaceBrowserState(current, opened))
        onReady(account)
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(animationFrame)
          animationFrame = requestAnimationFrame(() => {
            const nextBounds = bounds()
            const serialized = JSON.stringify(nextBounds)
            if (serialized === previousBounds) return
            previousBounds = serialized
            void window.desktopApi.accounts.layoutWorkspace(leaseId, nextBounds).catch((reason) => {
              if (!disposed) onError(reason)
            })
          })
        })
        observer.observe(hostElement)
      } catch (reason) {
        if (!disposed) onError(reason)
      }
    }

    void initialize()
    return () => {
      disposed = true
      observer?.disconnect()
      unsubscribeState()
      cancelAnimationFrame(animationFrame)
      if (leaseIdRef.current === leaseId) leaseIdRef.current = null
      void window.desktopApi.accounts.closeWorkspace(leaseId).catch(() => undefined)
    }
  }, [account.accountId, isPreview])

  async function navigate(actionName: WorkspaceNavigationAction): Promise<void> {
    const leaseId = leaseIdRef.current
    if (!leaseId || isPreview || !window.desktopApi || browserBusy) return
    setBrowserBusy(true)
    try {
      const state = await window.desktopApi.accounts.navigateWorkspace(leaseId, actionName)
      setBrowserState((current) => mergeWorkspaceBrowserState(current, state))
    } catch (reason) {
      onError(reason)
    } finally {
      setBrowserBusy(false)
    }
  }

  async function activateTab(tabId: string): Promise<void> {
    const leaseId = leaseIdRef.current
    if (!leaseId || isPreview || !window.desktopApi || browserBusy || tabId === browserState?.activeTabId) return
    setBrowserBusy(true)
    try {
      const state = await window.desktopApi.accounts.activateWorkspaceTab(leaseId, tabId)
      setBrowserState((current) => mergeWorkspaceBrowserState(current, state))
    } catch (reason) {
      onError(reason)
    } finally {
      setBrowserBusy(false)
    }
  }

  async function openShortcut(shortcut: TmallWorkspaceShortcut): Promise<void> {
    const leaseId = leaseIdRef.current
    if (!leaseId || account.platform !== 'tmall' || isPreview || !window.desktopApi || browserBusy || closing) return
    setBrowserBusy(true)
    try {
      const state = await window.desktopApi.accounts.openWorkspaceShortcut(leaseId, shortcut)
      setBrowserState((current) => mergeWorkspaceBrowserState(current, state))
    } catch (reason) {
      onError(reason)
    } finally {
      setBrowserBusy(false)
    }
  }

  async function closeTab(tabId: string): Promise<void> {
    const leaseId = leaseIdRef.current
    if (!leaseId || isPreview || !window.desktopApi || browserBusy) return
    setBrowserBusy(true)
    try {
      const state = await window.desktopApi.accounts.closeWorkspaceTab(leaseId, tabId)
      setBrowserState((current) => mergeWorkspaceBrowserState(current, state))
    } catch (reason) {
      onError(reason)
    } finally {
      setBrowserBusy(false)
    }
  }

  const activeTab = browserState?.tabs.find((tab) => tab.active)

  return <div className="shop-workspace-shell">
    <div className="shop-workspace-toolbar">
      <div className="shop-workspace-title"><span className="state-dot online" /><strong>{platformLabel(account.platform)}-{account.shopName}</strong><Tag color={loginStatusColor(account.loginStatus)}>{loginStatusLabel(account.loginStatus)}</Tag></div>
      <div className="shop-browser-actions" role="toolbar" aria-label="店铺浏览器导航">
        <Button size="small" aria-label="后退" title="后退" disabled={!activeTab?.canGoBack || browserBusy || closing} onClick={() => void navigate('back')}><Icon name="back" /></Button>
        <Button size="small" aria-label="前进" title="前进" disabled={!activeTab?.canGoForward || browserBusy || closing} onClick={() => void navigate('forward')}><Icon name="forward" /></Button>
        <Button
          size="small"
          className={activeTab?.loading || browserBusy ? 'is-loading' : ''}
          aria-label={activeTab?.loading || browserBusy ? '正在刷新' : '刷新'}
          title={activeTab?.loading || browserBusy ? '正在刷新' : '刷新当前标签'}
          disabled={!activeTab || activeTab.loading || browserBusy || closing}
          onClick={() => void navigate('reload')}
        ><Icon name="refresh" /></Button>
      </div>
      <Space className="shop-workspace-operations" size={8}>
        {account.platform === 'tmall' ? <div className="shop-workspace-shortcuts" role="group" aria-label="天猫后台快捷入口">
          <Button size="small" disabled={browserBusy || closing} onClick={() => void openShortcut('sycm')}>生意参谋</Button>
          <Button size="small" disabled={browserBusy || closing} onClick={() => void openShortcut('wanxiang')}>万相台</Button>
          <Button size="small" disabled={browserBusy || closing} onClick={() => void openShortcut('seller')}>卖家首页</Button>
        </div> : null}
        <Button size="small" loading={closing} disabled={closing} onClick={onBack}>返回账号环境</Button>
        <Button size="small" loading={action === 'check'} disabled={action !== null || closing} onClick={onCheck}>检测登录</Button>
        {action === 'probe'
          ? <Button size="small" danger disabled={closing} onClick={onCancel}>取消采集</Button>
          : <Button size="small" type="primary" ghost disabled={action !== null || closing || account.platform !== 'tmall'} onClick={onProbe}>抓取昨日数据</Button>}
      </Space>
    </div>
    {action === 'probe' && progress ? <div className="collection-progress" role="status">
      <div><strong>{progress.message}</strong><span>{formatElapsed(progress.elapsedMs)}</span></div>
      <div className="collection-progress-track"><span style={{ width: `${collectionProgressPercent(progress)}%` }} /></div>
    </div> : null}
    <div className="shop-workspace-tabs" role="tablist" aria-label="当前账号浏览标签">
      {browserState?.tabs.map((tab) => <div key={tab.tabId} className={`shop-workspace-tab ${tab.active ? 'active' : ''}`} role="tab" aria-selected={tab.active}>
        <button type="button" className="shop-workspace-tab-select" title={tab.title} disabled={browserBusy} onClick={() => void activateTab(tab.tabId)}>
          {tab.loading ? <span className="shop-tab-loading" /> : <span className="shop-tab-icon">▣</span>}
          <span>{tab.title}</span>
        </button>
        {tab.closable ? <button type="button" className="shop-workspace-tab-close" aria-label={`关闭 ${tab.title}`} disabled={browserBusy} onClick={() => void closeTab(tab.tabId)}>×</button> : null}
      </div>)}
      {!browserState ? <div className="shop-workspace-tab active pending"><span className="shop-tab-loading" />正在打开…</div> : null}
    </div>
    <div className="shop-workspace-host" ref={hostRef}>
      <div className="shop-workspace-loading">
        <span className="state-dot online" />
        <strong>{platformLabel(account.platform)}-{account.shopName}</strong>
        <span>{isPreview ? '浏览器预览无法加载真实店铺后台，请启动 Electron 主程序。' : '正在使用该账号的独立登录环境加载店铺后台…'}</span>
      </div>
    </div>
  </div>
}

function collectionProgressPercent(progress: CollectionProgress): number {
  if (progress.stage === 'completed') return 100
  if (progress.stage === 'normalizing') return 86
  if (progress.stage === 'persisting_report') return 94
  if (progress.pageIndex) {
    const pageBase = ((progress.pageIndex - 1) / Math.max(progress.pageCount, 1)) * 80
    const stageOffset = progress.stage === 'navigating' ? 2 : progress.stage === 'capturing' ? 9 : 14
    return Math.min(84, Math.round(pageBase + stageOffset))
  }
  return progress.stage === 'precheck' ? 3 : 0
}

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function Dashboard({ accounts, isPreview, progress, onNotify }: { accounts: AccountSummary[]; isPreview: boolean; progress: Record<string, CollectionProgress>; onNotify: (notification: NotificationInput) => void }): React.JSX.Element {
  const [dataset, setDataset] = useState<ReportDataset | null>(null)
  const [loading, setLoading] = useState(!isPreview)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(shanghaiYesterday)
  const [shopFilter, setShopFilter] = useState('all')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [updating, setUpdating] = useState(false)
  const [updateResult, setUpdateResult] = useState<{ type: 'success' | 'info' | 'warning' | 'error'; title: string; description: string } | null>(null)
  const today = shanghaiToday()
  const effectiveAccounts = [...new Map(accounts.filter(({ enabled }) => enabled).map((account) => [`${account.platform}/${account.shopId}`, account])).values()]
  const platformKeys = [...new Set(effectiveAccounts.map(({ platform }) => platform))].sort()
  const filteredAccounts = shopFilter === 'all'
    ? effectiveAccounts
    : shopFilter.startsWith('platform:')
      ? effectiveAccounts.filter(({ platform }) => platform === shopFilter.slice('platform:'.length))
      : effectiveAccounts.filter(({ accountId }) => `shop:${accountId}` === shopFilter)
  const filterOptions = [
    { label: '全部范围', options: [{ value: 'all', label: `所有店铺（${effectiveAccounts.length} 家）` }] },
    ...platformKeys.map((platform) => {
      const platformAccounts = effectiveAccounts.filter((account) => account.platform === platform)
      return {
        label: `${platformLabel(platform)}平台`,
        options: [
          { value: `platform:${platform}`, label: `${platformLabel(platform)}平台（${platformAccounts.length} 家）` },
          ...platformAccounts.map((account) => ({ value: `shop:${account.accountId}`, label: `${platformLabel(platform)} · ${account.shopName}` }))
        ]
      }
    })
  ]
  const accountSignature = filteredAccounts.map(({ accountId, platform, shopId }) => `${accountId}:${platform}:${shopId}`).sort().join('|')
  const selectedPlatforms = [...new Set(filteredAccounts.map(({ platform }) => platform))]
  const selectedShopIds = [...new Set(filteredAccounts.map(({ shopId }) => shopId))]
  const selectedShop = filteredAccounts.length === 1 && shopFilter.startsWith('shop:') ? filteredAccounts[0] : null
  const filterLabel = shopFilter === 'all' ? '所有店铺' : selectedShop ? selectedShop.shopName : `${platformLabel(selectedPlatforms[0] ?? '')}平台`
  useEffect(() => {
    if (shopFilter !== 'all' && filteredAccounts.length === 0) setShopFilter('all')
  }, [accountSignature, shopFilter])
  useEffect(() => setUpdateResult(null), [selectedDate, shopFilter])
  useEffect(() => {
    if (isPreview || !window.desktopApi || filteredAccounts.length === 0) { setDataset(null); setLoading(false); return }
    setLoading(true)
    window.desktopApi.reports.query({ reportType: 'tmall_daily_dashboard', dateStart: selectedDate, dateEnd: selectedDate, platforms: selectedPlatforms, shopIds: selectedShopIds, ownerIds: [] })
      .then((value) => { setDataset(value); setLoadError(null) })
      .catch((reason: unknown) => setLoadError(errorMessage(reason)))
      .finally(() => setLoading(false))
  }, [accountSignature, isPreview, selectedDate, reloadVersion])
  useEffect(() => {
    if (loadError) onNotify({ id: `dashboard:error:${shopFilter}:${selectedDate}`, tone: 'error', title: '仪表盘数据读取失败', description: loadError })
  }, [loadError, onNotify, selectedDate, shopFilter])
  useEffect(() => {
    if (!dataset || dataset.meta.data_status === 'empty') return
    const complete = dataset.quality.status === 'complete'
    onNotify({
      id: `dashboard:quality:${dataset.dataset_id}`,
      tone: complete ? 'success' : 'warning',
      title: `${dataset.meta.shop_name} · ${dataset.meta.biz_date} · ${complete ? '数据完整' : '部分完整'}`,
      description: `已生成 ${dataset.quality.dataset_count} 类数据；更新时间 ${new Date(dataset.meta.updated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}${dataset.quality.warnings.length > 0 ? `；${dataset.quality.warnings.join('；')}` : ''}`
    })
  }, [dataset, onNotify])

  async function updateSelectedStores(): Promise<void> {
    if (isPreview || !window.desktopApi || filteredAccounts.length === 0) return
    setUpdating(true)
    setUpdateResult(null)
    try {
      const result = await window.desktopApi.reports.update({ bizDate: selectedDate, platforms: selectedPlatforms, shopIds: selectedShopIds })
      const hasProblem = result.failed > 0 || result.needLogin > 0
      const summary = `有效店铺 ${result.total} 家：更新 ${result.updated}、已有数据跳过 ${result.skipped}、待登录 ${result.needLogin}、失败 ${result.failed}。`
      const problems = result.shops.filter(({ status }) => status === 'NEED_HUMAN_LOGIN' || status === 'FAILED').map(({ shopName, status, warning }) => `${shopName}：${status === 'NEED_HUMAN_LOGIN' ? '登录已失效' : '采集失败'}${warning ? `（${warning}）` : ''}`)
      const description = [summary, ...problems].join(' ')
      const title = hasProblem ? `数据更新未完成 · ${result.bizDate}` : result.skipped === result.total ? `数据已经是最新状态 · ${result.bizDate}` : `数据更新完成 · ${result.bizDate}`
      const type = hasProblem ? 'warning' : result.skipped === result.total ? 'info' : 'success'
      setUpdateResult({ type, title, description })
      onNotify({ id: `dashboard:update:${shopFilter}:${result.bizDate}`, tone: hasProblem ? 'warning' : 'success', title, description })
      setReloadVersion((value) => value + 1)
    } catch (reason) {
      const description = errorMessage(reason)
      setLoadError(description)
      setUpdateResult({ type: 'error', title: `数据更新失败 · ${selectedDate}`, description })
      onNotify({ id: `dashboard:update-error:${shopFilter}:${selectedDate}`, tone: 'error', title: '数据更新失败', description })
    } finally {
      setUpdating(false)
    }
  }

  async function cancelUpdate(): Promise<void> {
    if (!window.desktopApi) return
    await window.desktopApi.reports.cancelUpdate()
  }

  const dateLabel = selectedDate === today ? '今日' : selectedDate === shanghaiYesterday() ? '昨日' : selectedDate
  const activeProgress = filteredAccounts.map(({ accountId }) => progress[accountId]).find((value) => value && value.bizDate === selectedDate && value.stage !== 'completed' && value.stage !== 'failed' && value.stage !== 'cancelled')
  const updateButtonLabel = shopFilter === 'all' ? '更新全部有效店铺' : selectedShop ? '更新当前店铺' : `更新${platformLabel(selectedPlatforms[0] ?? '')}平台`
  const toolbar = <>
    <div className="dashboard-toolbar">
      <div className="dashboard-filter-controls">
        <div className="dashboard-shop-control"><label htmlFor="dashboard-shop-filter">店铺筛选</label><Select id="dashboard-shop-filter" value={shopFilter} options={filterOptions} disabled={updating || effectiveAccounts.length === 0} onChange={(value) => { setShopFilter(value); setLoadError(null) }} /></div>
        <div className="dashboard-date-control"><label htmlFor="dashboard-biz-date">数据日期</label><input id="dashboard-biz-date" type="date" value={selectedDate} max={today} disabled={updating} onChange={(event) => { if (event.target.value && event.target.value <= today) { setSelectedDate(event.target.value) } }} /><Button size="small" disabled={updating || selectedDate === today} onClick={() => setSelectedDate(today)}>今天</Button><Button size="small" disabled={updating || selectedDate === shanghaiYesterday()} onClick={() => setSelectedDate(shanghaiYesterday())}>昨天</Button></div>
      </div>
      <div className="dashboard-update-control">{updating && activeProgress ? <span className="dashboard-update-progress">{activeProgress.message} · {formatElapsed(activeProgress.elapsedMs)}</span> : null}{updating ? <Button danger onClick={() => void cancelUpdate()}>取消更新</Button> : <Button type="primary" disabled={isPreview || filteredAccounts.length === 0} onClick={() => void updateSelectedStores()}>{updateButtonLabel}</Button>}</div>
    </div>
    {updateResult ? <Alert className="dashboard-update-result" type={updateResult.type} showIcon closable message={updateResult.title} description={updateResult.description} onClose={() => setUpdateResult(null)} /> : null}
  </>

  if (isPreview) return <>{toolbar}<DemoDashboard /></>
  if (loading) return <>{toolbar}<div className="empty-state"><h2>正在读取 {selectedDate} 仪表盘数据…</h2><p>数据仅从本地 Report Dataset 加载。</p></div></>
  if (effectiveAccounts.length === 0) return <>{toolbar}<div className="empty-state"><h2>尚未配置可用店铺</h2><p>请先在“系统 → 账号环境”添加并启用账号。</p></div></>
  if (loadError) return <>{toolbar}<div className="empty-state"><h2>仪表盘数据暂时无法读取</h2><p>请查看右上角通知了解具体原因。</p></div></>
  if (!dataset || dataset.meta.data_status === 'empty') return <>{toolbar}<div className="empty-state"><h2>{filterLabel}尚无 {selectedDate} 的采集数据</h2><p>点击“{updateButtonLabel}”采集该自然日数据；今天的数据可重复刷新。</p></div></>

  const summary = dataset.summary
  const refundAmt = nullableNumeric(summary['refund_amt'])
  const refundReportedShopCount = nullableNumeric(summary['refund_reported_shop_count']) ?? (refundAmt === null ? 0 : selectedShopIds.length)
  const refundMissingShopCount = nullableNumeric(summary['refund_missing_shop_count']) ?? Math.max(0, selectedShopIds.length - refundReportedShopCount)
  const refundCoverage = refundMissingShopCount > 0 ? ` · 覆盖 ${refundReportedShopCount}/${refundReportedShopCount + refundMissingShopCount} 家` : ''
  const shopOverviewRows = dataset.sections.shop_overview ?? [{
    shop_id: dataset.filters.shopIds[0] ?? null,
    shop_name: dataset.meta.shop_name || filterLabel,
    platform: dataset.filters.platforms[0] ?? null,
    biz_date: dataset.meta.biz_date,
    pay_amt: summary['pay_amt'] ?? null,
    visitor_count: summary['visitor_count'] ?? null,
    pay_rate: summary['pay_rate'] ?? null,
    refund_amt: summary['refund_amt'] ?? null,
    ad_spend: summary['ad_spend'] ?? null,
    data_status: dataset.quality.status,
    warning_count: dataset.quality.warning_count,
    data_finality: dataset.meta.data_finality ?? null
  }]
  const trendOption = reportTrendOption(dataset)
  return <>
    {toolbar}
    <section className="metric-grid dashboard-metric-grid" aria-label={`${dateLabel}核心经营指标`}>
      <MetricCard label={`${dateLabel}支付金额`} value={currency(summary['pay_amt'])} change="生意参谋" tone="accent" />
      <MetricCard label="支付子订单数" value={integer(summary['pay_order_count'])} change={`${dateLabel}各店铺合计`} />
      <MetricCard label="访客数" value={integer(summary['visitor_count'])} change={`${dateLabel}自然日`} />
      <MetricCard label="支付转化率" value={percent(summary['pay_rate'])} change="支付买家 / 访客" />
      <MetricCard label="客单价" value={currency(summary['customer_unit_price'])} change="支付金额 / 买家" />
      <MetricCard label={refundMissingShopCount > 0 ? '已知成功退款金额' : '成功退款金额'} value={currency(refundAmt)} change={`退款影响率 ${percent(summary['refund_rate'])}${refundCoverage}`} tone={numeric(refundAmt) > 0 ? 'danger' : 'success'} />
      <MetricCard label="广告消耗" value={currency(summary['ad_spend'])} change={`整体 ROI ${decimal(summary['ad_roi'])}`} tone="danger" />
    </section>
    <section className="chart-grid primary-grid dashboard-overview-grid">
      <Panel title={`${dateLabel}经营数据`} subtitle={`${dataset.meta.biz_date} · 支付、退款与广告消耗`} className="wide-panel"><EChart option={trendOption} height={280} ariaLabel="支付、退款与广告消耗图" /></Panel>
      <Panel title="店铺概况" subtitle={`${selectedDate} · ${shopOverviewRows.length} 个店铺`} className="shop-overview-panel"><ShopOverviewList rows={shopOverviewRows} /></Panel>
    </section>
    <section className="chart-grid secondary-grid">
      <Panel title="流量来源" subtitle="生意参谋来源 Top"><ReportTable rows={dataset.sections.channels} columns={[['source_name', '来源'], ['visitor_count', '访客'], ['page_view_count', '浏览'], ['pay_amt', '支付金额']]} /></Panel>
      <Panel title="商品表现" subtitle={`${dataset.shop_rows.length} 个商品`} className="ranking-panel"><ReportTable rows={dataset.shop_rows} columns={[['item_title', '商品'], ['visitor_count', '访客'], ['page_view_count', '浏览'], ['pay_amt', '支付金额']]} /></Panel>
    </section>
    <section className="chart-grid secondary-grid">
      <Panel title="搜索关键词" subtitle="生意参谋关键词 Top"><ReportTable rows={dataset.sections.keywords ?? []} columns={[["keyword", "关键词"], ["visitor_count", "访客"], ["page_view_count", "浏览"], ["pay_amt", "支付金额"]]} /></Panel>
      <Panel title="客服服务" subtitle={`已读取 ${dataset.sections.service.length} 项客服指标`}><ReportTable rows={dataset.sections.service.slice(0, 10)} columns={[["name", "指标"], ["value", "所选日期值"]]} /></Panel>
    </section>
    <Panel title="数据覆盖与限制" subtitle="仪表盘不会把缺失数据写成 0"><ul className="quality-warning-list">{dataset.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></Panel>
  </>
}

function DemoDashboard(): React.JSX.Element {
  return <>
    <section className="metric-grid" aria-label="核心经营指标">
      <MetricCard label="月度销售总额" value="¥128,596" change="↑ 12.4%" tone="accent" />
      <MetricCard label="月度销量" value="8,932" change="↑ 8.1%" />
      <MetricCard label="广告支出" value="¥24,380" change="↓ 3.2%" tone="danger" negative />
      <MetricCard label="客单价" value="¥142.6" change="↑ 5.7%" />
      <MetricCard label="退款率" value="3.21%" change="↓ 0.4%" tone="success" />
    </section>
    <section className="chart-grid primary-grid"><Panel title="销售额走势" subtitle="近 30 天 · 单位：元" className="wide-panel"><EChart option={salesTrendOption} height={280} ariaLabel="销售额走势折线图" /></Panel><Panel title="平台订单占比" subtitle="按支付订单数"><EChart option={platformOption} height={280} ariaLabel="平台订单占比环形图" /></Panel></section>
    <section className="chart-grid secondary-grid"><Panel title="销量走势" subtitle="本月周度销量"><EChart option={volumeOption} height={245} ariaLabel="周度销量柱状图" /></Panel><Panel title="店铺销售额排名" subtitle="按支付金额排序" className="ranking-panel"><RankingTable /></Panel></section>
  </>
}

function ReportTable({ rows, columns }: { rows: Array<Record<string, string | number | null>>; columns: Array<[string, string]> }): React.JSX.Element {
  if (rows.length === 0) return <div className="report-empty">本次未返回记录</div>
  return <div className="ranking-table-wrap"><table className="ranking-table"><thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map(([key]) => <td key={key} title={String(row[key] ?? '')}>{key.includes('amt') ? currency(row[key]) : String(row[key] ?? '—')}</td>)}</tr>)}</tbody></table></div>
}

function ShopOverviewList({ rows }: { rows: Array<Record<string, string | number | null>> }): React.JSX.Element {
  if (rows.length === 0) return <div className="report-empty">所选范围暂无店铺数据</div>
  return <div className="shop-overview-list">{rows.map((row, index) => <article className="shop-overview-card" key={`${String(row['shop_id'] ?? row['shop_name'])}-${index}`}>
    <div className="shop-overview-heading"><strong>{String(row['shop_name'] ?? '未命名店铺')}</strong></div>
    <div className="shop-overview-metrics">
      <span>支付金额 <b>{currency(row['pay_amt'])}</b></span>
      <span>访客数 <b>{nullableInteger(row['visitor_count'])}</b></span>
      <span>退款金额 <b>{currency(row['refund_amt'])}</b></span>
      <span>广告消耗 <b>{currency(row['ad_spend'])}</b></span>
    </div>
  </article>)}</div>
}

function reportTrendOption(dataset: ReportDataset): DashboardChartOption {
  const dates = dataset.trend.map((row) => String(row['date'] ?? ''))
  return {
    animationDuration: 400,
    grid: { left: 12, right: 12, top: 30, bottom: 8, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    tooltip: { trigger: 'axis' }, legend: { top: 0, right: 8 },
    xAxis: { type: 'category' as const, data: dates, axisTick: { show: false } }, yAxis: { type: 'value' as const },
    series: [
      { name: '支付金额', type: 'bar' as const, data: dataset.trend.map((row) => numeric(row['pay_amt'])), itemStyle: { color: '#2383e2', borderRadius: [5, 5, 0, 0] } },
      { name: '退款金额', type: 'line' as const, data: dataset.trend.map((row) => nullableNumeric(row['refund_amt'])), lineStyle: { width: 2, color: '#e0533d' }, itemStyle: { color: '#e0533d' } },
      { name: '广告消耗', type: 'line' as const, data: dataset.trend.map((row) => numeric(row['ad_spend'])), lineStyle: { width: 3, color: '#f0a43c' }, itemStyle: { color: '#f0a43c' } }
    ]
  }
}

function numeric(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
function nullableNumeric(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function currency(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—' }
function integer(value: unknown): string { return Math.round(numeric(value)).toLocaleString('zh-CN') }
function nullableInteger(value: unknown): string { const number = nullableNumeric(value); return number === null ? '—' : Math.round(number).toLocaleString('zh-CN') }
function decimal(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—' }
function percent(value: unknown): string { if (typeof value !== 'number' || !Number.isFinite(value)) return '—'; return `${(Math.abs(value) <= 1 ? value * 100 : value).toFixed(2)}%` }
function shanghaiYesterday(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 86_400_000)) }
function shanghaiToday(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }

function isExactCompletedReport(report: ReportDataset, account: AccountSummary, bizDate: string): boolean {
  return report.meta.data_status === 'real'
    && (report.meta.collection_status === 'completed' || !('collection_status' in report.meta))
    && report.meta.biz_date === bizDate
    && report.filters.dateStart === bizDate
    && report.filters.dateEnd === bizDate
    && report.filters.platforms.includes('tmall')
    && report.filters.shopIds.includes(account.shopId)
    && report.quality.dataset_count >= 6
    && report.source_paths.filter((path) => path.includes('/raw/')).length >= 5
    && report.source_paths.filter((path) => path.includes('/normalized/')).length >= 6
}

function completedCollectionMessage(report: ReportDataset, bizDate: string): string {
  const coverage = report.quality.status === 'complete' ? '完整' : '部分完整'
  return `昨日数据采集任务已经完成：目标日期 ${bizDate}（Asia/Shanghai），数据覆盖状态为“${coverage}”。本次未重复执行。`
}

function RankingTable(): React.JSX.Element {
  return <div className="ranking-table-wrap"><table className="ranking-table"><thead><tr><th>排名</th><th>店铺</th><th>平台</th><th>趋势</th><th className="numeric">销售额</th></tr></thead><tbody>{rankingRows.map((row) => <tr key={row.rank}><td><span className={`rank-badge rank-${row.rank}`}>{row.rank}</span></td><td className="shop-name">{row.shop}</td><td><span className="platform-chip">{row.platform}</span></td><td className={row.trend.startsWith('-') ? 'trend-down' : 'trend-up'}>{row.trend}</td><td className="numeric amount">{row.amount}</td></tr>)}</tbody></table></div>
}

function MetricCard({ label, value, change, tone = 'default', negative = false }: { label: string; value: string; change: string; tone?: 'default' | 'accent' | 'danger' | 'success'; negative?: boolean }): React.JSX.Element {
  return <article className={`metric-card tone-${tone}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className={`metric-change ${negative ? 'negative' : ''}`}>{change}</div></article>
}

function Panel({ title, subtitle, className = '', children }: { title: string; subtitle: string; className?: string; children: React.ReactNode }): React.JSX.Element {
  return <article className={`data-panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</article>
}

interface AccountFormValues extends CreateAccountInput {
  openAfterCreate: boolean
  loginUsername: string
  loginPassword: string
  saveCredentialConfirmed: boolean
}

interface AccountEditFormValues extends UpdateAccountInput {
  loginUsername?: string
  loginPassword?: string
  saveCredentialConfirmed?: boolean
}

const ACCOUNT_PLATFORM_OPTIONS: { value: AccountPlatform; label: string; prefix: string }[] = [
  { value: 'tmall', label: '天猫', prefix: 'T' },
  { value: 'pinduoduo', label: '拼多多', prefix: 'P' },
  { value: 'taobao', label: '淘宝', prefix: 'T' },
  { value: 'jd', label: '京东', prefix: 'J' },
  { value: 'douyin', label: '抖店', prefix: 'D' },
  { value: 'kuaishou', label: '快手', prefix: 'K' },
  { value: 'wechat_channels', label: '视频号', prefix: 'Q' },
  { value: '1688', label: '1688', prefix: 'A' }
]

function AccountsView({ accounts, isPreview, onAccountsChanged, onShopAction }: { accounts: AccountSummary[]; isPreview: boolean; onAccountsChanged: () => Promise<void>; onShopAction: (account: AccountSummary, action: ShopAction) => void }): React.JSX.Element {
  const [form] = Form.useForm<AccountFormValues>()
  const selectedPlatform = Form.useWatch('platform', form) ?? 'tmall'
  const selectedPlatformOption = ACCOUNT_PLATFORM_OPTIONS.find(({ value }) => value === selectedPlatform) ?? ACCOUNT_PLATFORM_OPTIONS[0]!
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [credentialForm] = Form.useForm<AccountCredentialInput>()
  const [credentialAccount, setCredentialAccount] = useState<AccountSummary | null>(null)
  const [savingCredential, setSavingCredential] = useState(false)
  const [editForm] = Form.useForm<AccountEditFormValues>()
  const [editingAccount, setEditingAccount] = useState<AccountSummary | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [messageApi, messageContext] = message.useMessage()
  const onboardingAccount = accounts.find(({ loginStatus }) => loginStatus === 'authenticated') ?? accounts[0]
  const flowStep = onboardingAccount?.loginStatus === 'authenticated' ? 2 : onboardingAccount ? 1 : 0

  async function createAccount(): Promise<void> {
    try {
      const values = await form.validateFields()
      setSaving(true)
      if (isPreview || !window.desktopApi) {
        messageApi.info('浏览器预览已验证表单；配置不会写入本地。')
      } else {
        const { openAfterCreate, loginUsername, loginPassword, saveCredentialConfirmed, ...input } = values
        const created = await window.desktopApi.accounts.create(input)
        try {
          await window.desktopApi.accounts.setCredentials(created.accountId, {
            username: loginUsername,
            password: loginPassword,
            authorizationConfirmed: saveCredentialConfirmed
          })
        } catch (reason) {
          await onAccountsChanged()
          messageApi.warning(`账号环境已创建，但登录凭据保存失败；请稍后使用“登录设置”重试：${errorMessage(reason)}`)
          setModalOpen(false)
          form.resetFields()
          return
        }
        await onAccountsChanged()
        messageApi.success(`${platformLabel(created.platform)}账号环境已创建`)
        if (openAfterCreate) onShopAction(created, 'open')
      }
      setModalOpen(false)
      form.resetFields()
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'errorFields' in reason) return
      messageApi.error(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  async function saveCredentials(): Promise<void> {
    if (!credentialAccount) return
    try {
      const values = await credentialForm.validateFields()
      setSavingCredential(true)
      if (isPreview || !window.desktopApi) {
        messageApi.info('浏览器预览只验证凭据表单，不保存任何内容。')
      } else {
        await window.desktopApi.accounts.setCredentials(credentialAccount.accountId, values)
        await onAccountsChanged()
        messageApi.success('登录凭据已使用本机系统安全存储加密保存')
      }
      setCredentialAccount(null)
      credentialForm.resetFields()
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'errorFields' in reason) return
      messageApi.error(errorMessage(reason))
    } finally {
      setSavingCredential(false)
    }
  }

  function openEdit(account: AccountSummary): void {
    setEditingAccount(account)
    editForm.setFieldsValue({
      shopName: account.shopName,
      subaccountName: account.subaccountName,
      owner: account.owner,
      loginUsername: '',
      loginPassword: '',
      saveCredentialConfirmed: false
    })
  }

  async function saveAccountEdit(): Promise<void> {
    if (!editingAccount) return
    try {
      const values = await editForm.validateFields()
      const username = values.loginUsername?.trim() ?? ''
      const password = values.loginPassword ?? ''
      if (Boolean(username) !== Boolean(password)) {
        messageApi.warning('更新登录凭据时，用户名和密码必须同时填写。')
        return
      }
      if ((username || password) && !values.saveCredentialConfirmed) {
        messageApi.warning('请确认同意在本机加密保存登录凭据。')
        return
      }
      setSavingEdit(true)
      if (isPreview || !window.desktopApi) {
        messageApi.info('浏览器预览只验证编辑表单，不保存账号信息。')
      } else {
        await window.desktopApi.accounts.update(editingAccount.accountId, {
          shopName: values.shopName,
          subaccountName: values.subaccountName,
          owner: values.owner
        })
        if (username && password) {
          try {
            await window.desktopApi.accounts.setCredentials(editingAccount.accountId, { username, password, authorizationConfirmed: true })
          } catch (reason) {
            await onAccountsChanged()
            messageApi.warning(`店铺基础信息已保存，但登录凭据更新失败：${errorMessage(reason)}`)
            return
          }
        }
        await onAccountsChanged()
        messageApi.success(username ? '店铺信息和加密登录凭据已更新' : '店铺信息已更新，原登录凭据保持不变')
      }
      setEditingAccount(null)
      editForm.resetFields()
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'errorFields' in reason) return
      messageApi.error(errorMessage(reason))
    } finally {
      setSavingEdit(false)
    }
  }

  return <>
    {messageContext}
    <section className="account-flow" aria-label="账号接入流程">
      <div className="flow-copy"><span className="flow-kicker">多平台账号接入</span><h2>从授权子账号到登录状态确认</h2><p>用户名和密码独立使用系统加密保存在本地硬盘中；登录过程中遇到验证码始终由必须由人工协助处理。</p></div>
      <Steps size="small" current={flowStep} items={[{ title: '添加配置' }, { title: '人工登录' }, { title: '检测状态' }]} />
    </section>
    <article className="data-panel table-view account-panel"><div className="panel-heading"><div><h2>账号环境</h2><p>每个子账号使用独立持久 Session 与下载目录</p></div><Button type="primary" onClick={() => { form.resetFields(); setModalOpen(true) }}>添加账号</Button></div>
      {isPreview ? <div className="inline-note">以下账号仅用于浏览器视觉预览；可打开添加表单，但不会写入本地配置。</div> : null}
      <Table<AccountSummary> rowKey="accountId" dataSource={accounts} pagination={false} scroll={{ x: 940 }} locale={{ emptyText: '尚未配置账号。点击“添加账号”开始。' }} columns={[
        { title: '平台', dataIndex: 'platform', width: 72, render: (platform: string) => platformLabel(platform) },
        { title: '店铺 / 子账号', dataIndex: 'shopName', width: 200, render: (_, account) => <div className="account-identity"><strong>{account.shopName}</strong><span>{account.subaccountName}</span></div> },
        { title: '店铺标识', dataIndex: 'shopId', width: 120 },
        { title: '负责人', dataIndex: 'owner', width: 75 },
        { title: '登录状态', dataIndex: 'loginStatus', width: 100, render: (status: LoginState) => <Tag color={loginStatusColor(status)}>{loginStatusLabel(status)}</Tag> },
        { title: '最近检测', dataIndex: 'lastLoginCheckedAt', width: 113, render: (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚未检测' },
        { title: '操作', fixed: 'right', width: 338, render: (_, account) => <Space size={6}>
          <Button size="small" onClick={() => { setCredentialAccount(account); credentialForm.resetFields() }}>登录设置</Button>
          <Button size="small" disabled={!account.enabled} onClick={() => onShopAction(account, 'open')}>打开环境</Button>
          <Button size="small" disabled={!account.enabled} onClick={() => onShopAction(account, 'check')}>检测登录</Button>
          <Button size="small" type="primary" ghost onClick={() => openEdit(account)}>编辑</Button>
        </Space> }
      ]} />
    </article>
    <Modal title="添加账号说明" open={modalOpen} onCancel={() => { setModalOpen(false); form.resetFields() }} onOk={() => void createAccount()} okText="保存配置" cancelText="取消" confirmLoading={saving} width={620} destroyOnHidden>
      <Alert className="account-form-alert" type="info" showIcon title="仅配置合法授权的商家子账号" description="账号配置只保存加密凭据引用；用户名和密码单独由本机系统安全存储加密，不进入业务 JSON 或日志。验证码和平台风控不会被绕过。" />
      <Form<AccountFormValues> form={form} layout="vertical" requiredMark={false} initialValues={{ platform: 'tmall', authorizationConfirmed: false, saveCredentialConfirmed: false, openAfterCreate: true }}>
        <div className="form-grid">
          <Form.Item name="platform" label="平台" rules={[{ required: true }]}><Select options={ACCOUNT_PLATFORM_OPTIONS.map(({ value, label }) => ({ value, label }))} /></Form.Item>
          <Form.Item label="店铺标识" extra="保存时由系统按平台前缀和四位流水号自动分配。"><Input value={`系统自动分配（${selectedPlatformOption.label}：${selectedPlatformOption.prefix}XXXX）`} disabled /></Form.Item>
          <Form.Item name="shopName" label="店铺名称" rules={[{ required: true, whitespace: true, message: '请输入店铺名称' }, { max: 200 }]}><Input placeholder="例如 示例店铺7" autoComplete="off" /></Form.Item>
          <Form.Item name="subaccountName" label="子账号名称" rules={[{ required: true, whitespace: true, message: '请输入子账号名称' }, { max: 200 }]}><Input placeholder="仅用于内部识别" autoComplete="off" /></Form.Item>
          <Form.Item name="owner" label="负责人" rules={[{ required: true, whitespace: true, message: '请输入负责人' }, { max: 100 }]}><Input placeholder="例如 示例负责人乙" autoComplete="off" /></Form.Item>
          <Form.Item name="loginUsername" label="登录用户名" rules={[{ required: true, whitespace: true, message: '请输入登录用户名' }, { max: 320 }]}><Input placeholder="请输入平台登录用户名" autoComplete="off" /></Form.Item>
          <Form.Item name="loginPassword" label="登录密码" rules={[{ required: true, message: '请输入登录密码' }, { max: 1024 }]}><Input.Password placeholder="使用本机系统安全存储加密保存" autoComplete="new-password" /></Form.Item>
        </div>
        <Form.Item name="authorizationConfirmed" valuePropName="checked" rules={[{ validator: (_, checked: boolean) => checked ? Promise.resolve() : Promise.reject(new Error('请确认账号授权')) }]}><Checkbox>我确认该子账号已获得公司合法授权，并采用最小必要权限。</Checkbox></Form.Item>
        <Form.Item name="saveCredentialConfirmed" valuePropName="checked" rules={[{ validator: (_, checked: boolean) => checked ? Promise.resolve() : Promise.reject(new Error('请确认加密保存凭据')) }]}><Checkbox>{selectedPlatform === 'tmall' ? '我同意使用本机系统安全存储加密保存用户名和密码，用于会话失效后的单次自动登录。' : `我同意使用本机系统安全存储加密保存用户名和密码；${selectedPlatformOption.label}自动登录将在该平台适配完成后启用。`}</Checkbox></Form.Item>
        <Form.Item name="openAfterCreate" valuePropName="checked"><Checkbox>保存后立即在右侧打开店铺后台</Checkbox></Form.Item>
      </Form>
    </Modal>
    <Modal title={`登录设置 · ${credentialAccount ? `${platformLabel(credentialAccount.platform)}-${credentialAccount.shopName}` : ''}`} open={credentialAccount !== null} onCancel={() => { setCredentialAccount(null); credentialForm.resetFields() }} onOk={() => void saveCredentials()} okText="加密保存" cancelText="取消" confirmLoading={savingCredential} destroyOnHidden>
      <Alert className="account-form-alert" type="warning" showIcon title="凭据只保存在当前本机用户下" description="系统会在检测到官方登录页时自动填入并点击一次登录。出现验证码、登录失败或平台风控后立即停止，等待人工处理。" />
      <Form<AccountCredentialInput> form={credentialForm} layout="vertical" requiredMark="optional" initialValues={{ authorizationConfirmed: false }}>
        <Form.Item name="username" label="登录用户名" rules={[{ required: true, whitespace: true, message: '请输入登录用户名' }, { max: 320 }]}><Input placeholder="请输入平台登录用户名" autoComplete="off" /></Form.Item>
        <Form.Item name="password" label="登录密码" rules={[{ required: true, message: '请输入登录密码' }, { max: 1024 }]}><Input.Password placeholder="输入后使用系统加密保存" autoComplete="new-password" /></Form.Item>
        <Form.Item name="authorizationConfirmed" valuePropName="checked" rules={[{ validator: (_, checked: boolean) => checked ? Promise.resolve() : Promise.reject(new Error('请确认加密保存凭据')) }]}><Checkbox>我确认该账号已合法授权，并同意在本机加密保存登录凭据。</Checkbox></Form.Item>
      </Form>
    </Modal>
    <Modal title={`编辑账号 · ${editingAccount ? `${platformLabel(editingAccount.platform)}-${editingAccount.shopName}` : ''}`} open={editingAccount !== null} onCancel={() => { setEditingAccount(null); editForm.resetFields() }} onOk={() => void saveAccountEdit()} okText="保存修改" cancelText="取消" confirmLoading={savingEdit} width={620} forceRender>
      <Alert className="account-form-alert" type="info" showIcon title="账号身份与独立环境保持不变" description="店铺标识、平台和 Session 分区不可修改。登录用户名和密码留空时保留原加密凭据；系统不会回显已保存的密码。" />
      <Form<AccountEditFormValues> form={editForm} layout="vertical" requiredMark="optional">
        <div className="form-grid account-edit-grid">
          <Form.Item name="shopName" label="店铺名称" rules={[{ required: true, whitespace: true, message: '请输入店铺名称' }, { max: 200 }]}><Input autoComplete="off" /></Form.Item>
          <Form.Item name="subaccountName" label="子账号名称" rules={[{ required: true, whitespace: true, message: '请输入子账号名称' }, { max: 200 }]}><Input autoComplete="off" /></Form.Item>
          <Form.Item name="owner" label="负责人" rules={[{ required: true, whitespace: true, message: '请输入负责人' }, { max: 100 }]}><Input autoComplete="off" /></Form.Item>
          <Form.Item label="店铺标识（不可修改）"><Input value={editingAccount?.shopId ?? ''} disabled /></Form.Item>
          <Form.Item name="loginUsername" label="登录用户名（可选更新）" extra="与密码同时留空则保持原凭据。" rules={[{ max: 320 }]}><Input placeholder="填写后将覆盖原加密用户名" autoComplete="off" /></Form.Item>
          <Form.Item name="loginPassword" label="登录密码（可选更新）" rules={[{ max: 1024 }]}><Input.Password placeholder="填写后使用本机系统安全存储加密保存" autoComplete="new-password" /></Form.Item>
        </div>
        <Form.Item name="saveCredentialConfirmed" valuePropName="checked" rules={[{ validator: (_, checked: boolean) => {
          const changingCredential = Boolean(editForm.getFieldValue('loginUsername') || editForm.getFieldValue('loginPassword'))
          return !changingCredential || checked ? Promise.resolve() : Promise.reject(new Error('请确认加密保存凭据'))
        } }]}><Checkbox>如填写新用户名或密码，我确认账号已合法授权，并同意使用本机系统安全存储加密保存。</Checkbox></Form.Item>
      </Form>
    </Modal>
  </>
}

function platformLabel(platform: string): string {
  return ({ tmall: '天猫', pinduoduo: '拼多多', taobao: '淘宝', jd: '京东', douyin: '抖店', kuaishou: '快手', wechat_channels: '视频号', '1688': '1688' } as Record<string, string>)[platform] ?? platform
}

function loginStatusLabel(status: LoginState): string {
  return ({ unknown: '待登录', authenticated: '已登录', expired: '待登录', need_human_login: '待登录', captcha_required: '验证码', login_failed: '登录失败', locked: '账号锁定', disabled: '已禁用' } as Record<LoginState, string>)[status]
}

function loginStatusColor(status: LoginState): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'authenticated') return 'success'
  if (status === 'captcha_required' || status === 'login_failed' || status === 'locked') return 'error'
  if (status === 'disabled') return 'default'
  return 'warning'
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function SystemSettingsView({ isPreview, health, onRestartRequired }: { isPreview: boolean; health: SystemHealth | null; onRestartRequired: () => void }): React.JSX.Element {
  const [settings, setSettings] = useState<SystemStorageSettings | null>(null)
  const [localDataDirectory, setLocalDataDirectory] = useState('')
  const [environmentDataDirectory, setEnvironmentDataDirectory] = useState('')
  const [loading, setLoading] = useState(true)
  const [applyingDirectory, setApplyingDirectory] = useState<StorageDirectoryKind | null>(null)
  const [messageApi, messageContext] = message.useMessage()

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const next = isPreview || !window.desktopApi
          ? previewStorageSettings(health)
          : await window.desktopApi.system.getStorageSettings()
        setSettings(next)
        setLocalDataDirectory(next.localDataDirectory)
        setEnvironmentDataDirectory(next.environmentDataDirectory)
      } catch (reason) {
        messageApi.error(errorMessage(reason))
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [health, isPreview, messageApi])

  async function chooseDirectory(kind: StorageDirectoryKind): Promise<void> {
    if (isPreview || !window.desktopApi) {
      messageApi.info('当前为浏览器视觉预览；请启动 Electron 主程序后选择系统目录。')
      return
    }
    setApplyingDirectory(kind)
    try {
      const selected = await window.desktopApi.system.chooseStorageDirectory(kind)
      if (!selected) return
      const next = await window.desktopApi.system.updateStorageSettings({
        localDataDirectory: kind === 'local_data' ? selected : localDataDirectory,
        environmentDataDirectory: kind === 'environment_data' ? selected : environmentDataDirectory
      })
      setSettings(next)
      setLocalDataDirectory(next.localDataDirectory)
      setEnvironmentDataDirectory(next.environmentDataDirectory)
      if (next.restartRequired) {
        messageApi.warning('目录已保存，请手动重启主程序后继续使用。')
        onRestartRequired()
      }
    } catch (reason) {
      messageApi.error(errorMessage(reason))
    } finally {
      setApplyingDirectory(null)
    }
  }

  return <>
    {messageContext}
    {settings?.restartRequired ? <Alert className="settings-restart-alert" type="warning" showIcon title="目录设置已保存，等待重启生效" description="程序不会自动搬移原目录中的文件。确认旧数据已备份后再手工迁移；更换环境目录后，平台账号可能需要重新登录。" /> : null}
    <section className="settings-section">
      <div className="settings-section-heading"><div><h2>本地存储</h2><p>选择目录后自动保存，等待用户手动重启后应用新路径</p></div></div>
      <div className="settings-grid">
        <StorageDirectoryCard icon="folder" title="数据本地存储路径" description="账号配置、Raw、Normalized、Aggregate、报表数据集、下载和审计日志。" value={localDataDirectory} activeValue={settings?.activeLocalDataDirectory ?? ''} onChoose={() => void chooseDirectory('local_data')} disabled={loading || applyingDirectory !== null} loading={applyingDirectory === 'local_data'} />
        <StorageDirectoryCard icon="settings" title="程序环境数据存储目录" description="Electron 持久 Session、Cookie、缓存和平台登录环境。更换后可能需要重新登录。" value={environmentDataDirectory} activeValue={settings?.activeEnvironmentDataDirectory ?? ''} onChoose={() => void chooseDirectory('environment_data')} disabled={loading || applyingDirectory !== null} loading={applyingDirectory === 'environment_data'} />
      </div>
      <div className="storage-note"><strong>目录变更规则</strong><span>选择后立即保存并锁定其他功能；程序不会自动关闭，用户手动重启后新目录生效并自动解锁。</span></div>
      <div className="storage-note diagnostics-note"><strong>开发诊断日志</strong><span>{health?.developmentLogPath ?? '正在读取日志路径…'}</span></div>
    </section>
    <section className="settings-section remote-section">
      <div className="settings-section-heading"><div><h2>远程服务</h2><p>为后续集中备份、跨设备同步和远程采集预留</p></div></div>
      <div className="settings-grid">
        <ComingSoonCard icon="cloud" title="数据远程存储设置" description="对象存储、远程备份、同步策略和凭据管理将在后续版本提供。" />
        <ComingSoonCard icon="server" title="远程服务器设置" description="采集 Worker、服务器地址、连通性检测和安全认证将在后续版本提供。" />
      </div>
    </section>
  </>
}

function StorageDirectoryCard({ icon, title, description, value, activeValue, onChoose, disabled, loading }: { icon: IconName; title: string; description: string; value: string; activeValue: string; onChoose: () => void; disabled: boolean; loading: boolean }): React.JSX.Element {
  const pending = Boolean(value && activeValue && value !== activeValue)
  return <article className="setting-card"><div className="setting-card-heading"><span className="setting-icon"><Icon name={icon} /></span><div><h3>{title}</h3><p>{description}</p></div></div><div className="path-control"><Input value={value} readOnly placeholder="正在读取目录…" /><Button disabled={disabled} loading={loading} onClick={onChoose}>选择目录</Button></div><div className={`path-status ${pending ? 'pending' : ''}`}>{pending ? `当前生效：${activeValue}` : '当前配置已生效'}</div></article>
}

function ComingSoonCard({ icon, title, description }: { icon: IconName; title: string; description: string }): React.JSX.Element {
  return <article className="setting-card coming-soon"><div className="setting-card-heading"><span className="setting-icon muted"><Icon name={icon} /></span><div><div className="coming-title"><h3>{title}</h3><Tag>待开发</Tag></div><p>{description}</p></div></div><Button disabled block>暂不可配置</Button></article>
}

function previewStorageSettings(health: SystemHealth | null): SystemStorageSettings {
  const root = health?.dataRoot === '浏览器视觉预览' || !health?.dataRoot
    ? 'C:\\Users\\用户名\\AppData\\Roaming\\@ecommerce\\desktop\\app-data'
    : health.dataRoot
  return {
    localDataDirectory: root,
    environmentDataDirectory: 'C:\\Users\\用户名\\AppData\\Roaming\\@ecommerce\\desktop',
    activeLocalDataDirectory: root,
    activeEnvironmentDataDirectory: 'C:\\Users\\用户名\\AppData\\Roaming\\@ecommerce\\desktop',
    restartRequired: false,
    updatedAt: null,
    remoteStorageStatus: 'not_implemented',
    remoteServerStatus: 'not_implemented'
  }
}

function JobsView({ jobs, accounts, isPreview, onJobsChanged, onNotify }: { jobs: JobSummary[]; accounts: AccountSummary[]; isPreview: boolean; onJobsChanged: (jobs: JobSummary[]) => void; onNotify: (input: NotificationInput) => void }): React.JSX.Element {
  const [form] = Form.useForm<ScheduledJobInput>()
  const [editing, setEditing] = useState<JobSummary | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'executed'>('all')
  const platformOptions = [...new Set(accounts.filter(({ enabled, platform }) => enabled && platform === 'tmall').map(({ platform }) => platform))]
    .map((platform) => ({ value: platform, label: platformLabel(platform) }))
  const visibleJobs = jobs.filter((job) => filter === 'all' || (filter === 'pending'
    ? job.status === 'pending' || job.status === 'running' || job.status === 'disabled'
    : job.status === 'completed' || job.status === 'failed'))

  function openCreate(): void {
    setEditing(null)
    form.setFieldsValue({ name: '每日经营数据更新', scheduleTime: '08:30', platforms: ['all'], dateStrategy: 'yesterday', concurrency: 2, batchIntervalMinutes: 5, enabled: true })
    setModalOpen(true)
  }

  function openEdit(job: JobSummary): void {
    setEditing(job)
    form.setFieldsValue(toScheduledJobInput(job))
    setModalOpen(true)
  }

  async function reloadJobs(): Promise<void> {
    if (!window.desktopApi) return
    onJobsChanged(await window.desktopApi.jobs.list())
  }

  async function save(values: ScheduledJobInput): Promise<void> {
    if (isPreview || !window.desktopApi) {
      onNotify({ id: 'preview:scheduled-jobs', tone: 'info', title: '浏览器视觉预览', description: '定时采集任务只能在 Electron 主程序中保存。' })
      return
    }
    setSaving(true)
    try {
      const input = { ...values, platforms: values.platforms.includes('all') ? ['all'] : values.platforms }
      if (editing) await window.desktopApi.jobs.update(editing.jobId, input)
      else await window.desktopApi.jobs.create(input)
      await reloadJobs()
      setModalOpen(false)
      onNotify({ id: `scheduled-job:${editing?.jobId ?? 'created'}`, tone: 'success', title: editing ? '采集任务已更新' : '采集任务已创建', description: `${input.name}将在每天 ${input.scheduleTime}（Asia/Shanghai）执行。` })
    } catch (reason) {
      onNotify({ id: 'scheduled-job:save-error', tone: 'error', title: '采集任务保存失败', description: errorMessage(reason) })
    } finally {
      setSaving(false)
    }
  }

  async function runNow(job: JobSummary): Promise<void> {
    if (!window.desktopApi) return
    try {
      await window.desktopApi.jobs.run(job.jobId)
      await reloadJobs()
      onNotify({ id: `scheduled-job:${job.jobId}:running`, tone: 'info', title: '采集任务已开始', description: `${job.name} 正在按设定的并行数和批次间隔执行。` })
    } catch (reason) {
      onNotify({ id: `scheduled-job:${job.jobId}:run-error`, tone: 'error', title: '采集任务启动失败', description: errorMessage(reason) })
    }
  }

  function remove(job: JobSummary): void {
    Modal.confirm({
      title: '删除采集任务？',
      content: `将删除“${job.name}”的任务设置，已生成的数据不会删除。`,
      okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        if (!window.desktopApi) return
        await window.desktopApi.jobs.delete(job.jobId)
        await reloadJobs()
        onNotify({ id: `scheduled-job:${job.jobId}:deleted`, tone: 'success', title: '采集任务已删除', description: job.name })
      }
    })
  }

  const columns = [
    { title: '任务', key: 'name', render: (_: unknown, job: JobSummary) => <div className="job-name"><strong>{job.name}</strong><span>{job.dateStrategy === 'today' ? '采集当天' : '采集昨日'} · {job.timezone}</span></div> },
    { title: '执行计划', key: 'schedule', render: (_: unknown, job: JobSummary) => <div className="job-schedule"><strong>每天 {job.scheduleTime}</strong><span>{job.platforms.includes('all') ? '全部平台' : job.platforms.map(platformLabel).join('、')}</span></div> },
    { title: '批次策略', key: 'batch', render: (_: unknown, job: JobSummary) => <span>并行 {job.concurrency} 家<br/>间隔 {job.batchIntervalMinutes} 分钟</span> },
    { title: '状态', key: 'status', render: (_: unknown, job: JobSummary) => <Tag color={jobStatusColor(job.status)}>{jobStatusLabel(job.status)}</Tag> },
    { title: '下次执行', key: 'next', render: (_: unknown, job: JobSummary) => job.nextRunAt ? formatShanghaiDateTime(job.nextRunAt) : '—' },
    { title: '上次结果', key: 'last', render: (_: unknown, job: JobSummary) => job.lastCompletedAt ? <div className="job-last-result"><span>{formatShanghaiDateTime(job.lastCompletedAt)}</span><small>{job.lastResult ? `更新 ${job.lastResult.updated} · 跳过 ${job.lastResult.skipped} · 失败 ${job.lastResult.failed}` : job.lastError ?? '已结束'}</small></div> : '尚未执行' },
    { title: '操作', key: 'actions', fixed: 'right' as const, width: 190, render: (_: unknown, job: JobSummary) => <Space size={4}><Button size="small" type="link" disabled={job.status === 'running' || !job.enabled} onClick={() => void runNow(job)}>立即执行</Button><Button size="small" type="link" disabled={job.status === 'running'} onClick={() => openEdit(job)}>编辑</Button><Button size="small" type="link" danger disabled={job.status === 'running'} onClick={() => remove(job)}>删除</Button></Space> }
  ]

  return <section className="data-panel jobs-panel">
    <div className="panel-heading jobs-heading"><div><h2>采集任务</h2><p>按上海时间自动更新指定平台的有效店铺；程序运行期间自动触发。</p></div><Button type="primary" onClick={openCreate}>新建采集任务</Button></div>
    <div className="jobs-toolbar"><Select value={filter} onChange={setFilter} options={[{ value: 'all', label: `全部任务（${jobs.length}）` }, { value: 'pending', label: '待执行' }, { value: 'executed', label: '已执行' }]} /></div>
    <Table<JobSummary> rowKey="jobId" columns={columns} dataSource={visibleJobs} pagination={false} scroll={{ x: 1050 }} locale={{ emptyText: <div className="jobs-empty"><Icon name="tasks"/><strong>尚未设置采集任务</strong><span>点击右上角创建每日自动抓取计划</span></div> }} />
    <Modal open={modalOpen} title={editing ? '编辑采集任务' : '新建采集任务'} okText="保存任务" cancelText="取消" confirmLoading={saving} onCancel={() => setModalOpen(false)} onOk={() => void form.submit()} forceRender>
      <Form form={form} layout="vertical" onFinish={(values) => void save(values)} className="scheduled-job-form">
        <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}><Input maxLength={100} placeholder="例如：每日经营数据更新" /></Form.Item>
        <div className="form-grid">
          <Form.Item name="scheduleTime" label="每日执行时间" rules={[{ required: true }]}><Input type="time" /></Form.Item>
          <Form.Item name="dateStrategy" label="抓取数据日期" rules={[{ required: true }]}><Select options={[{ value: 'yesterday', label: '昨日（推荐）' }, { value: 'today', label: '当天实时数据' }]} /></Form.Item>
          <Form.Item name="platforms" label="执行平台" rules={[{ required: true, type: 'array', min: 1, message: '请选择平台' }]}><Select mode="multiple" options={[{ value: 'all', label: '全部平台' }, ...platformOptions]} /></Form.Item>
          <Form.Item name="concurrency" label="每批并行店铺数" rules={[{ required: true }]}><InputNumber min={1} max={10} precision={0} /></Form.Item>
          <Form.Item name="batchIntervalMinutes" label="下一批间隔（分钟）" rules={[{ required: true }]}><InputNumber min={0} max={1440} precision={0} /></Form.Item>
          <Form.Item name="enabled" label="任务状态" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
        </div>
        <Alert type="info" showIcon title="执行说明" description="同一批店铺并行执行；本批全部结束后等待设定间隔再启动下一批。历史完整数据仍遵守精确日期幂等限制，当天数据允许刷新。" />
      </Form>
    </Modal>
  </section>
}

function toScheduledJobInput(job: JobSummary): ScheduledJobInput {
  return { name: job.name, scheduleTime: job.scheduleTime, platforms: [...job.platforms], dateStrategy: job.dateStrategy, concurrency: job.concurrency, batchIntervalMinutes: job.batchIntervalMinutes, enabled: job.enabled }
}

function jobStatusLabel(status: JobSummary['status']): string {
  return ({ pending: '待执行', running: '执行中', completed: '已执行', failed: '执行失败', disabled: '已停用' } as const)[status]
}

function jobStatusColor(status: JobSummary['status']): string {
  return ({ pending: 'blue', running: 'processing', completed: 'success', failed: 'error', disabled: 'default' } as const)[status]
}

function formatShanghaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function QualityView(): React.JSX.Element {
  return <section className="quality-grid"><MetricCard label="应采店铺" value="0" change="等待账号配置" /><MetricCard label="采集成功" value="0" change="尚未运行" tone="success" /><MetricCard label="待人工登录" value="0" change="无异常" tone="danger" /><article className="data-panel quality-note"><h2>数据质量门禁</h2><p>缺失数据不会自动填 0。所有正式 JSON 必须通过 Schema、哈希和来源追溯检查后才进入报表。</p></article></section>
}

function HelpFeedbackView({ health, isPreview, onNavigate, onNotify }: {
  health: SystemHealth | null
  isPreview: boolean
  onNavigate: (view: 'accounts' | 'jobs' | 'settings') => void
  onNotify: (input: NotificationInput) => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const systemDiagnostics = [
    `软件名称：电商多店铺数据管理平台`,
    `开发者：阿来（微信：alaigogo）`,
    `版本号：${health?.version ?? '0.1.0-preview'}`,
    `运行环境：${isPreview ? '浏览器视觉预览' : 'Electron 桌面客户端'}`,
    `本地数据目录：${health?.dataRoot ?? '默认数据目录'}`,
    `诊断日志路径：${health?.developmentLogPath ?? '未生成'}`,
    `系统时区：Asia/Shanghai`,
    `生成时间：${new Date().toISOString()}`
  ].join('\n')

  async function copyDiagnostics(): Promise<void> {
    try {
      await navigator.clipboard.writeText(systemDiagnostics)
      setCopied(true)
      onNotify({
        id: 'help:copy-diagnostics',
        tone: 'success',
        title: '已复制系统诊断信息',
        description: '系统诊断信息已成功复制到剪贴板，可粘贴发送给技术支持人员。'
      })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      onNotify({
        id: 'help:copy-error',
        tone: 'error',
        title: '复制失败',
        description: '未能访问剪贴板，请手动复制相关信息。'
      })
    }
  }

  const features = [
    {
      icon: 'shop' as IconName,
      title: '多账号环境物理隔离',
      badge: '安全基石',
      description: '每个子账号分配唯一的独立持久化 Session、隔离 Cookie 库与本地专属下载目录，杜绝多账号串号或关联风险。'
    },
    {
      icon: 'shield' as IconName,
      title: '受控自动化与凭据加密',
      badge: '合规保障',
      description: '接入合法授权的商家子账号，用户名与密码由本机系统安全存储（DPAPI）加密保存；遇验证码即转交人工，保障合规。'
    },
    {
      icon: 'database' as IconName,
      title: '主流多电商平台接入',
      badge: '统一管理',
      description: '标准化适配天猫、拼多多、淘宝、京东、抖店、快手、视频号、1688 等主流平台，提供独立店铺工作区与多标签浏览。'
    },
    {
      icon: 'tasks' as IconName,
      title: '定时自动采集与批次调度',
      badge: '省时高效',
      description: '按上海时间配置每日数据自动采集计划，支持设定单批并行店铺数与批次间隔，兼顾采集效率与访问稳定性。'
    },
    {
      icon: 'server' as IconName,
      title: '四层严谨可信数据架构',
      badge: '真实可溯',
      description: 'Raw 原始报文 → Normalized 标准化清洗 → Aggregate 聚合 → Report Dataset 统一报表，严格 Schema 校验，绝不隐式填 0。'
    },
    {
      icon: 'chart' as IconName,
      title: '全景销售大盘与多维分析',
      badge: '决策支持',
      description: '聚合全平台支付金额、访客、转化率、客单价、退款、广告消耗与 ROI，提供趋势图、渠道来源、商品排名与客服洞察。'
    }
  ]

  const steps = [
    {
      number: '01',
      title: '接入店铺子账号',
      description: '在「账号环境」添加店铺，配置平台、店铺名称、子账号及本机加密登录凭据。'
    },
    {
      number: '02',
      title: '人工登录与验证',
      description: '点击「打开环境」，在右侧独立店铺后台完成首次人工登录与平台短信/滑块验证。'
    },
    {
      number: '03',
      title: '建立采集计划',
      description: '在店铺工作区点击「抓取昨日数据」即时采集，或在「采集任务」中设置每日定时自动调度。'
    },
    {
      number: '04',
      title: '查看经营大盘',
      description: '进入「仪表盘 → 销售总览」，跨平台、跨店铺按自然日查看统一经营指标、走势与明细。'
    }
  ]

  const faqs = [
    {
      question: '为什么遇到验证码需要人工协助处理？',
      answer: '本系统严格遵守合规原则与平台服务协议，绝不使用验证码识别、反检测或风控绕过机制。遇到图形滑块或短信验证时，系统会自动暂停并在右侧独立工作区等待人工完成验证。'
    },
    {
      question: '如何更改数据存储目录或进行数据备份？',
      answer: '进入「系统 → 系统设置」选择新的“数据本地存储路径”或“程序环境数据存储目录”并保存，随后手动重启主程序即可生效。系统不会删除或覆盖原目录数据，保障数据绝对安全。'
    },
    {
      question: '提示“数据部分完整”是什么意思？',
      answer: '平台执行严格的数据完整性审计门禁。当个别细分子模块（如部分第三方广告明细或结算账单）未返回或尚未适配时，系统会明确标明覆盖情况，绝不会隐式把缺失数据填为 0 误导决策。'
    },
    {
      question: '数据保存在本地还是上传到云端？',
      answer: '系统采用 Local-First（本地优先）纯本地架构，所有账号配置、Session 凭据、采集的 JSON 数据及报表均保存在当前电脑硬盘中，不向任何未经授权的第三方服务器上传数据。'
    }
  ]

  return <section className="help-view">
    <div className="help-hero">
      <div className="help-hero-content">
        <div className="help-hero-badge"><Icon name="shield" /> 本地安全优先 · 多账号强隔离 · 真实可追溯</div>
        <h2>电商多店铺数据管理平台</h2>
        <p>专为多平台电商运营打造的一站式多店铺隔离管理、受控合规自动化数据采集与全景经营分析工作台。以物理级 Session 隔离技术杜绝多账号串号风险，通过四层严谨数据流提供真实可信的经营报表。</p>
        <div className="help-hero-tags">
          <span className="help-tag">版本：{health?.version ?? '0.1.0'}</span>
          <span className="help-tag">时区：Asia/Shanghai</span>
          <span className="help-tag">模式：{isPreview ? '浏览器预览' : 'Electron 桌面端'}</span>
          <span className="help-tag help-tag-dev">开发者：阿来（微信：alaigogo）</span>
        </div>
      </div>
    </div>

    <div className="help-section">
      <div className="help-section-heading">
        <div>
          <h2>核心功能矩阵</h2>
          <p>从店铺账号接入、受控自动化采集到统一经营大盘的全链路能力</p>
        </div>
      </div>
      <div className="help-features-grid">
        {features.map((item, idx) => <article className="help-feature-card" key={idx}>
          <div className="help-feature-header">
            <span className="help-feature-icon"><Icon name={item.icon} /></span>
            <span className="help-feature-badge">{item.badge}</span>
          </div>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
        </article>)}
      </div>
    </div>

    <div className="help-section">
      <div className="help-section-heading">
        <div>
          <h2>快速上手流程</h2>
          <p>只需四步即可完成多店铺接入与经营数据统一汇聚</p>
        </div>
      </div>
      <div className="help-steps-grid">
        {steps.map((step, idx) => <div className="help-step-card" key={idx}>
          <div className="help-step-number">{step.number}</div>
          <div className="help-step-content">
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </div>
        </div>)}
      </div>
    </div>

    <div className="help-section">
      <div className="help-section-heading">
        <div>
          <h2>常见问题解答 (FAQ)</h2>
          <p>关于账号安全、验证码处理、数据存储与采集的常见疑问</p>
        </div>
      </div>
      <div className="help-faq-grid">
        {faqs.map((faq, idx) => <article className="help-faq-card" key={idx}>
          <div className="help-faq-q">
            <span className="help-faq-tag">问</span>
            <strong>{faq.question}</strong>
          </div>
          <div className="help-faq-a">
            <span className="help-faq-tag ans">答</span>
            <p>{faq.answer}</p>
          </div>
        </article>)}
      </div>
    </div>

    <div className="help-section help-feedback-section">
      <div className="help-section-heading">
        <div>
          <h2>系统诊断与支持反馈</h2>
          <p>快速获取本机运行环境信息，或在遇到问题时提供技术诊断依据</p>
        </div>
      </div>
      <div className="help-support-grid">
        <div className="help-diagnostics-card">
          <div className="help-diag-header">
            <strong>本机运行与诊断信息</strong>
            <Button size="small" icon={<Icon name={copied ? 'check' : 'copy'} />} onClick={() => void copyDiagnostics()}>
              {copied ? '已复制' : '复制诊断信息'}
            </Button>
          </div>
          <div className="help-diag-body">
            <div className="diag-row"><span className="diag-label">开发者</span><span className="diag-value">阿来（微信：alaigogo）</span></div>
            <div className="diag-row"><span className="diag-label">客户端版本</span><span className="diag-value">{health?.version ?? '0.1.0-preview'}</span></div>
            <div className="diag-row"><span className="diag-label">运行状态</span><span className="diag-value">{health?.status === 'ok' ? '正常运行' : '检查中'}</span></div>
            <div className="diag-row"><span className="diag-label">数据存储路径</span><span className="diag-value diag-path">{health?.dataRoot ?? '正在读取…'}</span></div>
            <div className="diag-row"><span className="diag-label">开发诊断日志</span><span className="diag-value diag-path">{health?.developmentLogPath ?? '正在读取…'}</span></div>
          </div>
        </div>
        <div className="help-contact-card">
          <h3>反馈与建议</h3>
          <p>如在使用过程中遇到任何异常、数据偏差或有新平台接入需求，可通过以下途径寻求支持：</p>
          <ul className="help-contact-list">
            <li><strong>开发者微信：</strong>alaigogo（阿来）</li>
            <li><strong>问题反馈：</strong>请将复制的诊断信息与异常截图发送给开发者进行排查。</li>
            <li><strong>日志排查：</strong>可在上述开发诊断日志文件中查看详细错误堆栈。</li>
            <li><strong>存储管理：</strong>如需调整数据目录或程序环境，可随时前往系统设置调整。</li>
          </ul>
          <div className="help-contact-actions">
            <Button onClick={() => onNavigate('settings')}>前往系统设置</Button>
          </div>
        </div>
      </div>
    </div>
  </section>
}

function Icon({ name }: { name: IconName }): React.JSX.Element {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    shop: <><path d="M4 9h16l-1 12H5L4 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></>,
    tasks: <><path d="M9 5h11M9 12h11M9 19h11"/><path d="m3 5 1.5 1.5L7 3.5M3 12l1.5 1.5L7 10.5M3 19l1.5 1.5L7 17.5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    folder: <><path d="M3 6h7l2 2h9v11H3Z"/><path d="M3 9h18"/></>,
    cloud: <path d="M17.5 19H6a4 4 0 0 1-.5-8 6 6 0 0 1 11.7-1.5A4.8 4.8 0 0 1 17.5 19Z"/>,
    server: <><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/></>,
    chevron: <path d="m7 9 5 5 5-5"/>,
    back: <><path d="m10 7-5 5 5 5"/><path d="M5 12h14"/></>,
    forward: <><path d="m14 7 5 5-5 5"/><path d="M19 12H5"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M19 11a7.5 7.5 0 1 0 .1 4.9"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    help: <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
    chart: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
    calculator: <><rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M7 6h10v4H7zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></>,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    check: <><polyline points="20 6 9 17 4 12"/></>
  }
  return <svg className={`ui-icon icon-${name}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
