# 0.9 功能使用说明 / Capability guide

本页描述当前源码中的功能。`0.9.0` 主包与飞书 `0.5.0`、如流 `0.6.0` 尚未发布；npm 已发布版本见 README。

## 聊天、历史与协作

「聊天与执行管理」提供聊天及 Bot 的归档、恢复和删除。归档保留历史与原生 Session；归档后不能接受新任务，关联定时任务暂停。删除清除公开聊天记录，原生执行日志仍归 DSH 管理。外部聊天保留去重墓碑，避免旧平台消息被重新执行；删除后的 Bot 标识不能复用。删除 Bot 前需停用其 IM 连接，所有排队及执行中的任务需先停止。删除本地私聊后，可从管理页为仍存在的 Bot 重新打开私聊。

聊天面板按 50 条加载历史；搜索会查询完整聊天，不限于当前页面。可导出 Markdown 或 JSON，包含消息状态、时间、错误及附件引用。导出不包含附件二进制或凭据。下载的文件按普通数据处理。

执行期间的新 Web 消息会持久化排队；每个聊天最多保留 100 个排队回复，按请求顺序执行。同一请求的多个 Bot 可以并行。停止排队回复不会启动 Agent；重启恢复尚未开始的排队工作，已经开始但未结算的工作标记为中断，不自动重跑。

网页群聊勾选「允许 Bot 在群内派活」后，Bot 可用独立的 `@handle 具体任务` 行派活。每个人工请求最多 12 次交接，每个 Bot 最多运行 3 次，重复任务不会重派。不开启时，模型输出中的 @ 不会启动其他 Bot。

在外部群中，DSH 输入默认只在 DSH 内可见。勾选「同步本条文字与 Bot 回复到群」后，本条文字和后续 Bot 回复进入持久投递队列。所有指定 Bot 必须已连接并获准在该群工作。附件保留在 DSH，平台消息会提示在 DSH 查看。此选项不会追溯发送之前的本地消息。

## 模型、用量与权限

管理页中可为各 Bot 填写 DSH 已注册的 provider 和 model ID；两个字段都留空则继承 DSH。身份、模型和权限变更在 Bot 空闲时保存，下一轮生效。

预算累计模型返回的输入和输出 token；输入包含缓存读取和写入。费用使用每个 Bot 配置的「每百万 token 单价」估算，缓存输入按同一输入单价计算。费用预算启用时，未配置单价的 Bot 不会调用模型。`0` 表示关闭对应上限。重置用量要求所有 Bot 空闲。

预算在下一次模型调用前检查；已经发出的并行调用可能超出剩余额度。供应商未返回的用量、进程崩溃前未落盘的用量、DSH 自身标题/压缩等独立调用不在 Bot 统计保证内。这里不是供应商账单或严格预付费扣款。

工具权限支持继承部署设置、禁用全部工具、仅允许明确列出的完整工具名。守卫在实际工具派发时生效，包含嵌套调用。文件权限可选择继承、只读或仅工作目录可写；只收紧当前 Session 的原生沙箱模式，不能扩大部署权限。使用文件策略需要启用 DSH sandbox-policy 和对应的文件/命令执行沙箱；旧环境缺少能力时会拒绝本轮执行并给出原因。`cwd` 自身不提供隔离。

## 图片、文件与语音

Web 可上传最多 8 个附件，每条消息总计不超过 20 MiB。图片支持 PNG、JPEG、WebP、GIF；其他文件存入 DSH 原生附件存储，模型按其工具能力读取。发送前验证原生引用，公开历史仅保存引用和元数据，不保存 base64。

语音可上传音频文件，也可点击录音，最长 120 秒。必须在 DSH 中启用并准备好 speech-to-text 服务及识别器。规范的 16 kHz 单声道 PCM16 WAV 可直接转写；其他音频需主机 `PATH` 中有 ffmpeg，转换过程禁用文件和网络协议。无识别器或解码器时会显示可操作的错误，原音频不会被当作已经识别的文字。

飞书支持文本、富文本中的文字/图片、图片、文件和音频。机器人通过官方 SDK 的 messageResource 下载消息资源，需相应消息资源读取权限；音频使用上述 DSH 识别器。仍只接收真实用户发言，群聊要求准确 @ 当前机器人。

如流支持图片/文件/语音事件和混合消息。适配器通过 SDK 读取消息详情，再下载文件或使用平台提供的语音转写。图片短时 URL 仅允许官方 HTTPS 域，不持久保存；不跟随重定向。平台未提供下载引用或转写结果时会拒绝处理附件，不伪造内容。媒体处理在用户/群准入校验之后进行。

## 实时进度、审批与失败恢复

Bot 面板显示生成中的文字、当前工具、工具完成状态和审批原因，可选择「允许一次」或「拒绝」。停止任务、关闭插件或审批过期会撤销待答审批；旧审批不能再次提交。详细参数、工具输出、交互式问题和完整执行日志仍可打开原生 Session 查看。流式内容最多每 250 ms 推送一次，逐 token 更新不写盘。

「失败投递」列出当前连接队列中的准入/发送失败、目标、内容、失败类别和次数。可单独重试或丢弃；发送重试不会重跑已接受的模型任务，保留原投递 ID。停用的机器人须重新连接后读取其持久队列。平台确认丢失仍可能造成重复消息，特别是如流没有提供完全相同的幂等保证时。

## 定时任务与主动通知

每个聊天可配置单次或循环任务，整个 profile 最多 100 项。界面明确标注首次运行时间为 UTC；循环间隔至少 1 分钟，`0` 为单次。任务支持编辑、暂停、继续和删除。只有显式保存并启用的任务会运行。

每次触发先把本次记录和聊天请求原子写入同一域，成功后才启动模型。进程重启后错过的循环合并为一次，不追赶全部历史周期。忙碌聊天进入普通队列；任务配置错误会暂停并保留错误。暂停或删除任务影响未来触发，已排队/执行的回复可在聊天中停止。

外部通知默认关闭。勾选「将任务回复发送到此 IM 会话」后，回复通过已连接且获准访问该会话的机器人投递。通知游标与出站记录同时保存，重启不会因重新扫描历史而再发一次。Host 需保持运行，插件不会唤醒关机或休眠的机器。

## English

Open **Chat & execution controls** for lifecycle, paginated full-text history, Markdown/JSON exports, per-Bot model/tool/file policy, token and estimated-cost budgets, schedules, and retained delivery recovery. New Web messages queue while work runs; group handoffs and IM synchronization require explicit checkboxes.

Media uses the deployment's native attachment store. Voice needs a configured DSH transcription provider; compressed recordings also need local ffmpeg. Tool and filesystem policies only narrow native permissions. Budgets gate subsequent model calls and can be exceeded by already-running calls; they are estimates rather than billing guarantees.

Schedules require a running Host, coalesce missed intervals, and reserve their prompt durably before execution. IM notifications default off. Failure retries retain the original delivery identity and do not replay accepted model work. Native Session logs remain managed by DSH when public chat records are deleted.
