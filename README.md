# 电商多店铺数据管理平台

由 **GPT-6 Astra** 辅助开发。

基于 Electron、React 和 TypeScript 的多账号隔离电商数据采集与本地报表平台，目前已接入天猫经营数据采集与历史补齐。

## 当前能力

- Main / Preload / Renderer 安全分层和白名单 IPC；
- 每个账号唯一 `persist:account-{account_id}` Session、右侧独立店铺工作区与下载目录；
- Account、Shop、Job、Raw JSON Schema；
- Schema 校验、SHA-256、临时文件、原子替换、`.bak` 和审计日志；
- 单账号租约、Job 状态机、Step Runner 和假数据适配器；
- React 管理台骨架及受控系统、账号、任务、报表 API；
- 已配置账号动态显示为“平台-店铺名 + 启用开关”，点击后通过独立 Session 的 `WebContentsView` 在右侧加载店铺后台；
- 账号环境中的“打开环境、检测登录”均先按 `accountId` 切换到同一店铺工作区；“编辑”可维护店铺名、子账号名称、负责人及可选的本机加密登录凭据，平台、店铺标识和 Session 保持不可修改；
- 天猫已支持指定昨日自然日的店铺、交易、流量来源、搜索词、商品、客服及广告账户汇总采集，并生成 Raw、Normalized、Aggregate 和 Report Dataset；
- 销售总览支持昨日、自然周、自然月和自定义日期范围，逐日汇总本地报表，通过红绿状态及下拉明细提示店铺数据覆盖；
- 账号页面导航、关闭工作区和正常退出前会刷新持久 Cookie Store/DOM Storage；再次打开店铺时自动按真实页面校正登录状态；
- 右侧后台使用视图租约处理 React StrictMode 重复挂载，过期清理不会关闭当前店铺页面；
- 精确依赖锁、许可证门禁、漏洞审计和 Windows CI。

## 环境要求

- Windows 10/11；
- Node.js 24.15.0 或兼容的 Node 24 版本；
- pnpm 10.33.2。

## 安装与运行

Windows 下可直接双击项目根目录的 `一键启动测试.bat`。脚本会检查 Node.js/pnpm、在缺少依赖时执行锁定安装，然后启动 Electron 主程序。只检查环境而不启动程序：

```powershell
.\一键启动测试.bat --check
```

也可以手动运行：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

生产构建：

```powershell
pnpm build
pnpm --filter @ecommerce/desktop exec electron .
```

常用检查：

```powershell
pnpm licenses:check
pnpm audit:dependencies
pnpm privacy:check
pnpm typecheck
pnpm test
```

## 目录

```text
apps/desktop/          Electron 桌面应用
packages/shared/       共享 TypeScript 契约
packages/schemas/      JSON Schema 和运行时校验
scripts/               供应链检查脚本
```

运行时业务数据默认写入 Electron `userData/app-data`，不写入源码目录。Windows 当前路径通常为：

```text
%APPDATA%/@ecommerce/desktop/app-data
```

该目录及账号 Profile、下载、截图、导出、备份均被 Git 忽略。不得向仓库提交账号配置、Cookie、Token、密码、平台响应或消费者个人信息。

## 系统设置与存储目录

点击左下角“系统设置”可查看和修改：

- 数据本地存储路径：账号配置、四层 JSON、报表数据集、下载和审计日志；
- 程序环境数据存储目录：Electron Persistent Session、Cookie、缓存和平台登录环境；
- 数据远程存储设置：待开发；
- 远程服务器设置：待开发。

目录设置保存于 `%APPDATA%/@ecommerce/desktop/system/storage-settings.json`。在 Electron 主程序中选择新目录后会自动校验并保存，但不会自动关闭或重启程序。为避免新旧目录同时写入，界面会锁定其他所有功能并显示不可关闭的重启提醒；用户手动关闭并重新启动后，新路径生效且界面自动解锁。系统不会自动复制、删除或覆盖旧目录内容；更换程序环境目录后，平台账号可能需要重新登录。浏览器视觉预览只能验证界面，点击目录按钮会提示改用 Electron 主程序。

