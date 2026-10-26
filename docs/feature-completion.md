# Bot capability completion

## Feishu group-name event fallback (2026-10-26)

Bot 0.12.3 and Feishu 0.6.2 add names from `im.chat.member.bot.added_v1` and `im.chat.updated_v1`. An allowed bot-join event can create the Web group before any message arrives; shared groups retain their default Bot and existing members. New registration requests `im:chat.members:bot_access` and both event subscriptions. Existing apps have Web setup guidance and direct permission links; their published app configuration is not changed automatically.

- Events do not query the metadata API, invoke a model, or send an IM message. The connector rejects other apps, invalid names and disallowed groups. Metadata failures retain event names; in-flight lookups and queued messages cannot restore an earlier name. Writes are serialized and drained on close, and failed event writes can be retried. Event ordering is tracked within the current connection; saved names survive restart, while cross-restart correction still relies on authorized group-information queries.
- Build/type checks, all 269 source tests and both launcher/container tests passed. The installed-package fixture uses the actual pinned SDK dispatcher with simulated Feishu transport: it verifies join/rename events, unknown allowed groups, rejected groups, shared membership/defaults, no message/model work, and restart persistence while every chat-information query returns `99991672`. All four real SDK contract tests also passed. The fixture is included in `test:feishu-package` and the compatibility matrix.
- Clean archives from `f3a96713bacb0bfd78544378d80a836591a46b86` passed all five event/Feishu/isolation/Desktop/Web package checks on each of DSH 0.1.5-rc.2 and 0.2.0-rc.2. The shipped client test passed, all 216 staged files matched the archives, and staged startup passed on the actual production runtime.
- Local rollout installed Bot 0.12.3 and Feishu 0.6.2 with the unchanged InfoFlow 0.7.1. Backup: `.runtime/live-upgrade-backups/2026-10-26T11-36-48-570Z`. Six Bots, fourteen chats and histories, two memories, two retained delivery failures and all access/team settings were preserved; all eleven IM connections reconnected. The live Web page shows the new hint, expandable event setup and the selected app's permission links. Read-only API verification still returns `99991672` for all six Feishu apps; all five InfoFlow apps continue reading group names successfully.
- InfoFlow 0.7.1 is unchanged. npm publication remains paused. Live permission/subscription configuration and receipt of real Feishu events remain external prerequisites; isolated fixtures do not claim tenant authorization.


## IM group name synchronization (2026-10-26)

Bot 0.12.2 with Feishu 0.6.1 and InfoFlow 0.7.1 now reads group names from the receiving robot's official group-information API. Incoming group messages carry the name through durable admission; already linked, still-authorized groups refresh in the background and after startup. The chat list and managed-group list use the same saved title. No IM messages or model calls are needed for name refresh.

- Metadata lookups coalesce, use a bounded cache/retry interval and wait at most three seconds for the provider. Missing permissions, empty names and network failures preserve the current name. Group identity, histories, members and default Bots are retained; private chats and groups belonging to other providers are excluded.
- Restart/reconnect no longer replays an old creation title over a synchronized name. A newly linked room that only has a provider/ID placeholder still receives the name supplied at creation, even when group-reading permission is unavailable.
- Feishu registration requests `im:chat:read`; existing bindings have a matching permission link and a synchronization explanation in the web page. The pinned InfoFlow SDK's numeric-ID conversion is guarded against unsafe integers.
- All 261 source tests passed before the final edge-case refinement; the affected tests passed again afterward (100 connector/owner tests, then 43 owner/refresh tests for the final refinement). Full Desktop/Web/restart/isolation package checks passed on DSH 0.1.5-rc.2 and 0.2.0-rc.2; both connectors were rechecked on both versions against the final 0.12.2 archive. The shipped client passed on DSH 0.2.0-rc.2; the final client/codecs differ only in diagnostic source-line numbers. Real-runtime staged startup and archive-byte verification also passed.
- Local rollout installed clean base commit `fa573de4911b1a280bafe8add67d49bbd293a6f3` with the companions from `95b4e66a940cf37ee03997d8eb755275e62ac2d0`. Backup: `.runtime/live-upgrade-backups/2026-10-26T07-34-09-001Z`. All six Bots, fourteen chats and histories, two memories, two retained delivery failures, access settings and Main Bot grants were preserved; all eleven IM connections reconnected. Browser verification confirmed the group list, synchronization hint and permission link.
- Read-only live checks succeeded for InfoFlow. Feishu currently returns `99991672` for existing applications; the user will enable `im:chat:read` and publish/approve the `dsh` and `reviewer` apps, which cover the three existing Feishu groups. Live Feishu title verification remains pending that external authorization. No real test messages were sent.
- npm authentication/publication is paused at the user's request. These versions are installed locally and have not been published to npm.

