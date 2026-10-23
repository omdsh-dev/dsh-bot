# 0.9 功能使用说明 / Capability guide

本页适用于主包 `0.9.1`、飞书 `0.5.1`、如流 `0.6.1`。发布进度与验收范围见[完成记录](feature-completion.md)。

## 聊天、历史与协作

「聊天与执行管理」提供聊天及 Bot 的归档、恢复和删除。归档保留历史与原生 Session；归档后不能接受新任务，关联定时任务暂停。删除清除公开聊天记录，原生执行日志仍归 DSH 管理。外部聊天保留去重墓碑，避免旧平台消息被重新执行；删除后的 Bot 标识不能复用。删除 Bot 前需停用其 IM 连接，所有排队及执行中的任务需先停止。删除本地私聊后，可从管理页为仍存在的 Bot 重新打开私聊。

聊天面板按 50 条加载历史；搜索会查询完整聊天，不限于当前页面。可导出 Markdown 或 JSON，包含消息状态、时间、错误及附件引用。导出不包含附件二进制或凭据。下载的文件按普通数据处理。

执行期间的新 Web 消息会持久化排队；每个聊天最多保留 100 个排队回复，按请求顺序执行。同一请求的多个 Bot 可以并行。停止排队回复不会启动 Agent；重启恢复尚未开始的排队工作，已经开始但未结算的工作标记为中断，不自动重跑。

网页群聊勾选「允许 Bot 在群内派活」后，Bot 可用独立的 `@handle 具体任务` 行派活。每个人工请求最多 12 次交接，每个 Bot 最多运行 3 次，重复任务不会重派。不开启时，模型输出中的 @ 不会启动其他 Bot。

在外部群中，DSH 输入默认只在 DSH 内可见。勾选「同步本条文字与 Bot 回复到群」后，本条文字和后续 Bot 回复进入持久投递队列。所有指定 Bot 必须已连接并获准在该群工作。附件会作为独立消息进入相同平台的投递队列；文件发送失败不会重发已成功的文字。此选项不会追溯发送之前的本地消息。

历史会自动按 128 条写入不可变分段，空闲聊天的主状态保留最近最多 256 条消息和分段索引；未完成任务、祖先请求和待回答问题会固定在尾部。分段先写、主索引后原子提交；写盘失败不会发布未提交记录。修改旧收据只替换对应分段，旧版完整快照会自动迁移，成员游标和外部收据保留。`maxMessages` 限制在途回复数量，不再限制聊天的累计历史。首次升级会读取旧历史来迁移用量和用户身份；以后启动只加载近期消息与未完成工作。普通分页只读取需要的分段，全文检索复用持久化倒排索引。发送、旧响应重试、导出和落后投递恢复按需加载单个聊天，执行结束后释放归档正文；活跃聊天的工作集仍可能随该聊天历史增长。去重／通知窗口也按固定绝对边界分段，淘汰旧记录只重写首尾段；待处理任务和投递与分段索引一起原子保存。备份时须同时保留主域、所有 `bot_history_*`、`bot_receipts_*` 域及原生附件。删除会移除公开聊天引用，历史分段和原生附件的物理清理由部署者管理；不能降级到忽略分段索引的旧插件。

## 模型、用量与权限

左侧「用量」打开独立用量页面，每 15 秒刷新，也可手动刷新。总览显示当前总预算周期的输入、输出、合计 Token 和估算费用；预算卡片展示各自周期、已用额度、执行中预留和剩余额度，可直接进入「管理预算」。按日／月重置以 UTC 为准。

「调用账本」独立于聊天与预算保存每次模型调用，支持按 Bot、UTC 日期、模型／供应商、聊天、用途筛选；可查看逐日趋势、分组统计、缓存读取／写入和最近 100 条调用明细。删除聊天、删除 Bot 或重置预算均不会删除账本。账本不保存提示词、回复或凭据，历史分段按需流式读取。

升级时只迁移已保留的聊天用量和辅助累计值：旧回复可能包含多次模型调用，旧辅助记录没有日期，缺失的模型、缓存、币种与历史单价保持未知；选择日期范围时不包含无日期的旧辅助累计。供应商已报告的 Token 与未知调用的预留结算分开展示，缓存 Token 已包含在输入中。费用按当时配置的单价估算，未配齐价格时显示未计价，不能把它理解为免费。原生 Bot 会话压缩通过公开 LLM 接口记入交接用量；独立会话标题生成仍归 DSH 管理，不纳入 Bot 账本。备份须包含主域和所有 `bot_usage_*` 域。