主窗口保持 Electron Sandbox 和 Context Isolation 开启，白名单 API 通过 CommonJS preload 注入。`pnpm check` 会在构建后校验 preload 产物与主进程引用，防止桌面窗口静默退化为浏览器预览模式。

## 定时采集任务

点击左下角“系统 → 采集任务”可以创建每日自动更新计划：

- 按 `Asia/Shanghai` 指定每日执行时间；
- 选择全部已接入平台或指定平台，并选择抓取昨日或当天实时数据；
- 设置每批并行店铺数（1—10）和下一批启动间隔（0—1440 分钟）；
- 在任务列表查看待执行、执行中、已执行、失败或停用状态，以及下次执行时间和上次结果；
- 支持立即执行、编辑和删除；任务配置原子保存至本地业务数据目录的 `config/scheduled-collection-tasks.json`。

调度器仅在桌面程序运行期间触发；程序启动时会读取持久化任务，已到期任务将补充执行。同一时间只允许一项统一数据更新，避免手动更新和定时任务争用账号环境。历史完整日期继续遵守精确日期幂等门禁；当天任务每次运行都会刷新实时快照。

## 历史数据补齐

“系统 → 采集任务 → 补齐历史数据”支持选择已启用天猫店铺和最近 30 个已结束的上海自然日。销售总览、数据分析也提供同名入口，可带入所选店铺和日期。

先点击“检查数据缺口”，查看已有数据、本地 Raw 可重建和需要采集的数量，再开始补采。默认仅补缺失和可恢复缺口；可切换为重新采集所选范围。不同店铺支持 1—3 并发，同店铺日期串行；可暂停、继续、取消和重试失败项。登录失效只暂停对应店铺，完成登录后点击继续。程序关闭后任务暂停，重启后在任务列表继续；已成功的日期不会重复采集。

任务记录存于运行时数据目录 `data/backfill-jobs`。新派生数据按运行标识保存，校验成功后提交正式日报，防止失败刷新覆盖原有效数据。任务处理进度与字段覆盖分开显示：Top 数据、未支持的全店退款、权限或字段缺口不等于完整数据，缺失不补零。完整的 30 天环比还需要前一个 30 天的数据。

开发过程文档、原型、业务截图、数据导出和本地压缩包仅保存在本机，不同步至 Git 仓库。演示与测试数据必须使用虚构名称和专用测试标识，不得复制真实店铺、账号或凭据。

## 添加真实账号前的门禁

1. 准备 2 个合法授权且最小权限的拼多多子账号；
2. 明确 3 个目标页面、核心指标和人工核对责任人；
3. 账号 JSON 只保存 `credential_ref`；经用户授权，用户名和密码可以单独使用当前本机用户绑定的系统安全存储加密保存；
4. `session_partition` 必须严格等于 `persist:account-{account_id}`；
5. `allowed_hosts` 只列平台必需域名；
6. 授权人员可选择人工登录，或在“登录设置”中允许本机加密保存账号密码，用于会话失效后的单次自动登录；
7. 不实现验证码识别、反检测、指纹伪装或风控绕过。

### 天猫登录环境持久化

- 天猫账号使用独立的 `persist:account-{account_id}` Chromium 分区，正常保存 Cookie、LocalStorage、IndexedDB 和缓存；
- 允许域名内的会话 Cookie 与未过期持久 Cookie 另行生成 v2 加密快照，持久 Cookie 保留原到期时间，旧版 v1 快照可继续恢复；
- 打开工作区时先恢复快照；Cookie 变化、页面停止加载、每 60 秒本地检查点、关闭工作区和正常退出时都会刷新登录环境；
- 单个失效或不兼容 Cookie 不会阻断其他 Cookie 恢复，加密快照损坏也不会阻止 Electron 原生持久分区启动；
- 本地持久化不能延长平台服务端有效期；平台主动失效、验证码、短信或安全验证仍需授权人员处理。

## 天猫子账号链路测试