## Bot creation from Feishu and InfoFlow (2026-10-25)

Bot 0.12.0 lets the responding connection’s administrators create persistent local Bots through direct IM messages or directly addressed group messages. An ordinary Bot can provide this entry point without being appointed Main Bot. Creation returns the new Bot identity and the web path for IM binding; app authorization, credentials, access lists and external invitations stay in the web setup flow.

- The narrow `create_bot` tool uses the existing connection administrators (previously labeled stop-command administrators); page-managed InfoFlow groups use their owner. Existing administrator lists are not modified. A creation grant never includes `team_list`, `team_manage` or other Bots’ private instructions.
- Both tool installation and the state transaction check the current administrator, connection, conversation access and direct human delivery. Feishu private chat IDs and per-app Open IDs remain distinct; shared groups use the responding app’s authenticated sender mapping. Schedules, delegation, callbacks, local-only work and ordinary chat users have no creation authority.
- A successful transaction saves the Bot, its local private chat and an audit record with platform/account/sender. Native call IDs prevent duplicate creation; failed writes leave no partial Bot. Defaults apply without inheriting the creator Bot’s private grants. The web audit shows IM actors, and the IM forms describe administrator creation rights.
- All 251 source tests in 32 files and both launcher/container configuration checks passed. Authority, revocation, cross-app identity, failed persistence, duplicate calls and capability-directory isolation are covered.
- The clean archive from `5d50b2aaee70396e4fd828a51efd8259e61214e2` passed Desktop, authenticated Web, restart and shipped-client checks on DSH 0.1.5-rc.2 and 0.2.0-rc.2. The native model fixture creates real persistent Bots from both platforms’ private and group conversations, checks web binding guidance, rejects guest authority and verifies restart persistence. Only the external model and connector transports are simulated.
- Packaged IM isolation checks passed on both runtimes through the connector event handlers. General tools and all six Web/Feishu/InfoFlow histories remain isolated as before; only IM administrator deliveries gain `create_bot`. The old exact-tool-parity assertion was updated in `ac3af26` to verify this intended difference explicitly.
- All 214 staged files match the clean base archive and unchanged Feishu 0.6.0 / InfoFlow 0.7.0 archives. Staged startup passed on the actual production DSH runtime. No npm publication was attempted; public `next` remains Bot 0.10.0.
- The live local profile now runs Bot 0.12.0. The stopped-Host backup is retained at `.runtime/live-upgrade-backups/2026-10-25T06-20-45-768Z`. Six Bots, fourteen chats and their histories, two memories, both retained delivery failures, Main Bot grants and every IM administrator/access list were preserved; all eleven enabled bindings reconnected.
- Live read-only Chromium checks passed for the Feishu administrator form and narrow layout. The existing hidden InfoFlow preference was preserved; both platform forms and the narrow layout passed in an isolated preview with InfoFlow visible. No page errors, saved live setting changes or real outgoing IM test messages occurred. Evidence is under `.runtime/acceptance/im-bot-creation/`.

## Bot discovery and specialist recommendations (2026-10-25)

The previous local rollout installed Bot 0.11.0 from clean source `aa3b0f41d0545fa0fe545a8a7a349a0dc74cd4cf`. Feishu 0.6.0 and InfoFlow 0.7.0 remain unchanged. No npm publication was attempted; public `next` remains Bot 0.10.0.

Bot 0.11.0 adds a public capability description and read-only `discover_bots` for ordinary Bot conversations. Prompt guidance prioritizes an existing specialist, then suggests a useful new Bot only when appropriate. Discovery does not confer Main Bot management authority or permission to dispatch tasks.

