# Bot capability completion

Release set: Bot 0.9.1, Feishu 0.5.1, InfoFlow 0.6.1.
This ledger describes implemented source and verification scope; publication is a separate step.

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
- [ ] Publish Bot 0.9.1, Feishu 0.5.1 and InfoFlow 0.6.1 follow-ups. Live tests exposed undeclared direct access to optional Cordis services and SDK-thrown HTTP permission errors; both are corrected with native-profile and real-SDK regressions. The source suite passes; final archives and registry checks are in progress.
- [ ] Live tenant acceptance: the existing dedicated test groups received test requests. All ten configured Bot connections reconnected after local restart. Native uploads, downloaded-byte hashes, real-model replies and one-shot schedule execution passed; temporary schedules were deleted. Feishu media delivery is blocked by platform permission error 99991672 (im:resource). InfoFlow text/image sending succeeded, while the BOS file-upload gateway returned 40900; the gateway reports that the object already exists. Recovery reuses that object, requests a fresh URL and upgrades official BOS HTTP links to HTTPS, with real-SDK regressions. External reply/notification delivery and inbound tenant-media acceptance remain to be verified.

Operational limits are explicit in the [capability guide](capabilities.md): budgets are estimates and an individual call can exceed its reservation; native catalogs do not publish token prices; history still hydrates in memory; unreferenced history chunks and native attachments require deployment-level retention management. InfoFlow file links expire after 24 hours. Plugin upgrades must preserve every storage domain and must not be downgraded to a version that ignores archive manifests.

Verification uses real DSH storage, profile restarts and the real pinned platform SDKs with offline HTTP responses. Offline tests cannot establish real tenant permissions or live service delivery. No uncertain model execution is replayed automatically.

Verification: 165 source tests across 19 files, the authenticated launcher smoke, three real Feishu SDK tests and one real InfoFlow SDK test passed. The same release archives passed DSH 0.1.5-rc.2 and 0.2.0-rc.2 Host/client checks, plus four Node 22 package tests. DSH 0.1's registry-only installer is checked after publication. Distribution metadata and local documentation links passed.

The release archives record clean source commit `a47334e9b5f5c57837cd2deae91d8d0a1139a95e`. Its [GitHub CI run](https://github.com/zzzpyyy/dsh-bot/actions/runs/39581381032) passed all three jobs: build-and-test, older-runtime and node-22. Incremental builds now type-check Host and Client tests as well as production code.
