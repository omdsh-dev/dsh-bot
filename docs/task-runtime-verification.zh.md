# 任务运行底座验证记录（2026-11-03）

## 2026-11-06 推送前整合验证

整合远端 main 的剪贴板图片粘贴更新（基线 `1b7c253`）。输入框冲突同时保留图片粘贴的 `onFiles` 与协作邀请入口；修正可选回调在严格 TypeScript 配置下显式传入 `undefined` 的类型。

整合后重新通过 Host / Client 构建、45 个测试文件的 **446/446** 项测试、2 项启动/容器配置测试，以及 DSH 0.1.5-rc.2 / 0.2.0-rc.2 的实际打包 Client 测试各 1 项。文档链接与暂存区 whitespace 检查通过。下文 2026-11-03 的完整包级矩阵、Chrome/Electron 和 SDK 记录保留为当时验证，不冒充本次全部重跑。

本次源码摘要：`4a7d884fefa8e0402f225796d9495b411872c21bc2d737b2a7dfb4fd1d30a1ce`。日志与临时测试包位于 `.runtime/task-push-20261106/`；原 `dist/` 已恢复并逐文件校验一致。

## 结论与范围

本轮不是只复跑单元测试：同时验证了源码、真实构建产物、两个 DSH 版本上的安装包、真实原生工具分发与进程强杀恢复、Chrome 和 Electron，以及离线真实 SDK 契约。

发现并修复了一个成员变更绕过原生退出等待的问题；修正了两处过时的包测试前提及兼容性文档。实现仍是[任务运行底座](task-runtime.zh.md)，**不是完整的自主 Agent 安全与业务验收系统**。下面的通过结果不代表真实 IM 或远端业务操作已得到端到端验证。

使用独立临时 profile、确定性模型与模拟外部副作用；没有向真实群聊发送消息，没有调用真实模型，没有提交或发布代码，也没有重启用户现用服务。

## 本次发现及处理

### 1. 已修复：移除再加入 Bot 可以绕过原生工具退出等待

复现顺序：消息因取消/超时而结束 → 原生 Session 或工具仍在运行/退出 → 移除该成员 → 重新加入并创建新 Session。此前 `setMembersState()` 只检查消息状态，原有 `nativeBusy()` 随成员引用消失而失效。

修复：

- 变更成员前检查**当前成员**的原生运行/退出状态，不能以消息“失败/已取消”作为退出证明。
- 相关聊天或 alias 仍有未核对操作时，拒绝移除成员；先核对再移除。
- 添加四个回归用例，覆盖 running / draining，以及当前房间 / alias 的未知回执；失败时不提交变更，真正退出或核对后可正常移除、重新加入。
- 再审查 `manageTeam`、邀请、IM 配置、房间合并、生命周期操作：管理群组复用修复后的入口；其他追加/合并路径保留原 Session 与恢复引用，未复现同类绕过。

注意：修复前删除 Bot 定义本身不等于删除账本或聊天核对入口；本次确认的核心问题是原生并发退出保护被绕过，不夸大为已发生数据丢失。

### 2. 已修正：包测试与当前接口契约脱节

- 兼容性测试仍要求连接器接受 Bot `0.10.0`，但当前 `compatibility.json` 已声明 `>=0.12.1 <1.0.0`。改为验证实际声明、支持版本及拒绝边界；同步中英文 README 和兼容性文档。**未降低生产 peer 限制。**
- IM 委派测试未提供新增的真人邀请白名单，以及建群后核对群主/机器人所需的 SDK 查询接口。补充明确白名单和离线查询夹具，同时保留“白名单缺失必须拒绝”的断言。**未绕过生产邀请校验。**

最初包级运行是 7/9 通过；这些失败保留在早期日志中，不作为最终通过证据。

### 3. 已确认并明确文档：`localOnly` 不是保密边界

使用本地 canary 确认：同房间的“仅 DSH”内容可以进入后续平台请求的模型上下文。这是既有投递语义，不是新增任务账本的跨房间读取问题，也没有观察或发送真实 IM 泄露。