- Capability results include names, public descriptions, current membership and routing eligibility; full Bot prompts, private histories, memories, credentials and policy internals stay out of the directory.
- Local operator chats can browse active Bots across the deployment. IM groups see eligible current members; IM private chats see only the responding Bot. Queries remain pageable when no metadata matches, and a missing description means unknown capability.
- Main Bot create/edit commands accept optional public descriptions. Existing records remain valid, and callers that omit the new field preserve it. Existing Bots and Main Bot grants are not silently rewritten.
- All 246 source tests passed. Native-profile tests exercise discovery without management grants, absence of unsolicited creation, external private isolation, public-description creation through team tools and persistence after restart. The external LLM is replaced by a deterministic test adapter for this verification.
- The final archive passed Desktop and authenticated Web package checks (including the deterministic discovery/creation fixture and restart) plus shipped-client checks on both DSH 0.1.5-rc.2 and 0.2.0-rc.2. All 212 staged files matched clean archives; staged startup on the actual production Host verified the new metadata with both companion managers.
- Browser preview checks cover public-description display/edit/save, unchanged private instructions and narrow layouts. The upgraded live profile passed read-only desktop and narrow-screen checks with no page errors, saved Bot changes or external messages.
- A stopped-Host backup is retained at `.runtime/live-upgrade-backups/2026-10-25T06-07-34-545Z`. Six Bots, fourteen chats and their histories, two memories, two retained delivery failures and the exact Main Bot grants were preserved. All eleven enabled IM bindings reconnected.

## Browsable Settings lists (2026-10-25)

Bot 0.10.2 adds automatic recent-history loading, an all-scope memory list with owner labels, and visible model/tool lists with optional filters. Custom model IDs, hidden tool selections, memory ownership and sharing defaults are preserved. The Host and recall isolation are unchanged. The prior local profile update installed Bot 0.10.3 from clean commit `00cd864548ce040a446c6325eb822bbb45810bb4`, including compact tool descriptions and immediate model-loading feedback. npm publication remains separate; the public base is still 0.10.0.

- All 242 source tests passed, including history filtering/pagination races, all-scope memory editing, model discovery failure/retry and filtered tool selections. After the final tool-list refinement, all 45 panel tests passed again. Distribution metadata, documentation links and whitespace checks passed.
- The final archive passed shipped-client checks on DSH 0.1.5-rc.2 and 0.2.0-rc.2, plus staged startup on the actual production Host. All 210 staged package files matched their clean archives; Host and RPC artifacts are byte-identical to 0.10.2 (and 0.10.1).
- Real Chromium checks passed against both an isolated preview and the upgraded live profile: populated memory lists, automatic history loading, visible model/tool lists, navigation, editing and narrow-screen layout, without page errors, saved-setting changes or outgoing messages.
- A stopped-Host backup is retained at `.runtime/live-upgrade-backups/2026-10-25T05-41-29-950Z`. The upgrade preserved six Bots, fourteen chats and their histories, two memories and both retained delivery failures. All eleven enabled IM bindings reconnected. Feishu 0.6.0 and InfoFlow 0.7.0 are unchanged.

## Simpler Settings (2026-10-25)

Bot 0.10.1 was installed in the live local profile from clean source commit `4c107bd19334d5da7fcf332a8a31b47dd7d0311b`. npm `next` remains Bot 0.10.0; this UI update has not been published to npm. Feishu 0.6.0 and InfoFlow 0.7.0 are unchanged.

- Settings opens with Memory, Model, Schedules and Chat history. Usage limits, Tools & accounts, Team management, Delivery issues and Archive & delete live under More settings.
- Memory and schedule forms open only when adding or editing. Memory editing shows one focused form; model permissions, prices and budget reservations remain available behind explicit disclosures.
- One-time schedules use browser-local time; interval and weekday repeats require an explicit choice. Saved permissions and existing schedules are preserved.
- Validation: 239 source tests passed before the final form-layout refinement; all 42 panel tests passed again afterward. The final archive passed shipped-client checks on both supported DSH revisions and a staged startup on the actual production Host. Host and RPC artifacts are byte-identical to 0.10.0.
- The stopped-Host backup and local upgrade preserved six Bots, fourteen chats and their histories, two memories and both retained delivery failures. All eleven enabled bindings reconnected. Desktop-width and narrow-width browser checks passed on the live profile, including settings navigation, forms and folded controls, with no page errors, saved-setting changes or outgoing messages.

## Full parity follow-up (2026-10-23)

Implementation, public npm publication and the live profile upgrade are verified. The external tenant acceptance items below remain outstanding. Checkboxes below mean implemented **and verified**, not planned or merely exposed in the UI.

