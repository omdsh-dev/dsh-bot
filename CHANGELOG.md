# Release notes

## Unreleased reliability fixes

- Skip unchanged Bot/bridge writes; recheck cancellation immediately before submitting a turn; release in-memory running state if settlement persistence fails.
- Keep human input in user messages, preserve unread running siblings, and close storage on startup failure.
- Bound admission/delivery retries, quarantine failed work, release the ingress lock during stops, and bound receipt/notice retention.
- Isolate Feishu token caches, escape generated mentions, retain uncertain group UUIDs on HTTP 5xx, and reject resuming terminal group requests.
- Ignore all bound InfoFlow robots and indented-code handoffs; clean replaced credential references.
- Clean builds, verify compatible codecs/source hashes, and require committed release inputs; local test archives explicitly record dirty provenance.

## 0.8.0 — 2026-10-18

Bot `0.8.0`, Feishu `0.4.0`, and InfoFlow `0.5.0`. Upgrade the relevant companion with the base package to enable group handoffs; new companions require Bot `>=0.8.0 <1.0.0`.

- Fix group delegation: standalone `@handle task` lines can dispatch another connected Bot in the same Feishu or InfoFlow group, including configured existing groups. Previously they were delivered as text without executing the target. Concrete review fixes may revisit earlier participants; each Bot runs at most three times, with twelve total handoffs and no duplicate tasks, with no cross-platform or private-chat dispatch.
- Return each delegated result through its own robot, preserve the original sender for stop/approval handling, and persist delivery progress across restart. Robot-originated IM events remain excluded.
- Include native robot mentions in committed handoffs (InfoFlow agent IDs and Feishu Open IDs), and send an immediate acknowledgement from running targets. Keep mention identities and acknowledgement progress in the durable outbox so retries cannot create another task.
- Send InfoFlow robot mentions as native text with one combined human/robot AT block. Markdown hid the robot mention, and separate AT blocks caused the live API to reject the message with error 40067 and stall the outbox.
- Resolve permitted peer Bots on the first message in an all-groups-enabled chat, so delegation does not require each Bot to have received an earlier message. Keep the latest human request and its restrictions explicit in delegated context.
- Respect InfoFlow's 2048-character group Markdown limit, including retained oversized replies from older versions, so a long result cannot permanently block later replies in that group.
- Add Feishu's per-Bot option to allow mentions in all groups containing the robot, matching InfoFlow. It defaults off, survives restart, preserves existing group lists, and does not widen private-chat access.
- Keep generated Remote codecs compatible with both DSH 0.1's schema property and DSH 0.2's schema factory. Validate shipped Client contributions with each runtime's real registry to catch startup failures.
- Hide InfoFlow configuration and group creation for new profiles. Internal users can enable **IM connections → Advanced settings → Show InfoFlow integration**; hidden configuration does not poll the connector.
- Persist visibility in the DSH profile and share it with connected clients. Existing InfoFlow bindings, groups or chat history keep the entry visible on upgrade until a user explicitly hides it. Hiding the entry retains connections, credentials and conversations.

## 0.7.0 — 2026-10-15

One artifact set for DSH `0.1.5-rc.2` and `0.2.0-rc.2`: Bot `0.7.0`, Feishu `0.3.0`, InfoFlow `0.4.0`.

- Separate the build pin from runtime compatibility. DSH peers declare a minimum supported version, and companion peers accept Bot `>=0.7.0 <1.0.0` instead of one exact release.
- Own the five UI icons to avoid upstream export renames. Check required Host, Agent, Client and credential operations before using them.
- Test the same archives on both DSH revisions, including UI interactions, native Desktop/Web transports, both IM platforms, isolation, duplicate events and restart. CI builds once and reuses those artifacts on the older runtime.
- Admission of future versions does not promise compatibility with future breaking interfaces. Older than DSH `0.1.5-rc.2`, other Cordis major versions and data downgrades are not supported.

## 0.6.0 — 2026-10-15

Targets DSH `0.2.0-rc.2` with `@zzzpyyy/dsh-bot@0.6.0`, `@zzzpyyy/dsh-bot-feishu@0.2.0`, and `@zzzpyyy/dsh-bot-infoflow@0.3.0`. DSH `0.1.5-rc.2` users should keep the previous package set.

- Rebuild all three packages against the pinned DSH 0.2.0 runtime and exact matching peers, resolving the installation rejection of the 0.5.0 package on DSH 0.2.0.
- Adapt the Client locale project reference and native icon exports to the new DSH UI packages.
- Qualify archives through the new shared plugin installer and authenticated Desktop Web Host; retain the negative compatibility regression and conversation restart checks.
- Keep managed source runtimes in versioned directories so preparing a newer runtime does not overwrite an older checkout.
- Update installation and compatibility documentation. Local `.agents` notes remain excluded from Git and npm.

