---
description: "Native DSH Bots with canonical direct chats, explicit group membership, and persistent per-member Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-bot-mode

English | [中文](plugin-reference.zh.md)

The optional connector uses Host-only `ensureExternalRoom` and `submitExternalMessage`; neither is a Remote method. Within `bot_mode`, external message IDs and response attempts commit atomically. Connector admission and outbox records belong to separate domains; cross-domain recovery uses idempotent message IDs, not a distributed transaction. Human identity is logged as JSON user data. See the [InfoFlow guide](infoflow.md).

## Summary

Bot Mode adds named Bots and shared group chats to the existing DSH Web UI. Each Bot has one canonical direct chat and a separate persistent Session in every group. This private experimental plugin uses the native Agent runtime, storage backend, generated Remote API, and UI slots.

## Table of Contents

- [Use Bot Mode](#use-bot-mode)
- [Configuration](#configuration)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-bot-mode"></a>
## Use Bot Mode

From this distribution's root, prepare DSH and load the opt-in overlay:

```sh
npm run setup
npm start -- --no-open
```

Open the URL printed by DSH and select **Bots** in the sidebar. Configure the model through DSH's existing settings. Create a Bot with an ASCII handle, display name, instructions, and an extensible Agent preset (default: `standard`). Create groups by explicitly selecting existing Bots; creating another Bot does not add it to existing groups.

Use `@handle` for a member, `@all` or `@everyone` for all current members, or Reply to address a Bot's answer. Explicit mentions override reply routing; otherwise the default member answers. Private chats always address their owner. Code, blockquotes, and email addresses do not dispatch mentions. A group accepts another prompt or membership change after its current responses settle. Stop cancels one response; Retry starts another attempt for an unsuccessful response from a current member.

**Open execution session** opens the member's original DSH conversation, including streaming, tool calls, questions, and approval controls. Return through **Bots**. These member Sessions belong to DSH's Session Controller; the plugin cancels and drains its active response intervals when unloaded.

<a id="configuration"></a>
## Configuration

The overlay's `bot-mode` row accepts:

| Field | Default | Meaning |
|---|---|---|
| `cwd` | Host working directory | Working directory for new member Sessions |
| `defaultPreset` | `standard` | Preset for newly created Bots |
| `historyMessages` | `80` | Maximum unseen completed public messages included per delivery |
| `maxBots` | `8` | Maximum members in one chat (at most 16) |
| `maxMessages` | `10000` | Public message limit per chat; no automatic transcript eviction |

Records live in the `bot_mode` storage domain, using the deployment's existing `storageDomain` backend. DSH owns the separate Session logs. Startup marks unfinished public responses interrupted; it does not enqueue replacement requests. Inspect the member's execution Session before retrying uncertain work.

The chat roster supports search by name or Bot handle, filters for groups and direct chats, and recent-message ordering. Stable portraits distinguish speakers; Bot replies use open Markdown typography and user messages use muted bubbles. Hover or keyboard focus reveals message actions. Chat info shows responsibilities, the default responder, and each member's native execution Session. Create Bots, groups, and membership changes in dialogs. Group member chips insert mentions without sending or discarding the draft. In the composer, type `@` to choose a recipient with the arrow keys and Enter; Enter sends, Shift+Enter adds a line, and input-method composition never sends. Use the roster footer to toggle the DSH sidebar. Narrow panels show the roster through the chat-list button.

<a id="implementation"></a>
## Implementation

The Host service `ctx.botMode` owns Bot identities, canonical DMs, membership, public history, and explicit routing. It exposes `snapshot`, `createBot`, `createGroup`, `setMembers`, `send`, `stop`, `retry`, and `follow` through the generated `bots` Remote namespace. One serialized domain commit reserves a user message and all response attempts before any model work starts. Human sends and retries dispatch Bots. External group connectors may opt into bounded handoffs: a standalone `@handle task` line in a completed reply creates a child attempt in the same Room. Concrete follow-ups can revisit a Bot, with at most three attempts per Bot and twelve handoffs per human root; duplicate tasks are rejected with a visible reason; source and target must have active bindings in that group. Bot-generated platform events remain ignored. Child attempts retain their parent and original human request; restart marks unfinished attempts interrupted instead of replaying them.

`sessionController.create` creates or resumes the member's stable Session id and preset. Scoped system-prompt contributions apply its Bot identity, including when DSH opens that Session directly. Each response observes its own durable input receipt and Turn, then waits for Agent quiescence before publishing the final public text. Native prompts for later Turns cannot be attributed to that response. A per-member cursor supplies unseen public messages without copying private-chat transcripts.

The Client mounts its generated Remote contribution, follows an opening baseline and subsequent changed snapshots, and registers the `bots` main-panel key and sidebar entry. Its React-free model owns business state; components receive framework-bound observable hooks. No standalone HTTP server, SDK subprocess, core loop modification, or default-release dependency is added. No invariant export is provided: the domain validation and real-profile tests cover relationships owned wholly by this plugin.

<a id="model-experience"></a>
## Model Experience

### Bot identity and shared history

#### What the model sees

The scoped `bot-mode.identity` system section identifies the Bot and its responsibilities. Each human delivery durably logs a bounded JSON snapshot of unseen completed public messages, an explicit reply quote when present, and the current human request. Other participants' text is identified as data. Tool availability and permissions remain those of the selected DSH preset and deployment.

#### Token effect

The identity adds a fixed system prefix cost per Bot Session. New deliveries append public context and the current request; the current request also appears in the public snapshot when first delivered. Old private Session history remains subject to the preset's normal compaction. Bounded message count is not a token budget.

#### KV Cache effect

The same member Session preserves the prior request prefix across turns. New public messages change the appended suffix. Preset compaction or changes to deployment prompt providers may alter cache reuse; the plugin does not promise a provider cache hit.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Responses appear in the group after completion; token streaming, tools, and approvals are in the native execution Session.
- Models inherit DSH selection. Per-Bot model selection, editing Bot identities, unbounded autonomous conversations, scheduled routines, other IM adapters, and cross-chat memory are deferred.
- Fixed complete-prompt presets such as `minimal` cannot host the extra Bot identity and are rejected before delivery. Use `standard` or an extensible custom preset.
- Group messages and Session logs use separate durable stores. A crash between commits can leave a completed DSH Turn marked interrupted publicly; inspect the execution log before retrying. No exactly-once external-tool guarantee is claimed.
- Removing a member preserves public history; rejoining creates a new member Session. Existing removed Sessions remain accessible through DSH.
- The small-domain feed replaces full snapshots. Large-history pagination, room deletion, Bot deletion, and migration of the separate Python prototype's SQLite database are deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [native plugin decision](architecture.md) explains the native integration and distribution. The real-profile test replaces only the external model and exercises Loader composition, personas, group/private isolation, stop, feed ordering, and process restart.

</details>