管理页会从 DSH 原生目录发现 provider、model 和工具名称，提供候选项；也允许填写未列出的模型 ID。原生目录当前没有 token 单价字段，费用单价仍需按供应商账户设置。两个字段都留空则继承 DSH。身份、模型和权限变更在 Bot 空闲时保存，下一轮生效。

预算累计模型返回的输入和输出 token；输入包含缓存读取和写入。费用使用每个 Bot 配置的「每百万 token 单价」估算，缓存输入按同一输入单价计算。费用预算启用时，未配置单价的 Bot 不会调用模型。`0` 表示关闭对应上限。重置用量要求所有 Bot 空闲。

可同时设置整个 profile 和每个 Bot 的额度，选择不重置、每日或每月 UTC 重置。每次模型调用先在串行事务中持久预留 token／费用，所有并发调用共享剩余额度；返回用量后替换预留值。需要配置每次调用的预留量，费用上限启用时费用预留必须大于 0。调用失败且供应商没有用量报告，或进程在调用期间崩溃时，按预留量保守记账，避免重启返还未知消耗。

实际用量可能超过预留量，此后会阻止下一次调用，因此这仍是估算预算而非严格预付费。DSH 标题等独立调用不计入 Bot 额度；Bot 会话压缩已计入，若压缩使用不同于 Bot 的模型，其费用保持未计价，启用费用上限时拒绝未定价调用。缓存输入沿用统一输入单价。已有费用累计时更换币种必须先重置，Bot 与总预算不做汇率换算。

工具权限支持继承部署设置、禁用全部工具、仅允许明确列出的完整工具名。守卫在实际工具派发时生效，包含嵌套调用。文件权限可选择继承、只读或仅工作目录可写；只收紧当前 Session 的原生沙箱模式，不能扩大部署权限。使用文件策略需要启用 DSH sandbox-policy 和对应的文件/命令执行沙箱；旧环境缺少能力时会拒绝本轮执行并给出原因。`cwd` 自身不提供隔离。

## 记忆治理与上下文

长期记忆页的「重复与冲突审核」集中展示同范围、同主体／主题的重复或差异。还可选择一个 Bot，对当前范围做语义检查，识别不同表述的重复和潜在矛盾；每次最多 80 条、10 万字符，使用该 Bot 的模型并计入预算。模型只提出建议，不会自动改写记忆。可查看两条原始记录和证据，编辑合并内容、采用其中一条或忽略建议。

合并使用乐观版本检查，并要求所属对象、可见范围、生效／到期时间一致；不得借合并扩大共享范围。旧记录成为可追溯的版本，遗忘合并记录会清除两条来源版本链及相关建议内容。编辑、遗忘、到期或账号关联变更只使受影响的 Bot／聊天上下文失效，无关聊天继续运行。历史聊天和 DSH 原生日志仍遵循原有保留策略。

每条 Bot 回复的「记忆与上下文」可查看当次召回记录、冲突组、召回次数、被预算省略的条数、上下文容量和分段交接摘要。旧回复没有保存召回明细时明确提示未知。Token 占用区分供应商报告、原生计量和保守字符估算。遗忘后的记录只显示已遗忘状态；受影响成员的交接摘要也被清除。

上下文管家优先保留尚未完成的提问续答；达到容量阈值时先尝试 DSH 原生压缩，再按剩余压力决定继续当前会话或生成交接摘要并建立新会话。记忆访问失效直接建立干净上下文，不能用旧摘要恢复已遗忘内容。压缩与交接仍受 Bot 预算、超时和取消约束；压缩决策在上下文面板可见。

## 图片、文件与语音

Web 可上传最多 8 个附件，每条消息总计不超过 20 MiB。图片支持 PNG、JPEG、WebP、GIF；其他文件存入 DSH 原生附件存储，模型按其工具能力读取。发送前验证原生引用，公开历史仅保存引用和元数据，不保存 base64。聊天内可预览图片、下载原附件，下载接口验证附件属于所选聊天消息，不能读任意本机路径。

模型和工具返回的原生 image/file 附件会收集到回复，并随回复投递给原 IM 会话；不会从模型文本中提取本机路径或任意 URL。单次回复最多展示／发送 8 个附件，多出的附件会提示在原生 Session 查看。飞书使用 image_key/file_key，超过飞书图片大小限制的图片改按文件发送。如流小于 1 MiB 的 PNG/JPEG 使用原生图片消息，其他图片和文件使用有效期 24 小时的下载链接，DSH 内的原附件仍可下载。