## 0.5.0 — 2026-10-15

Published under the experimental `next` tag: `@zzzpyyy/dsh-bot@0.5.0`, `@zzzpyyy/dsh-bot-feishu@0.1.0`, and `@zzzpyyy/dsh-bot-infoflow@0.2.1`. Requires DSH `0.1.5-rc.2`; InfoFlow additionally requires authorized access to its enterprise SDK.

- Unified IM configuration panel for Feishu and InfoFlow, with independent per-Bot bindings, credentials, access rules and connection controls. One Bot can use both platforms concurrently while keeping Web, Feishu and InfoFlow conversation histories separate.
- Optional Feishu 0.1.0 companion supports official QR registration, binding existing applications, private chats, group mentions and one-click group creation. Registration requests messaging and group-creation permissions.
- Each Feishu group has one shared DSH chat with a separate native Session per Bot. Shared-message deduplication, legacy-room migration and durable creation records preserve replies and avoid duplicate groups during recovery.
- InfoFlow 0.2.1 adds guided setup, local credential import, save-and-connect, explicit group access and diagnostic messages. Group creation failures and uncertain outcomes retain recoverable state.
- Managed IM replies use their platform robot's identity without an extra internal `@botId` line. Packaged Host regressions cover both platforms, shared groups, reply routing, duplicate events and isolation across restart.

## 0.4.0 (unreleased)

- InfoFlow 0.2.0 companion adds a configuration page: each Bot can bind a distinct robot, verify its identity, save credentials through DSH, and enable or disable its own connection.
- Group creation can optionally create an InfoFlow group and invite the selected Bots' robots and human members. Durable creation records prevent blind retries after uncertain outcomes; known groups can recover their local association.
- Multiple robots in the same managed group share message deduplication and public history, while retaining separate Bot Sessions and sending each result through its own robot.
- Legacy configuration can seed one disabled binding. Native credentials remain write-only in the UI. Existing local chats keep their IDs and history.
- Native package tests cover two robot identities, shared-group deduplication, separate replies, private chats, and restart continuity. No live group or message is created by tests.

## 0.3.0 (unreleased)

- Optional InfoFlow 0.1.0 companion: exact robot mentions, allowlists, isolated external DMs and shared groups, durable queues, deduplication, sender/admin stop, delivery retries, and native human-interaction notices.
- Host-only idempotent external ingress, additive v1 storage compatibility, named human senders, and read-only external rooms in the UI.
- Separate private SDK dependency, disabled-by-default companion bundle, and incremental build with refreshed Remote codecs.
- Deterministic fault-injection and real-profile crash/restart coverage. Live enterprise SDK/gateway validation remains a deployment step.

## 0.2.1

Published as `@zzzpyyy/dsh-bot@0.2.1` on npm under the experimental `next` tag. Compatible with DSH `0.1.5-rc.2`.

- Verified registry installation through the real Desktop plugin manager, followed by a native Host group-chat test in a fresh profile. `npm run test:registry` makes this post-publication check reproducible.

- Remove the declaration-only `dsh-client-ui-slots` runtime peer, which is not supplied by the production Desktop package set.
- Test against the exact first-party dependency closure selected by Desktop's own packaging code, excluding development-only packages.
- Supersedes the withdrawn 0.2.0 GitHub preview. No 0.2.0 npm package was published.

## 0.2.0 (withdrawn preview)

Compiled plugin bundle for DSH Web and Desktop `0.1.5-rc.2`.

- Public bundle manifest and activation patch, with the generated implementation identity preserved inside the archive.
- Exact peer dependencies for host-owned DSH packages, ordinary dependencies kept separate, and no lifecycle scripts or test fixtures in the release package.
- Archive tests through the real Desktop Host and Web transport, including dependency mismatch rejection, Bot context isolation, cancellation, and Session continuity across Desktop restarts.
- macOS Electron interaction check: open DSH Bots, send `@all`, and receive two Bot replies using a test model.
- Bilingual installation/compatibility documentation and CI archive artifacts.

The GitHub prerelease includes the compiled `.tgz` and SHA-256 checksum. npm publication is pending; Desktop's registry-only plugin manager cannot install the GitHub attachment directly. Other DSH versions, registry installation, and Windows Desktop have not been verified.

## 0.1.0

Initial experimental source release of the native DSH Bot Mode plugin.

- Persistent Bot identities, canonical private chats, and explicit multi-Bot groups.
- Mention/reply routing, cancellation, retries, and native execution Session navigation.
- Chat search/filtering, quick member mentions, chat details, and bilingual responsive UI.
- Pinned DSH setup, isolated default data, installation checks, and CI build/profile tests.

Uses DSH `0.1.5-rc.2` at `c291e7961a515f6d7af9304e7fd1d257929aef26`. This is a GitHub source release, not an npm publication. See the README for requirements and current limitations.
