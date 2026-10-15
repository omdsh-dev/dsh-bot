# 飞书机器人创建与绑定调研

核验日期：2026-10-15。范围：飞书官方公开文档、官方开源仓库和官方发布的 npm 包。未登录账户、未申请设备码、未创建真实应用、未发送消息。

## 结论

**支持。DSH 可以提供“选择 Bot → 扫码创建飞书机器人 → 自动绑定”的入口。** 飞书官方 Node SDK 已公开 `registerApp()`；用户在飞书确认后，服务端直接拿到 App ID / App Secret，可保存到 DSH 凭据服务并绑定当前 Bot。它是独立于 OpenClaw 的通用 SDK 能力，无需把 OpenClaw 安装进 DSH。这里的“一键”仍包含用户扫码和在飞书页面确认，不能解释成无人工授权的后台批量创建。[Node SDK 官方说明](https://github.com/larksuite/node-sdk#app-registration)、[注册实现](https://github.com/larksuite/node-sdk/blob/main/scene/registration/index.ts)

飞书官网也明确展示了 OpenClaw 插件中的新建、关联已有机器人、扫码确认流程，并说明多个机器人可以对应不同 Agent。这提供了产品层面的佐证。[飞书官方 OpenClaw 插件指南](https://www.feishu.cn/content/article/7613711414611463386)

## 可直接使用的官方能力

| 能力 | 已核实行为 | DSH 对应实现 |
| --- | --- | --- |
| 创建应用机器人 | `registerApp` 无需预先传入应用凭据；创建完成返回 `client_id`、`client_secret` | 每个 Bot 单独发起注册，凭据保存后建立绑定 |
| 扫码/链接授权 | `onQRCodeReady` 返回 `url` 和 `expireIn`；支持取消、拒绝、过期、轮询降速 | 页面显示二维码和链接、剩余时间、取消和重试 |
| 应用预设 | `appPreset` 支持名称、描述、头像；用户仍可修改 | 预填 DSH Bot 名称和说明 |
| 强制创建新应用 | `createOnly: true` 隐藏选择已有应用入口 | 新建动作避免覆盖其他接收服务的应用配置 |
| 关联或更新已有应用 | `appId` 可指向已有应用，由用户重新确认配置；也可直接校验手填凭据 | 提供独立的“绑定已有机器人”入口 |
| 消息通道 | SDK 包含 `Client`、`WSClient`、`EventDispatcher`；当前包还导出 `createLarkChannel` | 可实现私聊、群聊 @ 接收与机器人回复 |
| 群管理 | 官方群管理方案支持创建群、添加用户和应用机器人 | 可保留“创建聊天时同时创建飞书群”的可选步骤 |

注册字段、优先级和状态以[官方类型定义](https://github.com/larksuite/node-sdk/blob/main/scene/registration/types.ts)及[实现](https://github.com/larksuite/node-sdk/blob/main/scene/registration/index.ts)为准；消息通道见[官方 Node SDK](https://github.com/larksuite/node-sdk)和[官方 Channel SDK](https://github.com/larksuite/channel-sdk-node)；群管理见[飞书开放平台方案](https://open.feishu.cn/solutions/detail/groups?lang=zh-CN)。

## 协议与版本证据

检查公共 npm registry 返回的最新版本为 **`@larksuiteoapi/node-sdk@1.75.0`**，并下载发布包核对其类型声明，确认真实发布包导出 `registerApp`、`AppAddons`、`createLarkChannel`，并非只有主分支文档写了尚未发布的接口。[npm 版本元数据](https://registry.npmjs.org/@larksuiteoapi/node-sdk/1.75.0)、[发布包](https://registry.npmjs.org/@larksuiteoapi/node-sdk/-/node-sdk-1.75.0.tgz)

发布包 SHA-256：`2a26629713077eb580193d4ccd0fb6e39428ee53dfecf00b954fd933d6109f63`。

官方实现使用基于 RFC 8628 的设备授权流程：向 `https://accounts.feishu.cn/oauth/v1/app/registration` 发起 `begin`，类型为 `PersonalAgent`；再用私有的 `device_code` 轮询。成功结果包含应用凭据，以及可选的创建者 `open_id`、租户品牌。Lark 租户可自动切换域名。DSH 应调用 SDK 公共方法，避免自行维护这些底层请求。[注册实现](https://github.com/larksuite/node-sdk/blob/main/scene/registration/index.ts)

判断：**这是有文档、类型和已发布实现的官方集成接口，可以接入产品；没有证据支持“所有租户、权限和审批都无条件自动通过”的承诺。** 固定 SDK 版本、对错误和取消做处理，并保留手填凭据作为恢复路径。

## 权限、事件与发布的边界

SDK 的 `addons` 可以预填应用身份/用户身份权限、事件订阅和回调；`preset: false` 表示以仅含机器人能力的最小模板为基础。配置要在扫码页面由用户确认。默认模板之外的增量配置依赖平台灰度开关：**官方类型注释明确说明，未开启时参数可能整体被忽略，回到默认注册流程**。SDK 还不校验权限名称是否在平台目录中，未知项目可能被页面忽略。[AppAddons 类型说明](https://github.com/larksuite/node-sdk/blob/main/scene/registration/types.ts)、[编码与校验实现](https://github.com/larksuite/node-sdk/blob/main/scene/registration/addons.ts)

因此 DSH 应在注册完成后检查实际机器人身份和所需权限，区分“已绑定”“待完善权限”“已连接”。不要仅因为拿到了凭据，就把整个收发链路显示为已验证。推荐仅申请 DSH 消息收发需要的应用身份权限；无需为了基础聊天申请用户身份的日历、云文档等权限。

事件订阅方式、请求 URL、加密信息不能通过 `addons` 配置。官方 README 指向独立的应用配置更新 OpenAPI。若需要调整这些字段，应通过受支持的配置 API 或让用户在开放平台完成，并检查发布状态。[更新应用配置](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/application-v7/application-v7/application-config/patch)

飞书官方 OpenClaw 安装流程表明标准扫码创建后可直接打开机器人对话；但其权限排障仍要求在开放平台补充权限、创建版本、确认发布。企业管理员亦能限制应用权限。因此不能把标准模板的便捷创建推广为任意配置都免发布、免审批。[官方安装及权限排障](https://www.feishu.cn/content/article/7613711414611463386)、[官方企业治理说明](https://www.feishu.cn/content/article/7615520954977881029)

## 与群 Webhook 机器人的区别

| 方案 | 身份/凭据 | 主要用途 | 是否适合每个 DSH Bot 的双向聊天 |
| --- | --- | --- | --- |
| 应用机器人 | App ID / App Secret，应用权限与事件订阅 | 接收私聊/群消息、发送回复、调用授权 API | 是，本次应使用此方案 |
| 群自定义 Webhook 机器人 | 特定群的 Webhook URL，可附签名密钥 | 外部系统向群推送通知 | 不能仅靠推送 Webhook 完成 DSH 所需的双向事件接收 |

飞书官方自定义机器人教程定位为将其他来源消息通过 Webhook 推送至群；官方应用 SDK 则提供消息接收事件与长连接。[Webhook 官方说明](https://www.feishu.cn/content/7271149634339422210)、[SDK 事件与长连接](https://github.com/larksuite/node-sdk#long-connection)

## CLI 与 DSH 的取舍

官方 `lark-cli config init --new` 也会生成用户授权 URL，用户完成页面操作后结束配置。CLI 还提供 OAuth 用户登录和大量飞书业务命令，但这些不是基础机器人注册和消息连接的前置条件。直接使用 SDK 更适合 DSH 的服务端生命周期、页面状态和现有凭据服务；不要额外运行 OpenClaw 安装器改变用户配置。[官方 CLI 快速开始](https://github.com/larksuite/cli#quick-start-ai-agent)

## 建议的页面行为

1. 保留“如流接入”，并列增加“飞书接入”，每个 DSH Bot 可以分别绑定自己的应用机器人。
2. “扫码创建并绑定”只发起注册会话；页面展示目标 Bot、机器人名称预设、权限用途、飞书确认链接/二维码。
3. 用户在飞书完成确认后，凭据仅在服务端进入现有 credential provider；页面只显示 App ID、机器人名称、授权者和连接状态。
4. 注册会话应绑定 Bot ID 和随机会话 ID，取消、过期或替换后拒绝迟到的结果；限制同一 Bot 同时只有一个注册任务。
5. 保留“绑定已有机器人”表单，支持凭据验证、独立启停和失败修复。重复绑定同一应用到多个 Bot 应明确拒绝，避免长连接竞争。
6. 若继续提供自动建群，在用户勾选后调用群 API；持久化建群请求及返回的群 ID 后再创建本地映射，避免超时重试产生重复群。

以上是基于已核实接口的工程建议，不表示已在用户的飞书租户完成真实注册或收发测试。真实端到端验证需要用户在飞书完成一次扫码确认。

## 实施补充：Node SDK 1.75.0

### Channel API 与生命周期

以下接口已在 1.75.0 发布包的 `types/index.d.ts` 和 `lib/index.js` 核对，并与[官方 Channel 源码](https://github.com/larksuite/node-sdk/blob/main/channel/channel.ts)、[Channel 使用文档](https://github.com/larksuite/node-sdk/blob/main/docs/channel.zh.md)交叉检查。

```ts
const channel = createLarkChannel({
  appId,
  appSecret,
  source: 'dsh-bot',
  cache: new DefaultCache(),
  includeRawEvent: true,
  policy: {
    requireMention: true,
    dmMode: 'allowlist',
    dmAllowlist: [ownerOpenId],
  },
  safety: { chatQueue: { enabled: false } },
});

const unsubscribe = channel.on({
  message: async (message) => {
    // 先验证发送者、群名单，再将消息存入 DSH 自己的持久队列。
    // 此处不等待模型生成，保持平台事件处理及时返回。
  },
  reconnecting: () => { /* 更新状态 */ },
  reconnected: () => { /* 更新状态 */ },
  error: (error) => { /* 记录脱敏后的入站错误 */ },
});

await channel.connect();
const identity = channel.botIdentity; // { openId, name, userId? }
const status = channel.getConnectionStatus();
// status.state: idle | connecting | connected | reconnecting | failed

await channel.send(chatId, { markdown: answer }, { replyTo: messageId });
unsubscribe();
await channel.disconnect();
```

这段展示 API 形状，`message` 中的 DSH 业务检查和队列需要自行实现。`connect()` 先查询 `/open-apis/bot/v3/info`，再等首次 WebSocket 握手（15 秒超时）；运行中自动重连。`send` 返回 `{ messageId, chunkIds? }`，出站失败直接抛异常，不能只监听 `error` 事件。验证 App Secret 可仅调用 `Client.request({url:'/open-apis/bot/v3/info',method:'GET'})`，无需建立长连接。[Channel 实现](https://github.com/larksuite/node-sdk/blob/main/channel/channel.ts)

`NormalizedMessage` 主要字段是 `messageId`、`chatId`、`chatType`、`senderId`、`content`、`rawContentType`、`resources`、`mentions`、`mentionedBot`、`mentionAll`、`createTime`、`rootId`、`threadId`、`replyToMessageId`。`includeRawEvent: true` 可以保留 `sender.sender_type` 等原始字段。官方代码实际将结构化 @ 记录放入 `mentions`，包含通过 `isBot` 标记的当前机器人；使用 `mentionedBot` 判断是否提及本机器人，不应依赖文档中“mentions 不含机器人”的描述。[Channel 类型](https://github.com/larksuite/node-sdk/blob/main/channel/types.ts)、[提及解析实现](https://github.com/larksuite/node-sdk/blob/main/channel/normalize/mentions.ts)

实际实现需要处理三处已识别的 SDK 行为：

- **多应用缓存隔离**：默认缓存是进程全局 `internalCache`，消息去重 namespace 默认 `channel:seen`。同一个群消息可能推送给多个机器人，若复用默认缓存，后来的通道会被当成重复消息过滤。每个绑定传独立 `new DefaultCache()`；DSH 的持久去重另按业务需要区分应用、群、消息。[去重实现](https://github.com/larksuite/node-sdk/blob/main/channel/safety/dedup-cache.ts)
- **名单空值语义**：`groupAllowlist: []` 表示不限制群；`dmMode: 'pair'` 当前仍按开放处理。DSH 若要求“空群名单不接收”，应在自己的入站层明确检查；私聊使用 `allowlist`。[策略实现](https://github.com/larksuite/node-sdk/blob/main/channel/safety/policy-gate.ts)
- **连接失败清理**：1.75.0 的 `disconnect()` 在内部 `connected` 尚为 false 时直接返回，初始连接失败/取消期间不会关闭底层连接。应至少显式 `rawWsClient?.close({})` 并防止迟到结果恢复连接；内部去重清理定时器在该路径也无法通过公共接口释放。考虑到 DSH 的严格生命周期，**直接使用 `WSClient`、`EventDispatcher` 和 `normalize`，将持久队列、去重、取消和连接资源交给 DSH 管理，比依赖 Channel 的失败态清理更可控**。[生命周期实现](https://github.com/larksuite/node-sdk/blob/main/channel/channel.ts)

### 最小消息权限与可选建群权限

私聊、用户在群内 @ 机器人、机器人回复的注册参数可使用：

```ts
addons: {
  preset: false,
  scopes: {
    tenant: [
      'im:message.p2p_msg:readonly',
      'im:message.group_at_msg:readonly',
      'im:message:send_as_bot',
    ],
  },
  events: { items: { tenant: ['im.message.receive_v1'] } },
}
```

这是所需权限集合，仍须按前述灰度与确认页限制核查实际结果。若只支持人类发送指令，不申请 include_bot 权限，并在入站层再次检查 `sender_type === 'user'`。事件可能重推，官方要求按 `message_id` 去重。[接收消息事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive)、[发送消息权限](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create)

可选自动建群再增加 `im:chat:create`。若需要建群后补加机器人或成员，另需 `im:chat.members:write_only`。无需为了上述基础能力一次性申请用户身份的文档/日历权限。[创建群](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat/create)、[添加群成员](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat-members/create)

### 建群参数与跨应用身份

```ts
await client.im.v1.chat.create({
  params: {
    user_id_type: 'open_id',
    uuid: persistedRequestId,
    set_bot_manager: true,
  },
  data: {
    name: roomTitle,
    owner_id: ownerOpenIdForThisApp,
    user_id_list: memberOpenIdsForThisApp,
    bot_id_list: otherBotAppIds,
    chat_type: 'private',
    chat_mode: 'group',
    group_message_type: 'chat',
  },
});
```

官方限制与 DSH 对应行为：

- `owner_id`、`user_id_list` 的 ID 类型由 `user_id_type` 决定。同一用户在不同应用中的 `open_id` 不同，因此注册 A 返回的创建者 ID 不能直接给 B 建群。以群的默认 Bot 所绑定应用发起创建，并使用该应用注册结果中的 owner ID；其他成员也必须填该应用视角的 ID。
- `user_id` 在同一租户跨应用一致，但涉及 `contact:user.employee_id:readonly` 权限；`union_id` 只保证同一开发商下的应用一致，不应假设任意应用都可通用。
- `bot_id_list` 传机器人 **App ID（`cli_...`）**。创建群的机器人会自动入群，不必重复填写。一次最多额外邀请 5 个机器人，群内总数不超过 15；最多同时邀请 50 个用户。
- 同 `uuid + owner_id` 的创建请求在 10 小时内最多创建一个群；UUID 最大 50 字符。DSH 应保存稳定 UUID 及群 ID，超过去重窗口不能盲目重建。
- API 可以创建普通群并选择对话/话题消息形式，不能把 `group_message_type: 'thread'` 宣称为创建真正的“话题群”。

以上均来自[创建群接口](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat/create)。若超过创建时可附带的 5 个其他机器人，先保存群 ID，再串行调用 `client.im.v1.chatMembers.create`，参数 `member_id_type: 'app_id'`，每批不超过 5 个；保存未加入名单并单独恢复该步骤。[添加群成员接口](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat-members/create)