`localOnly` 仅表示不直接投递到平台；共享原生 Session 可能保存该内容。真正保密需要独立房间/Session 与上下文隔离，不能只过滤本次历史或依赖这个标记。

## 覆盖矩阵

| 层次 | 覆盖内容 | 结果 |
| --- | --- | --- |
| 构建与类型 | Host / Client 构建、工作区类型检查、生成 Remote codecs、源码与产物哈希 | 通过 |
| 源码全量回归 | 44 个文件，436 项测试；相比此前新增 30 项 | 436/436，通过，无跳过 |
| 状态与存储故障 | 8 个固定种子 × 100 步；实际 schema JSON 往返；HistoryStore 分块、提交失败、分块缺失、事件保留、重试、合并、取消与人工核对 | 新增 21 项，包含在全量回归中 |
| 原生进程故障 | 真正 `SIGKILL`，不是抛异常模拟；成功回执与人工验收跨重启保留；未知结果不重放 | 包含在全量及包级测试中 |
| DSH 0.1.5-rc.2 包级矩阵 | 同一组 Base / Feishu / InfoFlow 压缩包；Host、Web、隔离、路由、去重、委派、重启、崩溃恢复 | 10 通过，1 项本地包安装器按已知限制跳过 |
| DSH 0.2.0-rc.2 包级矩阵 | 同上，另含统一插件管理器真实安装本地主包和飞书包 | 11/11，通过，无跳过 |
| 实际打包 Client | 两个 DSH 版本；渲染生成的 bundle、Remote 注册、请求权限提交、凭据检查勾选、人工核对与禁止自动验收 | 每版本 1/1，通过 |
| Chrome | 真实 Chrome + loopback 页面；Bot 间 Cookie 隔离、停止后新执行不复用登录状态；包级 Desktop / Web 载入 | 2 项 |
| 原生 Electron | 隔离 profile；首次引导、真实窗口创建 Bot、用量页面、重启持久化；sandbox / contextIsolation / nodeIntegration 配置 | 通过 |
| 真实 SDK 离线契约 | 飞书 SDK 1.75.0：6 项；如流 SDK 2026.8.28：4 项；HTTP/WS 替身与出站保护 | 10/10，实际出站尝试 0 |
| 启动与容器构建配置 | 原生认证启动、容器 TypeScript 引用与生产/测试入口分离 | 2/2；不是实际 Docker 运行测试 |
| 静态检查 | 分发元数据、本地文档链接、`git diff --check` | 通过 |

### 真实强杀测试验证了什么

测试模型先故意调用被 `toolMode: 'none'` 禁用的工具：工具主体调用为 0，操作账本为 0，副作用文件仍为空。不能把模型遵从指令当成权限验证。

随后成功操作收到 `returned`，任务进入待验收；只有显式人工验收才成为 `verified`。

另一次工具调用确认主域已提交 `started` 后写入临时副作用文件，然后阻塞在返回前。父测试此时强杀进程。两次重启均验证：

- `started` → `unknown`，对应 Run → `interrupted`；
- 同根排队分支被取消，不自动回调、重试或重放；
- 查询、核对与等待真实调度 tick 不触发模型或工具；两次恢复阶段模型调用均为 0；
- 副作用 oracle 故意不做幂等去重，最终始终只有“成功一次 + 强杀前一次”两条记录；
- 人工验收与不可覆盖的核对结论持久化；
- 包级补充检查保留 alias 的房间能用原始操作 key 核对，不允许跨无关房间读取。

## 可复现入口

需先使用 Node 24+，准备两个声明支持的固定 DSH 工作区；完整流程不会使用线上生产 profile：

