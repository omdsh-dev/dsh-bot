# Bot capability completion

Release set: Bot 0.9.0, Feishu 0.5.0, InfoFlow 0.6.0.
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
- [ ] Live tenant acceptance: Feishu/InfoFlow media permissions, delivered content, reconnect and notifications. No test destination has been supplied; no live IM message or group has been created for this acceptance run.
- [ ] Publish the final clean archives and verify npm integrity and tags.

Operational limits are explicit in the [capability guide](capabilities.md): budgets are estimates and an individual call can exceed its reservation; native catalogs do not publish token prices; history still hydrates in memory; unreferenced history chunks and native attachments require deployment-level retention management. InfoFlow file links expire after 24 hours. Plugin upgrades must preserve every storage domain and must not be downgraded to a version that ignores archive manifests.

Verification uses real DSH storage, profile restarts and the real pinned platform SDKs with offline HTTP responses. Offline tests cannot establish real tenant permissions or live service delivery. No uncertain model execution is replayed automatically.

Verification: 165 source tests across 19 files, the authenticated launcher smoke, three real Feishu SDK tests and one real InfoFlow SDK test passed. The same release archives passed DSH 0.1.5-rc.2 and 0.2.0-rc.2 Host/client checks, plus four Node 22 package tests. DSH 0.1's registry-only installer is checked after publication. Distribution metadata and local documentation links passed.
