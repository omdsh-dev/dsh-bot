# Bot capability completion

## Full parity follow-up (2026-10-23)

The complete follow-up is in progress. Checkboxes below mean implemented **and verified**, not planned or merely exposed in the UI.

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
- [ ] Container startup/restart/browser acceptance after the final launcher fix. The complete image builds successfully in a 4 GB Docker VM.
- [x] Native Electron entry and shortcut checks on macOS and Windows (CI `40107414842`; both platform jobs passed).
- [ ] Publish the clean release archives, verify registry installation, and upgrade the live profile.
- [ ] Live Feishu media and real-user inbound acceptance (external requirements below).

Current checkpoint: 236 source tests across 30 files and the launcher passed. Per-Bot grants passed real native MCP process/skill scope, shell variable selection, revocation, redaction and restart checks, plus DSH 0.1.5 and 0.2 Desktop/Web/shipped-client archive checks. Declarative cards passed native tool/form/restart, atomic duplicate-submission and client rendering checks. History/index and queued-result callback changes passed native DSH 0.2 Desktop restart, authenticated Web, shipped-client and IM delegation package checks. The prior usage/memory checkpoint also passed DSH 0.1.5 Host/client checks. Main Bot native tool/restart, authority isolation, atomic operations and explicit-grant UI checks passed. macOS, Linux and Node 22 passed the earlier history checkpoint; Linux, macOS, Windows, Node 22 and the older DSH runtime passed the browser checkpoint in CI `39983451136`. Connector tests explicitly disable unrelated background memory review. Isolated browser checks prove concurrent Bot cookie separation and fresh storage after cancellation on both DSH revisions.

Legacy accounting metadata that was never saved remains unknown. Live platform acceptance requires actual tenant access; offline tests do not establish it.

Pending release set: Bot 0.10.0, Feishu 0.6.0, InfoFlow 0.7.0.
This ledger describes implemented source and verification scope; publication is a separate step.

Release validation checkpoint (2026-10-24):

- The pending release archives passed compatibility metadata, native Desktop/Web, IM isolation/delegation, shipped-client and real Chromium isolation checks on both DSH 0.1.5-rc.2 and 0.2.0-rc.2.
- All 236 source tests, the authenticated launcher smoke, and the new container-config regression passed. All seven offline tests using the pinned real Feishu and InfoFlow SDKs passed, including a second run using the staged upgrade dependencies.
- Clean archives were prepared at commit `ba3a567d478cf5f39baf09adca33baa8ad3039bf`. Their 178 packaged runtime files match the previously tested release candidate; provenance metadata is distinct. Rebuild clean archives after the final launcher fixes are committed, before publication. Dirty development archives are not release artifacts.
- The complete container image builds in a 4 GB Docker VM with production TypeScript roots and project references preserved. Real startup tests caught both the unsupported container-IP address and the CLI guard against `0.0.0.0`. The launcher now retains `127.0.0.1` and Compose uses host networking. Runtime, persistence and Chromium acceptance of that fix are pending. Docker Desktop requires host networking to be enabled; Linux CI checks host reachability directly.
- The staged three-package upgrade starts successfully with the actual production DSH 0.1.5-rc.2 Host in an isolated profile. Authentication, Bot creation, usage/access/team APIs and both connector managers passed. This is staging verification, not a live upgrade.
- The live profile remains on Bot 0.9.1 / Feishu 0.5.1 / InfoFlow 0.6.1. At the last read-only check it contained six Bots, fourteen rooms, eleven connected bindings and two retained Feishu media failures. The upgrade must back up storage with the Host stopped and verify data and bindings after restart.

Final container acceptance, publication, registry installation and the live upgrade remain outstanding. CI `40107414842` passed Linux source/package checks, both desktop platforms, Node 22 and the older DSH runtime; its container job exposed the build configuration issue addressed by the current follow-up. The live service has not been restarted.

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
