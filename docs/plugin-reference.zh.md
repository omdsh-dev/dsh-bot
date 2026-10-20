---
description: "原生 DSH Bot：固定私聊、显式群成员，以及每个成员独立的持续 Session。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-bot-mode

[English](plugin-reference.md) | 中文

可选如流插件通过 Host 内部 `ensureExternalRoom` 和 `submitExternalMessage` 进入 BotMode，这两个方法不暴露为 Remote。外部消息 ID 与响应一起提交，发送者以 JSON 数据写入模型日志。详见[如流接入](infoflow.zh.md)。

## 概述

Bot Mode 为现有 DSH Web 界面增加具名 Bot 和共享群聊。每个 Bot 有一个固定私聊，并在每个群中拥有独立的持续 Session。这个私有实验插件复用原生 Agent 运行时、存储后端、生成的 Remote API 和界面插槽。

## 目录

- [使用 Bot Mode](#use-bot-mode)
- [配置](#configuration)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-bot-mode"></a>
## 使用 Bot Mode

在本分发仓库的根目录准备 DSH 并加载插件：

```sh
npm run setup
npm start -- --no-open
```

打开 DSH 输出的网址，点击侧栏的 **Bots**。模型通过 DSH 现有设置配置。创建 Bot 时填写英文标识、显示名称、职责说明和可扩展的 Agent 预设（默认 `standard`）。创建群聊时显式选择已有 Bot；后来创建的 Bot 不会自动加入已有群聊。

使用 `@handle` 指定成员，`@all` 或 `@everyone` 邀请所有当前成员，也可以回复某个 Bot 的回答。显式提及优先于回复路由；否则由默认成员回答。私聊始终发给自己的 Bot。代码、引用块和邮件地址不会触发提及。执行期间发送的新消息会持久化排队；调整成员需要先完成或取消全部排队和运行中的回复。停止会取消一个回复；重试会为当前成员未成功的回复创建新尝试。

**打开执行会话** 会进入该成员原本的 DSH 对话，其中有流式输出、工具调用、提问和审批控件。通过 **Bots** 返回群聊。成员 Session 由 DSH Session Controller 管理；插件卸载时会取消并等待自己发起的回复任务结束。

<a id="configuration"></a>
## 配置

覆盖文件中的 `bot-mode` 行接受以下配置：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `cwd` | Host 工作目录 | 新成员 Session 的工作目录 |
| `defaultPreset` | `standard` | 新建 Bot 的默认预设 |
| `historyMessages` | `80` | 每次投递最多包含的未读、已完成公开消息数 |
| `maxBots` | `8` | 单个聊天的成员上限（最多 16） |
| `maxMessages` | `10000` | 每个聊天的公开消息上限；不自动淘汰历史 |

记录保存在 `bot_mode` 存储域，使用部署已有的 `storageDomain` 后端。独立的 Session 日志由 DSH 保存。启动时会将未完成的公开回复标记为已中断，不会排入替代请求。对于执行结果不确定的任务，重试前应查看成员的执行会话。

聊天列表支持按名称或 Bot 标识搜索、筛选群聊或私聊，并按最新消息排序。固定头像区分发言者；Bot 回复采用开放的 Markdown 正文排版，用户消息使用浅色气泡。鼠标悬停或键盘聚焦时显示消息操作。聊天信息展示职责、默认回复成员及每位成员的原生执行 Session。创建 Bot、建群和成员管理使用弹窗。点击群成员标签会插入 @ 提及，保留草稿且不自动发送。在输入框中输入 `@`，通过方向键和回车选择成员；回车发送，Shift+Enter 换行，输入法组合输入不会触发发送。列表底部的按钮可展开或收起 DSH 侧栏；窄面板通过聊天列表按钮切换列表。

<a id="implementation"></a>
## 实现

Host 服务 `ctx.botMode` 管理 Bot 身份、固定私聊、成员、公开历史和显式路由，通过生成的 `bots` Remote 命名空间提供 `snapshot`、`createBot`、`updateBot`、`createGroup`、`setMembers`、`send`、`stop`、`retry` 和 `follow`。开始模型执行之前，一次串行存储提交会同时预留用户消息和所有回复尝试。人的显式发送和重试会调度 Bot；启用派活的外部群还会将已完成回复中的独立 `@handle 任务` 行转换为同群子任务。每个 Bot 最多执行三次，每个人类请求最多十二次派活；平台推送的机器人消息仍被忽略。

`sessionController.create` 使用成员稳定的 Session id 和预设创建或恢复会话。作用域内的系统提示贡献应用 Bot 身份，直接从 DSH 打开该 Session 时也会生效。每个回复观察自己的持久化输入回执和 Turn，并等待 Agent 静止后发布最终公开文本。原生界面中后续 Turn 的输入不会归属到该回复。每个成员的游标用于补充未读公开消息，不复制私聊记录。

Client 挂载自身生成的 Remote 贡献，接收首次基线和后续变更快照，并注册 `bots` 主面板键与侧栏入口。不依赖 React 的模型对象管理业务状态，组件通过框架绑定的可观察钩子读取数据。不新增独立 HTTP 服务、SDK 子进程、核心循环修改或默认发行依赖。不提供 invariant 导出：存储校验和真实 profile 测试覆盖了完全由本插件拥有的关系。

<a id="model-experience"></a>
## 模型体验

### Bot 身份与共享历史

#### 模型看到什么

作用域内的 `bot-mode.identity` 系统段落定义 Bot 身份和职责。每次人工投递都会将有界的未读、已完成公开消息 JSON 快照、显式回复引用（如有）和当前人的请求写入持久日志。其他参与者的文本被标记为数据。工具可用性与权限仍由选定的 DSH 预设和部署决定。

#### Token 影响

每个 Bot Session 的身份增加固定的系统前缀开销。新投递追加公开上下文和当前请求；公开快照排除当前请求，避免原文重复。原有私有 Session 历史继续遵循预设的正常压缩机制。消息条数上限不是 token 预算。

#### KV Cache 影响

同一成员 Session 在连续轮次间保留原有请求前缀，新公开消息改变追加的后缀。预设压缩或部署提示提供方的变化可能影响缓存复用；插件不保证供应商缓存命中。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Bot 面板显示实时文字、工具进度和单次审批；IM 平台在回复完成后收到结果，完整日志仍可在原生执行会话查看。
- 每 Bot 模型、工具/文件权限、预算和定时任务已加入「聊天与执行管理」。不提供无界自主对话、其他 IM 适配或跨聊天记忆。
- `minimal` 等锁定完整提示词的预设无法容纳额外 Bot 身份，会在投递前被拒绝。请使用 `standard` 或可扩展的自定义预设。
- 群消息和 Session 日志使用不同的持久存储。两次提交之间崩溃时，DSH Turn 可能已经完成，而公开回复仍标记为已中断；重试前应检查执行日志。不承诺外部工具恰好执行一次。
- 移除成员会保留公开历史；重新加入时创建新的成员 Session。原有被移除的 Session 仍能从 DSH 访问。
- 浏览器订阅只携带近期窗口和未完成工作，更早历史按页读取。持久化仍为整个域的快照；不支持独立 Python 原型 SQLite 数据迁移。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者阅读的工作上下文——点击展开</summary>

[原生插件决策](architecture.zh.md) 说明了原生集成与分发方式。真实 profile 测试只替换外部模型，覆盖 Loader 组合、身份、群聊与私聊隔离、停止、订阅顺序和进程重启。

</details>

归档、删除、媒体、预算、定时任务和失败补发详见[新功能使用说明](capabilities.md)。
