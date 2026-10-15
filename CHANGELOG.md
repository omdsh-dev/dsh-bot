# Release notes

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
