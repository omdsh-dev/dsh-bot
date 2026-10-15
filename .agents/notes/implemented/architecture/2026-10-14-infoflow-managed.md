# Per-Bot InfoFlow bindings and optional group creation

The optional Host companion owns an InfoFlowManager behind a narrow control interface attached to BotMode. Native Remote methods expose snapshots, save/verify, toggle and group creation/recovery. The base UI never imports the enterprise SDK. Settings contain credential references, never values; DSH owns credential storage. New bindings remain disabled until explicitly enabled. Legacy config may seed one disabled binding, without moving old external queues or rooms.

Each robot binds exactly one Bot. Connections and ordinary external queues are per-Bot; managed groups have a shared queue and stable group identity. Every enabled robot mentioned in the raw AT blocks becomes a target in the same deduplicated message. Final deliveries retain the producing Bot ID and use its own robot transport. Disabling one robot retains its queued delivery. Group Room membership is immutable.

Remote group creation records its request before calling the SDK, then persists the returned group ID before local association. A timeout or restart during creation is uncertain and cannot be blindly retried. A known group can recover its local association without another remote call. Partial invitation results remain visible. This avoids duplicate groups at the cost of requiring manual platform inspection for unknown outcomes.

Cordis owns manager teardown, socket lifetime, feeds, timers and storage. Tests use fixture SDKs, including a native production-closure package test with two robots, shared-group deduplication, separate replies and restart continuity. They do not mutate the live InfoFlow platform.