语音可上传音频文件，也可点击录音，最长 120 秒。必须在 DSH 中启用并准备好 speech-to-text 服务及识别器。规范的 16 kHz 单声道 PCM16 WAV 可直接转写；其他音频需主机 `PATH` 中有 ffmpeg，转换过程禁用文件和网络协议。无识别器或解码器时会显示可操作的错误，原音频不会被当作已经识别的文字。

飞书支持文本、富文本中的文字/图片、图片、文件和音频。机器人通过官方 SDK 的 messageResource 下载消息资源，需相应消息资源读取权限；音频使用上述 DSH 识别器。仍只接收真实用户发言，群聊要求准确 @ 当前机器人。

如流支持图片/文件/语音事件和混合消息。适配器通过 SDK 读取消息详情，再下载文件或使用平台提供的语音转写。图片短时 URL 仅允许官方 HTTPS 域，不持久保存；不跟随重定向。媒体描述在用户／群准入检查后先持久化，再下载或转写。平台暂未提供内容、权限缺失或识别服务失败会进入有上限的重试和失败队列，修复后可重试原消息；签名下载 URL 不写入队列。

## 实时进度、审批与失败恢复

Bot 面板显示生成中的文字、当前工具、工具完成状态和审批原因，可选择「允许一次」或「拒绝」。停止任务、关闭插件或审批过期会撤销待答审批；旧审批不能再次提交。审批卡显示完整工具参数；执行后的工具记录包含参数及原生工具提供的结果／文件差异详情。交互式问题可在聊天内选择选项或填写自由文本。定时问题超时后仍保留可回答的卡片，晚到回答会创建新一轮受 Bot 权限、预算、排队和停止约束的执行，不重跑原轮次。完整执行日志也可在原生 Session 查看。流式内容最多每 250 ms 推送一次，逐 token 更新不写盘。

「失败投递」列出已连接和已停用机器人的准入／媒体／发送失败、目标、内容、类别和次数。可单独重试或丢弃；发送重试不会重跑已接受的模型任务，保留原投递 ID。停用时可以查看、丢弃或重新入队，重新启用后才发送。平台确认丢失仍可能造成重复消息，特别是如流没有提供完全相同的幂等保证时。

## 定时任务与主动通知

每个聊天可配置单次、固定分钟间隔或按日历重复的任务，整个 profile 最多 100 项。固定间隔至少 1 分钟，`0` 为单次；单次时间输入为 UTC。日历规则选择 IANA 时区、当地时间和星期，可表达工作日、每天或每周某几天。夏令时跳过不存在的当地时间，重复小时每天只运行一次。任务支持编辑、暂停、继续和删除，并可查看分页运行记录、各 Bot 状态、回复与错误。只有显式保存并启用的任务会运行。

每次触发先把本次记录和聊天请求原子写入同一域，成功后才启动模型。进程重启后错过的循环合并为一次，不追赶全部历史周期。忙碌聊天进入普通队列；任务配置错误会暂停并保留错误。暂停或删除任务影响未来触发，已排队/执行的回复可在聊天中停止。

外部通知默认关闭。勾选「将任务回复发送到此 IM 会话」后，回复通过已连接且获准访问该会话的机器人投递。通知游标与出站记录同时保存，重启不会因重新扫描历史而再发一次。Host 需保持运行，插件不会唤醒关机或休眠的机器。

## 如流建群恢复

结果为「不确定」且没有已知群 ID 的记录，可填写已创建的群 ID 并选择继续完成。插件通过 SDK 核对群主和全部所选机器人是否在群中，再持久化关联；此路径绝不再次调用建群。若核对失败，先在如流调整群成员或确认群号再重试。

## English

Open **Chat & execution controls** for lifecycle, paginated full-text history, Markdown/JSON exports, per-Bot model/tool/file policy, token and estimated-cost budgets, schedules, and retained delivery recovery. New Web messages queue while work runs; group handoffs and IM synchronization require explicit checkboxes.

Media uses the deployment's native attachment store. Voice needs a configured DSH transcription provider; compressed recordings also need local ffmpeg. Tool and filesystem policies only narrow native permissions. Budgets gate subsequent model calls and can be exceeded by already-running calls; they are estimates rather than billing guarantees.

