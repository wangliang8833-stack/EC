# Third-Party Notices

> 审计日期：2026-08-27  
> 状态：阶段 0 初始锁定  
> 详细机器可读记录见 [`licenses.lock.json`](./licenses.lock.json)。

本项目只直接分发锁文件中标记为 `approved: true` 的 npm 依赖。安装后的完整传递依赖以 `pnpm-lock.yaml` 和发布时生成的 SBOM 为准。

## 直接运行时与构建依赖

| 组件 | 锁定版本 | 许可证 | 用途 | 上游仓库 |
|---|---:|---|---|---|
| Electron | 44.0.0 | MIT | 桌面运行时、Session、窗口、IPC、下载和 CDP | https://github.com/electron/electron |
| React / React DOM | 19.2.8 | MIT | 管理端 Renderer | https://github.com/facebook/react |
| Ant Design | 6.6.1 | MIT | 管理端 UI | https://github.com/ant-design/ant-design |
| Apache ECharts | 6.1.0 | Apache-2.0 | 报表图表 | https://github.com/apache/echarts |
| Ajv | 8.20.0 | MIT | JSON Schema 校验 | https://github.com/ajv-validator/ajv |
| pino | 10.3.1 | MIT | 结构化日志 | https://github.com/pinojs/pino |
| electron-vite | 5.0.0 | MIT | Electron 构建与开发 | https://github.com/alex8088/electron-vite |
| Vite | 7.3.6 | MIT | Renderer 构建 | https://github.com/vitejs/vite |
| TypeScript | 6.0.3 | Apache-2.0 | 类型检查和编译 | https://github.com/microsoft/TypeScript |
| Vitest | 4.1.11 | MIT | 单元与集成测试 | https://github.com/vitest-dev/vitest |
| Playwright Test | 1.62.1 | Apache-2.0 | Electron E2E 与页面回归 | https://github.com/microsoft/playwright |
| electron-builder | 26.15.3 | MIT | Windows 安装包 | https://github.com/electron-userland/electron-builder |
| electron-builder-squirrel-windows | 26.15.3 | MIT | electron-builder 的 Windows 打包 peer 组件 | https://github.com/electron-userland/electron-builder |
| DefinitelyTyped Node/React/React DOM 类型 | 26.4.0 / 19.2.18 / 19.2.5 | MIT | 编译期类型定义 | https://github.com/DefinitelyTyped/DefinitelyTyped |

各组件的版权声明和许可证正文由对应 npm 包携带。发布前必须运行许可证扫描并随安装包输出 SBOM，不得只依赖本摘要。

## 研究参考仓库

下列仓库不作为 npm 依赖，不复制到产品构建。若未来拟复用具体文件，必须先进行文件级许可证和依赖审计并更新本文件。

| 仓库 | 锁定 Commit | 许可证 | 决定 |
|---|---|---|---|
| iflytek/astron-rpa | `0cc6a33ddbc3f2a29700d08d1d27cefe0947b78d` | Apache-2.0 | 仅研究 Step Runner、调度和人工接管；当前不复制代码 |
| lien0219/trademind-ai | `b3ab0347222d49e3242430384fec73ecc2423dea` | Apache-2.0 | 仅研究 Provider/Collector/Lease；当前不复制代码 |
| EchoHS/GeekezBrowser | `6f470cf16d97c80385fbeba2b2eafad756278098` | PolyForm Noncommercial 1.0.0 | 仅架构参考，禁止进入商业产品代码或素材 |
| zeasin/qihang-erp-open | `396923d61abc3be0ee4c3633d7b248abbab51fc9` | AGPL-3.0 | 仅业务概念参考，禁止复制代码、SQL 或素材 |
| zeasin/qihang-oms | `61a9987d74bddb29ea35153a453b719c81b49999` | AGPL-3.0 | 仅业务概念参考，禁止复制代码、SQL 或素材 |

## 禁止项

- 不允许未经审计的 AGPL、GPL、SSPL、BUSL 或 PolyForm Noncommercial 代码进入生产构建。
- 不允许复制来源不明、无许可证或许可证头缺失的文件。
- 不允许从研究仓库复制品牌、图标、图片、数据库脚本或平台接口实现。
- 不允许依赖未锁定的 `latest` 版本。