- [x] Usage overview page and budget visibility (commit `117b936`; 199 source tests and native Host/client package checks).
- [x] Independent per-call usage ledger, date/model/provider/room/purpose queries and cache accounting.
- [x] Persistent full-text index and lazy historical transcript loading (idle archives stay unloaded; active work hydrates its chat on demand).
- [x] Memory semantic duplicate/conflict review, merge suggestions and scoped context invalidation.
- [x] Per-response recall evidence, context occupancy, segments and handoff inspection.
- [x] Per-Bot MCP, skills and credential capability grants/revocation.
- [x] Safe declarative metric/table/progress/form cards.
- [x] Main Bot team-management tools with explicit operator-granted authority.
- [x] Context steward decisions using public native compaction/rotation seams.
- [x] Per-Bot isolated browser capability, verified with real Chromium on both supported DSH revisions.
- [x] Linux/macOS/Windows regression matrix, including real browser isolation (CI `39983451136`).
- [x] Native Electron source entry and local double-click shortcut; macOS UI creation/usage/restart checks passed.
- [x] Container image build, authentication, non-root service, restart persistence and real Chromium. Final image passed locally inside the Docker VM; Linux host access passed in CI `40158827579`.
- [x] Native Electron entry and shortcut checks on macOS and Windows (CI `40107414842`; both platform jobs passed).
- [x] Upgrade the live profile with all three packages, preserve data and reconnect every enabled binding; verify new pages in a real browser.
- [x] Publish Bot 0.10.0 / Feishu 0.6.0 / InfoFlow 0.7.0 to npm `next`, download all three archives and verify exact bytes and tags. Bot and Feishu install through the real plugin manager and start Desktop on both supported DSH revisions.
- [ ] Live Feishu media and real-user inbound acceptance (external requirements below).

Current checkpoint: 236 source tests across 30 files and the launcher passed. Per-Bot grants passed real native MCP process/skill scope, shell variable selection, revocation, redaction and restart checks, plus DSH 0.1.5 and 0.2 Desktop/Web/shipped-client archive checks. Declarative cards passed native tool/form/restart, atomic duplicate-submission and client rendering checks. History/index and queued-result callback changes passed native DSH 0.2 Desktop restart, authenticated Web, shipped-client and IM delegation package checks. The prior usage/memory checkpoint also passed DSH 0.1.5 Host/client checks. Main Bot native tool/restart, authority isolation, atomic operations and explicit-grant UI checks passed. macOS, Linux and Node 22 passed the earlier history checkpoint; Linux, macOS, Windows, Node 22 and the older DSH runtime passed the browser checkpoint in CI `39983451136`. Connector tests explicitly disable unrelated background memory review. Isolated browser checks prove concurrent Bot cookie separation and fresh storage after cancellation on both DSH revisions.

Legacy accounting metadata that was never saved remains unknown. Live platform acceptance requires actual tenant access; offline tests do not establish it.

Published release set: Bot 0.10.0, Feishu 0.6.0, InfoFlow 0.7.0, all on npm `next`. The same verified packages are installed in the live local profile.

Release validation checkpoint (2026-10-25):

- The pending release archives passed compatibility metadata, native Desktop/Web, IM isolation/delegation, shipped-client and real Chromium isolation checks on both DSH 0.1.5-rc.2 and 0.2.0-rc.2.
- All 236 source tests, the authenticated launcher smoke, and the new container-config regression passed. All seven offline tests using the pinned real Feishu and InfoFlow SDKs passed, including a second run using the staged upgrade dependencies.
- Final clean archives record commit `82e4195c17ef213ff43f36800ea98681416b84d1`. Their 178 packaged runtime files match the previously tested release candidate; all 204 files in the staged packages match those archives. Dirty development archives are not release artifacts.
- The complete container image builds in a 4 GB Docker VM with production TypeScript roots and project references preserved. Real startup tests caught both the unsupported container-IP address and the CLI guard against `0.0.0.0`. The launcher now retains `127.0.0.1` and Compose uses host networking. Runtime, persistence and Chromium acceptance passed for the final image. Docker Desktop requires host networking to be enabled for host-browser access; Linux CI checks host reachability directly. The native CLI guard is unchanged.
- The staged three-package upgrade starts successfully with the actual production DSH 0.1.5-rc.2 Host in an isolated profile. Authentication, Bot creation, usage/access/team APIs and both connector managers passed. This is staging verification, not a live upgrade.
- The live profile was upgraded to Bot 0.10.0 / Feishu 0.6.0 / InfoFlow 0.7.0 on 2026-10-25 after a stopped-Host backup. Six Bots, fourteen rooms and their histories, two memories and two retained Feishu media failures were preserved. All eleven enabled bindings reconnected. Real-browser checks of Usage, Memory, Capability grants and Team management passed without page errors or external messages.

