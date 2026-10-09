# DSH Bot

中文 | [English](README.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的原生多 Bot 聊天插件。给每个 Bot 设置名字和职责，可以私聊，也可以把多个 Bot 拉进同一个群聊。每位成员都保留自己的 DSH Session、工具和审批记录。

这是独立的实验性社区插件，不是 DeepSeek 官方产品，与 Grok、Cue、Muse 没有关联。

## 能做什么

- 创建 Bot，设置 handle、显示名称、职责和 DSH Agent preset。
- 每个 Bot 拥有唯一私聊，也可以明确选择成员创建群聊。
- 用 `@handle`、`@all`、`@everyone` 指定接收者；点击成员头像即可插入 @。
- 搜索与筛选聊天、引用回复、停止回答、重试失败回答。
- 打开成员的原生执行 Session，查看流式输出、工具调用、问题与审批。
- 重启后继续聊天，支持中英文、明暗主题和窄屏布局。

只有用户发送消息或点击重试才会调度 Bot，Bot 的回复不会自动触发其他 Bot。

## 快速开始

需要 Git、**Node.js 24+**、**pnpm 11.7.0**、C/C++ 构建工具，以及一个 DSH 支持的模型服务。macOS 可通过 `xcode-select --install` 安装 Xcode Command Line Tools；Ubuntu 需要 `build-essential` 和 `python3`。源码安装会下载并构建 DSH 工作区，需要几分钟及数 GB 可用磁盘。macOS 已在本地验证，仓库 CI 配置了 Linux 检查；Windows 安装尚未验证。

```sh
npm install --global pnpm@11.7.0
git clone https://github.com/zzzpyyy/dsh-bot.git
cd dsh-bot
npm run setup
npm start
```

打开 `dsh web` 输出的带认证参数的地址，然后点击侧栏中的 **DSH Bots**。在 DSH 原生设置中配置模型，再创建第一个 Bot；有多个 Bot 后即可创建群聊。仓库不附带模型密钥，`npm start` 不会加载模拟模型。

安装脚本按 [dsh-version.json](dsh-version.json) 下载固定的 [DSH 提交](https://github.com/deepseek-ai/deepseek-harness/commit/c291e7961a515f6d7af9304e7fd1d257929aef26)，复制插件，补充 TypeScript 注册及插件锁文件条目，按冻结锁文件安装依赖，并构建原生 Web profile。修改插件源码后再次运行 setup。源码请改 `plugin/`，不要改 `.runtime/` 中的安装副本。安装脚本不会修改其他 DSH 安装。

插件保留内部工作区名称 `@deepseek-ai/dsh-experimental-bot-mode` 和 `private: true`；这个版本通过 GitHub 分发源码，尚未发布 npm 包，不能通过 `npm install dsh-bot` 安装，也不承诺兼容任意 DSH 版本。

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

- 群聊在回答完成后显示回复；逐字输出、工具和审批位于对应成员的执行 Session。
- 所有 Bot 继承 DSH 的模型选择，尚不支持每 Bot 单独选模型、编辑身份、自动交接、定时任务和外部 IM 接入。
- 使用可扩展的 `standard` preset；`minimal` 等完整提示词 preset 会被拒绝。
- 重启会把尚未结束的公开回复标为中断，不自动重发。涉及工具执行时，重试前请查看原始 Session。
- 暂不支持删除 Bot / 聊天和大历史分页。移除成员后重新加入会创建新的 Session，并保留公开历史。

## 开发与验证

安装完成后运行：

```sh
npm run check
npm test
```

测试在准备好的 DSH 工作区中运行，覆盖消息路由、原生 UI 插槽和交互、持久化、停止与进程重启。仅测试使用确定性模拟模型，无需 API Key。GitHub Actions 会从干净环境执行安装、构建和相同测试。

详见[架构说明](docs/architecture.zh.md)、[完整插件参考](docs/plugin-reference.zh.md)和[版本说明](CHANGELOG.md)。更新 DSH 提交时需要同步集成补丁，并重新验证完整安装；其接口仍处于稳定前阶段。

## 许可

[MIT](LICENSE)。DeepSeek Harness 保留原项目许可和版权声明，详见 [NOTICE](NOTICE)。