Schedules require a running Host, coalesce missed intervals, and reserve their prompt durably before execution. IM notifications default off. Failure retries retain the original delivery identity and do not replay accepted model work. Native Session logs remain managed by DSH when public chat records are deleted. Image preview/download, typed output attachments, inline questions, offline failure queues, calendar rules with IANA zones, per-Bot periodic quotas and concurrent reservations are included. History uses immutable chunks with an atomic manifest; idle transcripts remain archived across restart; pagination loads needed chunks and search reuses persistent inverted indexes. Active turns, exports and old-delivery recovery load the requested chat only, then release its idle history. Native catalogs advertise model and tool names, but do not supply token prices.


## Per-Bot capabilities and credentials

Open **Controls → Capability grants** to register a skill or MCP server and explicitly select its Bots. New entries have no grants. Skills accept native instruction text; MCP supports direct local processes (one literal argument per line, no shell expansion) or HTTPS Streamable HTTP. These entries mount in the selected native Agent scope for the current delivery and dispose on completion, stop or revocation. Deployment-wide native tools and skills retain their existing scope; Bot tool/file policies continue to narrow them.

Save secrets in the separate **Credentials** tab. Values use native DSH credential storage, never the Bot domain or ordinary snapshots, and are never read back into the form. `$DSH_SECRET_NAME` references are accepted in MCP environment values or headers, only when every assigned Bot also has that credential grant. Secrets cannot be placed in MCP arguments or URLs; sensitive headers require references. Updating values uses a fresh storage key, atomically publishes its grant, and retires the old key. Failed state writes roll back the new key; stale revisions cannot overwrite a newer grant.

Shell use requires an additional explicit per-Bot grant. Only variables referenced by that execution are injected; concurrent ungranted Bots receive no values. Common plaintext, JSON-escaped, URL and Base64 forms in tool results are redacted before entering the Session; outgoing model input containing a known value is rejected. This is defense in depth, not a general information-flow sandbox: arbitrary encodings, files, screenshots, third-party MCP diagnostics and native progress logs are outside that redactor. Grant only trusted processes and needed shell access. Revocation invalidates affected contexts, cancels active work and blocks later dispatch; it cannot undo effects of a process already run.


## Declarative chat cards

Bots can call `show_card` to add up to eight metric, table, progress or form cards beside a response. The Host validates bounded JSON; the client renders escaped data with native controls. No scripts, raw HTML, remote resources or executable action handlers are accepted. Reusing a card id updates its revision while the response is active. A form becomes available only after that response completes.

Submitting a form records its values and a new human message atomically, addressed to the original Bot. Duplicate retries return the same message id; stale revisions or changed repeat submissions are rejected. Work queues behind an active response. External group submissions stay local to DSH; platform private-chat forms are read-only. Forms do not approve native tools or platform delivery. Cards remain in paged history and exports, including submitted values after restart. IM recipients receive the Bot's text and media; cards are shown in DSH, so the tool asks Bots to include important findings in text as well.


## Main Bot team management

Open **Controls → Team management** to appoint one Main Bot and select individual operations: create/edit Bot identities, create/edit local groups, or archive/restore. Everything starts disabled. `team_list` and `team_manage` are available only during a direct local operator message to that Bot; external IM, local groups, schedules and delegated/callback deliveries carry no team authority. Grants are rechecked inside the state transaction, and changing them cancels affected work and invalidates its context.

The Main Bot cannot change its own identity, presets, model/tool/file policies, capability or credential grants, budgets, connector configuration, or delete data. Newly created Bots use the deployment default preset and receive no per-Bot grants. Group edits retain ordinary idle/membership validation; archiving Bots connected to external rooms requires the operator. Each request permits at most 20 successful changes. Native call IDs deduplicate retries; each successful mutation records actor, source response, operation, target and time atomically. The panel shows the latest 50 entries; the domain retains 500. Team listings expose identities and local group rosters, not private conversations or memories.


## 隔离浏览器

「管理 → 工具与凭据」可添加「隔离浏览器」并逐个授权 Bot。运行 `npm run browser:install` 安装固定 Playwright 版本的 Chromium，或填写已有 Chrome/Chromium 的绝对可执行路径。这里使用独立的无头浏览器进程，每次回复从空白浏览器状态开始；不会连接用户日常浏览器、读取个人登录目录，或在不同 Bot 之间复用 Cookie。停止、撤权和回复结束均销毁本次浏览器实例。

浏览器基于固定的 `@playwright/mcp`，工具由原生 MCP 加载。它可以访问当前部署可访问的网络，导航与点击仍属于该 Bot 的工具权限范围。需要保持登录的任务须在同一回复内完成；不支持跨回复保存登录状态。环境中的 `PLAYWRIGHT_MCP_*` 设置不会覆盖这一隔离模式。
