# Bot capability completion

Requested scope: all capabilities identified after the 0.8.1 release.
Existing local Bot editing and external-group local input are part of this work.

- [x] Bot and room lifecycle: archive, restore, delete; paginated history, full-text search, export.
- [x] Per-Bot model and tool policy; native file sandbox narrowing; persistent plugin token/spending budget.
- [x] Durable media input: images, files, voice transcription where configured.
- [x] Live response, tool progress and approval handling in the Bot panel.
- [x] Failed ingress/delivery inspection, manual retry and discard for both connectors.
- [x] Web group delegation and durable queued messages, with cancellation.
- [x] Durable schedules, recurring checks and opt-in external notifications, including explicitly synchronized Web group messages.
- [x] Client controls, regression tests, migration/compatibility checks and documentation.

Constraints: existing installations acquire no new external sends or schedules.
Never treat a working directory or a prompt as a filesystem security boundary.
Do not replay uncertain model executions after a crash.
Use DSH's native attachment, model, tool and approval facilities where present.

The [capability guide](capabilities.md) documents configuration and operational limits.
This source prepares Bot 0.9.0, Feishu 0.5.0 and InfoFlow 0.6.0; none of these new versions has been published.

Verification includes source/React regressions, real DSH profile restarts, unchanged
archives on DSH 0.1.5-rc.2 and 0.2.0-rc.2, and Node 22 package smoke tests. The model
and IM network are fixtures; no real group creation, message delivery or production
schedule is used. Voice conversion also has a local OGG-to-native-WAV smoke check.