```sh
node scripts/build-plugin.mjs
node -e 'import("./scripts/common.mjs").then(({runTool,pluginPath})=>runTool("vitest",["run",`${pluginPath}/tests`,"--maxWorkers=1"]))'
node scripts/pack.mjs --allow-dirty
node scripts/pack-feishu.mjs --allow-dirty
node scripts/pack-infoflow.mjs --allow-dirty
node scripts/test-compatibility.mjs
node scripts/test-browser.mjs
node scripts/test-desktop.mjs
node --test --test-concurrency=1 scripts/start.test.mjs scripts/container-build.test.mjs
node scripts/check.mjs
git diff --check
```

`test-compatibility.mjs` 已纳入新增的 `scripts/task-runtime-package.test.mjs`。同一组压缩包依次测试两个 DSH 版本，并检查测试期间压缩包哈希没有变化。`--allow-dirty` 只用于本地验证，**不是允许发布测试包**。

## 日志与验证对象

本次本地证据目录：`.runtime/task-verification/`。不把包含临时环境详情的日志当作分发源码提交。

- `build-final.log`、`full-source-final.log`
- `pack-final.log`、`compatibility-final.log`（包含每版本包级故障恢复及实际打包 Client）
- `browser-final.log`、`desktop-final.log`
- `sdk-final.log`、`sdk-contracts.log`
- `launcher-final.log`、`check-final.log`
- `provenance-final.json`：源码、构建和三个压缩包摘要；`artifact-handling.log`：产物隔离与恢复记录

环境：macOS 26.3 / arm64，Node 24.19.0，Chrome 156.0.8078.76，Electron 44.0.0。

源码基线 Git HEAD：`61e6f8a49b718393551e6c97c41ba4ce1e2cc13b`，工作区有未提交改动；验证依靠实际源码摘要，不能仅用 HEAD 表示本次代码：

```text
sourceSha256 = 3d9bed8c9df6cb48109641eb22781be6a59614511b82fa13bc31f4c2bf4b69fd
```

验证结束后，已将测试产物隔离在 `.runtime/task-verification/dist-verified/`，并逐文件校验、恢复验证前的 `dist/`（293 个原文件）。没有用未提交测试包覆盖原发布产物；再次运行包测试前须按上方流程重新打包。

本次测试包 SHA-256（均标记 `dirty: true`，仅供本地验证，不是已发布版本）：

| 包 | SHA-256 |
| --- | --- |
| Bot 0.13.0 | `b0768f32271f93803b1fd44f97e450f05103ff8d11dbb7b02016f6acdacd8fac` |
| Feishu 0.7.0 | `35bedb9dafb89f84ed8e0454363698c992f78fb40ad0601aec0ca3ae3f3117c3` |
| InfoFlow 0.8.0 | `8bf1673718088c3912c173464d13bc4125f2776eb1b7fc968bf34dc728b89678` |

DSH 版本与固定提交：

- `0.1.5-rc.2`：`c291e7961a515f6d7af9304e7fd1d257929aef26`
- `0.2.0-rc.2`：`639ed015397290b3745d163aafe02ffee4aa3f84`

## 明确未验证 / 未完成

- Docker CLI 存在，但 daemon 未启动：**实际容器构建/启动未运行**，不能用配置测试代替。
- 旧版 DSH 0.1 安装器只接受 registry 版本，本地包安装测试显式跳过；当前未发布的代码不能用旧线上包冒充验收，因此未执行 registry 发布后验证。
- 本轮只在上述 macOS / Node 24 环境验证，没有执行 Windows / Linux / 其他 Node 版本矩阵。
- 不包含真实模型、真实飞书/如流网络与企业权限、真实 PR/CI/支付等远端副作用验收。
- 原生 subagent / 外部执行器的权限与操作记录未完整贯通；只读文件策略不是网络只读，白名单也不证明工具内部行为安全。
- 外部操作仍无通用 exactly-once：新的 call ID 或新用户请求可能重复业务动作；需要工具适配层幂等键和真实结果查询。
- 语义 Watchdog、自动业务验收、根任务总预算/总时限、每任务工作目录隔离、操作账本归档仍未落地。账本满时拒绝新操作，不自动删除回执。
- 状态机测试是确定性故障覆盖，不是无限时长的压力测试、形式化证明或生产 SLO 保证。
