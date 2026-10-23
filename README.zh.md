# DSH Bot

中文 | [English](README.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的原生多 Bot 聊天插件。给每个 Bot 设置名字和职责，可以私聊，也可以把多个 Bot 拉进同一个群聊。每位成员都保留自己的 DSH Session、工具和审批记录。

这是独立的实验性社区插件，不是 DeepSeek 官方产品，与 Grok、Cue、Muse 没有关联。

**0.8.1 版本**使用同一套安装包兼容 **DSH 0.1.5-rc.2 和 0.2.0-rc.2**，支持从 Web、飞书和如流调用同一个 Bot。在 **DSH Bots → IM 接入** 统一配置两个平台，为每个 Bot 绑定机器人，并从 DSH 创建平台群聊。

同一个 Bot 可以同时绑定飞书和如流。角色指令、模型和工具共用；聊天记录、模型对话上下文和回复目的地按平台及具体聊天隔离。工具访问的文件和外部记忆仍由部署权限决定。

**如流入口默认隐藏：** 新用户默认隐藏如流配置和建群选项。内部用户可在 **IM 接入 → 高级设置 → 显示如流接入（内部用户）** 开启，设置保存在当前 DSH profile。已有如流绑定或聊天记录的用户升级后保留入口；关闭显示不会停用连接或删除记录。开启显示后仍需安装如流配套插件并配置企业 SDK。

**0.9.1** 增加了聊天管理、历史自动分段、模型和工具候选项、每 Bot 周期预算与并发预留、附件收发与下载、内联问答与审批、离线失败恢复和带时区的日历任务。下表为本次发布包；发布进度及实机验收范围见[完成记录](docs/feature-completion.md)，配置见[功能使用说明](docs/capabilities.md)。

## 能做什么

- 创建 Bot，设置 handle、显示名称、职责和 DSH Agent preset。
- 每个 Bot 拥有唯一本地私聊，也可以明确选择成员创建群聊。
- 用 `@handle`、`@all`、`@everyone` 指定接收者；点击成员头像即可插入 @。
- 搜索与筛选聊天、引用回复、停止回答、重试失败回答。
- 打开成员的原生执行 Session，查看流式输出、工具调用、问题与审批。
- 重启后继续聊天，支持中英文、明暗主题和窄屏布局。
- 飞书支持官方扫码创建并绑定、绑定已有应用、私聊、群聊 @ 和一键创建包含所选 Bot 的群。
- 如流支持凭据导入、私聊与群聊准入配置、测试消息，以及可选创建如流群。
- 两个平台均可按 Bot 配置允许接入的群，或开启「允许机器人所在的所有群 @ 调用」。该开关默认关闭，不改变私聊准入范围。

已接入的飞书群和如流群支持 Bot 派活：Bot 在回复中单独写一行 `@handle 具体任务`，目标 Bot 就会在自己的群聊 Session 中执行，并由自己的机器人回群。支持加粗、表格和同一行多个派活，也允许回派修复；同一条用户请求中每个 Bot 最多执行三次、最多十二次派活，同一任务不重复派发；引用、代码、普通提及和 Bot 回复中的 `@all` 不触发派活。私聊和 Web 聊天仍由用户消息驱动。

| 调用入口 | 触发方式 | 回复位置 |
| --- | --- | --- |
| Web 单聊 | 直接向 Bot 发消息 | 当前 Web 单聊 |
| Web 群聊 | 发送 `@handle` | 当前 Web 群聊 |
| 飞书单聊 | 私聊绑定的机器人 | 当前飞书单聊 |
| 飞书群聊 | 使用飞书原生 @ 选择机器人 | 当前飞书群聊 |
| 如流单聊 | 私聊绑定的机器人 | 当前如流单聊 |
| 如流群聊 | 使用如流原生 @ 选择机器人 | 当前如流群聊 |

同一个飞书群在 DSH 只显示一个群聊，各 Bot 保留自己的原生 Session。通过 DSH 创建的如流群也共享一个群聊。群里只执行被 @ 的机器人；回复由各自的机器人名称和头像标明身份，不额外添加内部 `@botId` 行。

## 从 npm 安装或更新

最低要求 **DSH 0.1.5-rc.2**，不再按每个 DSH 版本精确锁定。正常升级 DSH 后可继续使用同一套插件；启动及创建会话时检查所需接口。已验证版本、允许安装的范围和构建版本分别记录在 [compatibility.json](compatibility.json) 与 [dsh-version.json](dsh-version.json)。

本次版本使用 npm 的实验性 `next` 标签。

| 包 | 版本 | 用途 |
| --- | --- | --- |
| [@zzzpyyy/dsh-bot](https://www.npmjs.com/package/@zzzpyyy/dsh-bot) | `0.9.1` | 必装主包，提供 Web 聊天和 IM 配置面板 |
| [@zzzpyyy/dsh-bot-feishu](https://www.npmjs.com/package/@zzzpyyy/dsh-bot-feishu) | `0.5.1` | 可选，提供飞书连接和建群能力 |
| [@zzzpyyy/dsh-bot-infoflow](https://www.npmjs.com/package/@zzzpyyy/dsh-bot-infoflow) | `0.6.1` | 可选，提供如流连接；需能获取企业 SDK |

**安装时请指定版本号或 `@next`。** 下方命令固定安装本次版本；要安装当前 `next` 标签对应的版本，可使用 `@zzzpyyy/dsh-bot@next`、`@zzzpyyy/dsh-bot-feishu@next` 或 `@zzzpyyy/dsh-bot-infoflow@next`。只填写包名会使用 `latest`，截至 **2026-10-21**，该标签仍指向旧版。

上面同一套包已覆盖 DSH **0.1.5-rc.2** 与 **0.2.0-rc.2**，无需为它们选择不同的插件版本。更高 DSH 版本不会仅因版本号变化被拒绝，但尚未验证的版本不等于保证可用；如果上游删除或改变核心接口，仍需适配。飞书和如流包接受主包 `>=0.9.0 <1.0.0`，无需随主包的每次更新同步升级。详见[兼容策略与测试](docs/compatibility.md)。

在 **Desktop → 插件管理器** 安装 `@zzzpyyy/dsh-bot@0.9.1`，再按需向同一个 profile 添加配套插件。

飞书安装若报 `ERR_PNPM_IGNORED_BUILDS: protobufjs`，按[飞书安装说明](docs/feishu.zh.md#安装与开发)在目标 profile 中明确禁用该可选安装脚本，再重试。

已有兼容版本的 **DSH CLI Web profile** 可执行：

```sh
dsh plugin --profile web add @zzzpyyy/dsh-bot@0.9.1
# 可选：接入飞书
dsh plugin --profile web add @zzzpyyy/dsh-bot-feishu@0.5.1
```

如流额外依赖企业 SDK `@baidu/infoflow-sdk-nodejs@2026.8.28`。先在目标 profile 的包管理环境中配置组织授权的 `@baidu` registry，再安装如流配套包；公共包不附带私有 SDK 或凭据：

```sh
dsh plugin --profile web add @zzzpyyy/dsh-bot-infoflow@0.6.1
```

使用与当前服务相同的 `DSH_HOME` 和 profile。升级时先备份数据目录，等待正在执行的回复完成，停止 Host，将主包和已安装的配套包更新到上表版本，再重启。Bot 身份、绑定和历史继续保存在同一数据目录。安装配套包只提供配置入口，不自动创建机器人或启用尚未配置的连接。权限及配置步骤见[飞书接入](docs/feishu.zh.md)和[如流接入](docs/infoflow.zh.md)。

安装并启用后打开 **DSH Bots**，通过 DSH 原生设置配置模型。桌面端与 Web 复用同一份 Bot 代码，由所在版本的 DSH 提供原生连接（0.1 使用桌面管道，0.2 使用认证 Web Host）。桌面端使用自己的 DSH 数据，现有 Web 聊天不会自动导入。请勿同时启用另一份 Bot Mode。

已于 **2026-10-19** 验证上一版主包 `0.8.0` 和飞书包 `0.4.0` 在 **DSH 0.1.5-rc.2 与 0.2.0-rc.2** 上通过 npm 安装并启动 Desktop Host。上一版三个线上包的 SHA-512 校验值均与本地发布包一致。

安装包测试覆盖 Desktop Host、Web 认证和资源加载，以及两个 IM 配套插件的私聊/群聊路由、群内派活、重复消息、共享群和重启后的会话隔离。测试使用确定性模型和传输夹具，发布包不包含这些测试实现。Windows 桌面端尚未验证。

## Web 源码安装

需要 Git、**Node.js 24+**、**pnpm 11.7.0**、C/C++ 构建工具，以及一个 DSH 支持的模型服务。macOS 可通过 `xcode-select --install` 安装 Xcode Command Line Tools；Ubuntu 需要 `build-essential` 和 `python3`。源码安装会下载并构建 DSH 工作区，需要几分钟及数 GB 可用磁盘。macOS 已在本地验证，仓库 CI 配置了 Linux 检查；Windows 安装尚未验证。

```sh
npm install --global pnpm@11.7.0
git clone https://github.com/zzzpyyy/dsh-bot.git
cd dsh-bot
npm run setup
npm start
```

打开 `dsh web` 输出的带认证参数的地址，然后点击侧栏中的 **DSH Bots**。在 DSH 原生设置中配置模型，再创建第一个 Bot；有多个 Bot 后即可创建群聊。仓库不附带模型密钥，`npm start` 不会加载模拟模型。

安装脚本按 [dsh-version.json](dsh-version.json) 下载固定的 [DSH 提交](https://github.com/deepseek-ai/deepseek-harness/commit/639ed015397290b3745d163aafe02ffee4aa3f84)，将插件复制到独立的 `.runtime/deepseek-harness-<版本>` 工作区，补充 TypeScript 注册及插件锁文件条目，按冻结锁文件安装依赖，并构建原生 Web profile。修改插件源码后可运行 `npm run build:plugin` 增量构建；首次安装仍使用 setup。源码请改 `plugin/`，不要改 `.runtime/` 中的安装副本。安装脚本不会修改其他 DSH 安装。

源码插件保留内部工作区身份 `@deepseek-ai/dsh-experimental-bot-mode`，公共分发包以 `@zzzpyyy/dsh-bot` 包装其编译结果，不是 npm 上无 scope 的 `dsh-bot`。固定 DSH 版本只用于源码构建复现；npm 安装包使用独立的兼容范围。

## 端口、数据和工作目录

默认使用 **3093** 端口。端口已占用时可更换：

```sh
npm start -- --port 3094 --no-open
```

默认数据目录是 `.data/`，Bot 工作目录是 `.data/workspace/`，两者都已被 Git 忽略。也可以明确指定：

```sh
DSH_HOME="$HOME/.dsh-bot" DSH_BOT_WORKDIR="/path/to/your/project" npm start
```

DSH 按所选 preset 提供工具和审批，因此应明确选择 Bot 的工作目录。更新时保留数据目录，重新构建前先停止当前实例。前台服务可用 Ctrl+C 停止；本仓库的安装脚本不注册后台或开机启动服务。

遇到认证错误时，重新打开当前服务输出的完整地址。认证成功后，可以收藏普通地址，但需要使用相同的主机名、端口和浏览器配置；清除 Cookie 或认证过期后需再次认证。

## 配置

默认值见[插件参考](docs/plugin-reference.zh.md#configuration)。可创建本地 patch 覆盖配置，例如：

```yaml
- id: bot-mode
  config:
    historyMessages: 80
    maxBots: 8
    maxMessages: 10000
```

将其绝对路径传给 DSH 原生 CLI：

```sh
npm start -- --patch /absolute/path/bot-settings.patch.yml
```

## 当前限制

- 使用可扩展的 `standard` preset；`minimal` 等完整提示词 preset 会被拒绝。Bot 标识和 preset 创建后不可修改。
- 原生模型目录提供名称，不提供 token 单价。预算采用配置单价估算，并发调用先占用预留额度；单次实际用量仍可能超过预留。
- 左侧「用量」页面展示当前预算、估算费用、执行中预留和各 Bot 累计 Token，并区分记忆整理与上下文交接，每 15 秒刷新。独立调用账本支持日期、模型、聊天与用途筛选，保留缓存明细，删除聊天后仍可查询。统计口径见[功能使用说明](docs/capabilities.md)。
- 历史和去重窗口使用不可变分段及原子索引，Host 仍在内存中加载完整历史；存储保留策略和原生执行日志由部署者管理。
- 重启把未结算回复标为中断，不自动重跑不确定的模型／工具工作。平台确认丢失仍可能导致重复投递。
- 真实租户的权限、重连、通知送达需单独验收，详见[完成记录](docs/feature-completion.md)。

## 开发与验证

安装完成后运行：

```sh
npm run check
npm run build:plugin
npm test
npm run pack
npm run pack:feishu
npm run pack:infoflow
npm run test:install
npm run test:package
npm run test:feishu-package
npm run test:infoflow-managed-package
npm run test:im-isolation-package
npm run test:im-delegation-package
```

正式打包要求工作区干净且已提交，并检查构建与源码一致、包含 DSH 0.1 所需的 schema getter。`setup` 会自动执行兼容构建。仅在本地验证未提交改动时，可给每个 pack 命令追加 `-- --allow-dirty`；测试包的 `compatibility.json` 会记录 commit、dirty 标记和源码哈希，不应发布。


测试在准备好的 DSH 工作区中运行，覆盖消息路由、原生 UI 插槽和交互、持久化、停止与进程重启。`pack` 在 `dist/` 中生成编译包与校验和；`test:package` 将该压缩包解压到隔离 profile，验证 DSH 兼容性检查、Desktop / Web Host 认证、资源加载与重启恢复。桌面 Host 测试无需 Electron 或显示器。仅测试使用确定性模拟模型，无需 API Key。GitHub Actions 会从干净环境执行安装、构建和相同测试，并保留安装包作为 CI 附件，不自动发布 npm。`npm run test:install` 通过 DSH 统一插件管理器验证本地主包和飞书包；发布后可单独运行 `npm run test:registry` 验证 npm 线上安装；该检查需要访问公共 registry，不属于 CI。

详见[架构说明](docs/architecture.zh.md)、[完整插件参考](docs/plugin-reference.zh.md)和[版本说明](CHANGELOG.md)。更新 DSH 提交时需要同步集成补丁，并重新验证完整安装；其接口仍处于稳定前阶段。

## 许可

[MIT](LICENSE)。DeepSeek Harness 保留原项目许可和版权声明，详见 [NOTICE](NOTICE)。