The final [CI run `40158827579`](https://github.com/zzzpyyy/dsh-bot/actions/runs/40158827579) passed every job: Linux source/package checks, container, macOS, Windows, Node 22 and the older DSH runtime. All three releases were published to npm `next` on 2026-10-25. Fresh registry metadata, tags and downloaded tarball bytes matched the clean local artifacts. Bot 0.10.0 and Feishu 0.6.0 passed real registry installation and Desktop startup on DSH 0.1.5-rc.2 and 0.2.0-rc.2. The live local release uses these same verified archives.

- [x] Bot/room edit, archive, restore, delete; queued Web messages and bounded group handoffs.
- [x] Paginated history, search/export and automatic immutable history and deduplication-window segments. The atomic manifest retains all receipts and positional cursors; settled history no longer consumes the in-flight limit.
- [x] Image/file/audio input, image preview and native attachment download. Typed model/tool image/file output enters the IM outbox independently from text.
- [x] Full approval arguments, tool results/file-change metadata, inline choices/free-text questions and owned continuations for expired timed questions.
- [x] Durable media admission before download/transcription, bounded retries, individual retry/discard, and inspection/requeue while a robot is disabled.
- [x] Native model/tool catalog suggestions with manual fallback; per-Bot and profile budgets, UTC daily/monthly resets and durable concurrent call reservations.
- [x] One-shot/interval schedules, IANA time zones, weekday calendar rules, DST handling and dedicated paginated run history.
- [x] Explicit external notifications and Web message/attachment synchronization; uncertain InfoFlow groups can be attached after owner/member verification without another create call.
- [x] Permission/setup guidance and source regression coverage, including storage failures, restart recovery, native SDK media formats and cancellation.
- [x] Publish Bot 0.9.0, Feishu 0.5.0 and InfoFlow 0.6.0 to npm `next`; download all three registry archives and verify byte integrity and tags against clean local archives.
- [x] Install the published Bot 0.9.0 and Feishu 0.5.0 through both DSH revisions' real plugin manager and start Desktop. The DSH 0.2 check passed after retrying a transient npm connection reset.
- [x] Publish Bot 0.9.1, Feishu 0.5.1 and InfoFlow 0.6.1 to npm `next`; all three registry archives were downloaded and matched local integrity and tags. The published Bot and Feishu packages installed through both DSH revisions' plugin managers and started Desktop. These releases fix optional Cordis service access, classify SDK-thrown Feishu HTTP permission rejections as permanent, recover InfoFlow BOS objects after 40900 overwrite conflicts and upgrade official BOS HTTP download links to HTTPS.
- [x] Live outbound acceptance in the dedicated test groups: all ten Bot connections reconnected after restart; native uploads and downloaded-byte hashes, real-model replies and one-shot schedules passed, and temporary schedules were deleted. InfoFlow text, image and file delivery cleared the outbox; the file link was fetched over HTTPS with HTTP 200 and matching bytes. Feishu text replies and schedules were accepted.
- [ ] Feishu media output: the tenant app lacks `im:resource` (error 99991672), reconfirmed through the official application-scope API on 2026-10-24. The operator cannot grant it currently, so live media acceptance is deferred. Delivery fails permanently after one attempt without blocking later text; preserve the two retained failures and retry only after the permission is available.
- [ ] Inbound tenant image/file/voice from real users has not been tested live; source and real-SDK offline checks cover the formats.

Operational limits are explicit in the [capability guide](capabilities.md): budgets are estimates and an individual call can exceed its reservation; native catalogs do not publish token prices; active chat work can still hydrate one complete transcript on demand; unreferenced history chunks and native attachments require deployment-level retention management. InfoFlow file links expire after 24 hours. Plugin upgrades must preserve every storage domain and must not be downgraded to a version that ignores archive manifests.

Verification uses real DSH storage, profile restarts and the real pinned platform SDKs with offline HTTP responses. Offline tests cannot establish real tenant permissions or live service delivery. No uncertain model execution is replayed automatically.

Verification: 165 source tests across 19 files, the authenticated launcher smoke, four real Feishu SDK tests and three real InfoFlow SDK tests passed. The same release archives passed DSH 0.1.5-rc.2 and 0.2.0-rc.2 Host/client checks, plus four Node 22 package tests. DSH 0.1's registry-only installer is checked after publication. Distribution metadata and local documentation links passed.

Bot 0.9.1 and Feishu 0.5.1 archives record clean source commit `dc5c26119c0f6866fbd6502fd4d97adb7e2d9fa6`; its [GitHub CI run](https://github.com/zzzpyyy/dsh-bot/actions/runs/39587023366) passed. InfoFlow 0.6.1 records clean commit `92d27c284941753d2d4f8ac7a7fbf9f0eaadbe3f` and passed its package, managed, isolation and delegation checks on both DSH revisions, plus Node 22 package checks.