1. 双击 `一键启动测试.bat`，点击左下角“系统”，进入“账号环境”；
2. 点击“添加天猫账号”，填写店铺名称、子账号名称和负责人；店铺标识由系统按平台规则自动分配，当前天猫使用 `TXXXX` 四位流水号；
3. 确认账号已获得公司授权；可在新增表单或已有店铺的“登录设置”中录入用户名和密码，凭据使用本机系统安全存储加密且不进入账号 JSON；
4. 保存后系统自动选中左侧对应店铺，并在右侧独立工作区打开后台；系统只在天猫官方登录 frame 自动填充并点击一次，验证码、短信或风控验证仍由授权人员处理；
5. 店铺打开后系统会自动按当前页面校正登录状态；也可点击右侧工具栏或账号环境表格中的“检测登录”再次确认；
6. 右侧工具栏支持后退、前进和刷新；店铺后台在平台白名单内弹出的生意参谋等页面会变成当前账号的新标签，可切换或关闭，所有标签继续共用该账号的独立 Session；
7. 点击“抓取昨日数据”，系统会进入生意参谋，按 Asia/Shanghai 的昨日自然日采集可访问经营数据并原子写入分层 JSON；采集完成后返回“仪表盘 → 销售总览”查看。
8. 若同一店铺已经成功生成该精确业务日期的完整采集产物，再次点击只会显示“目标日期 YYYY-MM-DD（Asia/Shanghai）”提示，不会打开店铺、重复请求页面或改写文件；提示中的“数据覆盖状态”与“采集任务是否完成”是两个独立概念。

历史非标准店铺标识可使用 `scripts/migrate-shop-identifiers.mjs` 迁移。默认仅干跑；确认映射后增加 `--apply`。工具会先备份每个变更文件、记录 SHA-256 和目录重命名清单，再原子重写账号及数据引用；`logs` 不会被改写，只会追加独立迁移审计事件。

账号配置、Raw 和报表数据集默认位于所选“数据本地存储路径”：

```text
%APPDATA%/@ecommerce/desktop/app-data/config/accounts
%APPDATA%/@ecommerce/desktop/app-data/data/raw/tmall
%APPDATA%/@ecommerce/desktop/app-data/data/normalized/tmall
%APPDATA%/@ecommerce/desktop/app-data/data/report-datasets/tmall
```

当前天猫采集优先复用页面正常发起的 JSON 请求；页面未主动加载的 Top 数据通过同源、带当前合法 Session 的只读请求补齐。Raw 会移除 Cookie、Token、凭据、授权头和跟踪标识。订单/退款明细、广告计划明细和结算尚未接入，因此 Report Dataset 明确标记为 `partial`，不得视为完整财务数据。

## 本地模板数据分析

“数据分析”参照 omnichannel-commerce-assistant 的证据化经营诊断流程，提供综合经营、商品流量、广告退款三种模板。选择店铺、截止日期及 1 / 7 / 30 天周期后，本地生成报告并导出离线 HTML，无需模型或 API Key。周期比较固定相同且完整覆盖的店铺；缺失不补零，Top 明细和广告归因限制在报告中明确展示。

## 当前限制

- 尚未接入真实拼多多页面、CDP 响应匹配或报表下载；
- 天猫已实现首版 Raw → Normalized → Aggregate → Report Dataset；拼多多及跨平台统一映射、CSV 流式导出仍未完成；
- 天猫登录状态依据对应店铺右侧工作区是否位于受信任后台域名判断；程序会持久化本地 Session，但天猫服务端主动失效、账号安全策略或会话级 Cookie 仍可能要求重新登录；
- 天猫当前覆盖生意参谋可访问的昨日汇总与 Top 数据；千牛订单/退款明细、广告计划明细、支付宝结算及报表下载仍未实现；
- 尚未执行安装包签名、SBOM、备份恢复和 7 天稳定性验证；
- 当前 Renderer 首包仍包含完整 Ant Design，后续报表阶段需要按路由拆包并做性能验收。

开发计划、任务日志和验收记录仅保留在本地，不随仓库发布。
