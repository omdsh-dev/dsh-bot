# InfoFlow connector

**UI visibility (since 0.8.0):** New profiles hide the InfoFlow tab and group creation option. Internal users can reveal them in **DSH Bots → IM connections → Advanced settings → Show InfoFlow integration (internal users)**. The preference persists in the profile and updates connected clients. Existing bindings, group records or chats preserve visibility on upgrade unless explicitly hidden. Hiding the entry does not stop connections or delete credentials and history; use each robot's connection switch to stop it. Visibility is a display preference, not an identity or access check.

Bot Mode 0.8.0 and the optional `@zzzpyyy/dsh-bot-infoflow@0.4.0` companion run on DSH 0.2.0-rc.2. Every Bot can bind a distinct InfoFlow robot with separate credentials, allowlists and an enable switch. The base package does not depend on the enterprise SDK.

One DSH Bot can keep both InfoFlow and Feishu bindings enabled concurrently. Each platform has independent credentials, allowlists and connection controls; disabling one leaves the other running. Web, Feishu and InfoFlow private and group chats retain separate histories and model conversation context, with replies delivered only to the originating platform and chat. Identical group names do not merge chats across platforms. Bot instructions, models and tool configuration remain shared. Files, external services and memory explicitly written through tools follow deployment permissions rather than conversation isolation. See the [Feishu guide](feishu.zh.md) for the second binding.

## Configuration page

The [guided setup](#guided-setup-and-messaging-test) supports credential import and connection testing. Saved secrets are write-only; blank credential fields preserve their current values. Stop any competing callback receiver before enabling the same robot here.

The companion enables the manager by default (`managed: true`), with no active robot connections until configured. Configure access to its pinned `@baidu/infoflow-sdk-nodejs@2026.8.28` dependency through your authorized enterprise registry. In a compatible DSH Web profile, install `@zzzpyyy/dsh-bot@0.8.0` and then `@zzzpyyy/dsh-bot-infoflow@0.4.0` with `dsh plugin --profile web add <package>`. Desktop uses the same package specifications in its plugin manager and needs the same enterprise dependency access. The public companion contains no private SDK or credentials. For source builds, use `npm run build:plugin`, `npm run pack` and `npm run pack:infoflow`; the CLI also accepts the resulting archives.

Open **DSH Bots → IM connections → InfoFlow** to configure robots. The same panel contains Feishu settings; switching platform tabs preserves unsaved form inputs.

## Optional group creation

The create-group dialog has an unchecked **Also create an InfoFlow group** option. Choose Bots, group owner and human members; every selected Bot must have an enabled binding. The default Bot's robot creates the group and invites all selected robots. Platform permissions are required. Partial invitation failures preserve the group and show a warning.

A durable request is stored before the remote call. Once returned, the group ID is saved before local association. Retrying that same request never creates another group. Known group IDs can recover their local association from the configuration page. Unknown timeout outcomes remain uncertain and require checking InfoFlow; automatic lookup or manually attaching an unknown-result group is not implemented.

Managed groups share one public Room and deduplicate a message delivered to multiple robot connections. Each mentioned Bot retains its own Session and sends its response through its own robot. Private chats and manually allowlisted existing groups remain separate per Bot. External rooms are read-only in the DSH UI, retaining stop and native execution navigation; send messages in InfoFlow.

Replies from page-managed bindings contain the original response body without an added `@botId` line; the platform robot's name and avatar identify the speaker. Literal mentions in the model's response remain intact. Legacy connectors that route multiple Bots through a single platform robot retain the text label for attribution.

## Admission and recovery

Only exact robot AT blocks trigger group processing. DMs require an allowed user. A managed group's owner can stop its tasks; configured admins can stop tasks in their Bot's admitted conversations. `/help`, `/bots`, `/status` and `/stop` remain available. Text, Markdown and links are supported; images, attachments and quoted-message routing are not. Native approval and question answerers stay DSH-owned. Tool access and credentials belong to the deployment, not individual InfoFlow users.

Settings and creation records live in `bot_infoflow_settings`; per-Bot and shared-group inboxes/outboxes use independent `bot_if_*` domains. Admission receipts persist before acknowledgements. BotMode atomically stores external message IDs with response attempts, so redelivery never reruns a model. Outbox confirmation loss can duplicate external replies. Interrupted execution is not replayed after a crash. Platform-side offline redelivery requires enterprise validation. The adapter stores string IDs, but extremely large group IDs remain subject to the SDK's internal numeric conversion.

Legacy single-robot configuration remains available with `managed: false`. Switching it to managed mode can seed its default Bot as a disabled binding; this does not migrate legacy queues or rooms. Drain existing work before switching. Back up DSH data before upgrading; older code may drop additive external fields on downgrade.

Tests use fixture SDKs and deterministic models, including production Desktop/Web Host loading, two robots, group deduplication, private isolation and restart continuity. They create no live group and send no live messages. See the [Chinese deployment guide](infoflow.zh.md) for configuration defaults and full recovery details.

`npm run test:im-isolation-package` loads both packaged companions in a native Host with the same Bot. It checks six entry points over multiple turns, independent connection controls, model inputs, reply destinations, duplicate events and durable isolation after restart. Build and pack the base and both companions before running it.

## Guided setup and messaging test

Open **DSH Bots → IM connections → InfoFlow**. The three-step guide links to the [InfoFlow platform](https://open-ruliu.baidu-int.com/web): create the app, copy credentials from Credentials and capabilities, and configure user/group visibility. Select a DSH Bot and paste labeled text or JSON into Paste all credentials, or enter the key and secret manually. Application ID is optional: the manager discovers it and rejects a supplied ID that disagrees with the verified robot. Clipboard parsing is local and performs no saving or sending.

**Save and connect** verifies identity, stores credential references, and enables the connection. **Verify and save** preserves the existing enabled state; a new binding remains disabled. Connection failure is reported separately from a successful save. Reset unsaved changes discards only the draft. Stored secrets remain write-only.

Private chats require saved allowed accounts. Groups can use an explicit ID list or the opt-in **Allow mentions in all groups containing this robot** setting. The latter admits any member of a platform-permitted group only when the event actually mentions this robot. It does not admit private chats or affect Feishu. Existing bindings keep their access rules during upgrade; absent `allowAllGroups` means false.

**Send test message** sends fixed diagnostic text to one saved allowed private-chat account. It neither starts the connection nor invokes the model or creates chat history. Sending is never automatic. Reply in InfoFlow with the connection enabled to verify inbound delivery and an answer. Platform send confirmation alone does not prove the full round trip. Error 40070 directs the user to check app visibility and whether the recipient follows the robot; SDK response bodies and credentials are not exposed. An uncertain send is not retried by the manager.
