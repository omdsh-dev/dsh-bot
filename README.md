# DSH Bot

[中文](README.zh.md) | English

Persistent AI teammates and multi-Bot chats inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Give each Bot a name and role, talk privately, or bring several Bots into one group. Every member keeps its own native DSH Session, tools, and approvals.

This is an independent, experimental community plugin. It is not an official DeepSeek product and is not affiliated with Grok, Cue, or Muse.

**InfoFlow is hidden by default:** New profiles hide InfoFlow configuration and group creation. Internal users can enable **IM connections → Advanced settings → Show InfoFlow integration (internal users)**. The preference persists in the DSH profile. Existing bindings or chats retain their entry on upgrade; hiding it preserves connections and history. The optional companion and enterprise SDK are still required.

**Version 0.8.0** runs the same packages on **DSH 0.1.5-rc.2 and 0.2.0-rc.2**, with Web, Feishu and InfoFlow in one Bot workspace. Configure both IM platforms under **DSH Bots → IM connections**, bind each platform's robot to a Bot, and create platform groups from DSH.

One Bot can use Feishu and InfoFlow at the same time. Bot instructions, models and tools are shared; conversation histories and reply destinations stay separate by platform and chat. Files and external memory accessed through tools still follow the deployment's permissions.

## What you can do

- Create Bots with a handle, display name, responsibilities, and DSH Agent preset.
- Keep one private chat per Bot and create groups with explicit membership.
- Address `@handle`, `@all`, or `@everyone`; click a member chip to insert a mention.
- Search and filter chats, reply to messages, stop an answer, or retry a failed answer.
- Open each Bot's native execution Session to see streaming, tools, questions, and approvals.
- Resume chats after restarting DSH. Chinese and English UI, light and dark themes, and narrow layouts are supported.
- Bind a Feishu robot by official QR authorization or existing app credentials; receive private messages and group @mentions, and create a Feishu group with selected Bots.
- Bind an InfoFlow robot through guided credential setup, control private/group access, test messaging, and optionally create an InfoFlow group.
- For either IM platform, allow specific groups or enable **Allow mentions in all groups containing this robot** per Bot. This option defaults off and does not change private-chat access.

In a connected Feishu group or connected InfoFlow group, a Bot can hand off part of a human request by writing a separate `@handle concrete task` line. The target runs in its own group Session and replies through its own robot. Markdown task lists and semicolon-separated recipients are supported. Concrete fixes can return to an earlier participant, with at most three runs per Bot and twelve handoffs per human request; duplicate tasks are not repeated. Quoted text, code, ordinary mentions and `@all` in Bot replies do not dispatch work; private chats and Web chats retain human-only routing.

| Entry point | How to call the Bot | Where the reply appears |
| --- | --- | --- |
| Web private chat | Send a message to the Bot | The same Web private chat |
| Web group | Mention `@handle` | The same Web group |
| Feishu private chat | Message the bound robot | The same Feishu private chat |
| Feishu group | Use Feishu's native @ to select the robot | The same Feishu group |
| InfoFlow private chat | Message the bound robot | The same InfoFlow private chat |
| InfoFlow group | Use InfoFlow's native @ to select the robot | The same InfoFlow group |

Each Feishu group appears once in DSH, with separate native Sessions for its Bots. InfoFlow groups created through DSH also share one DSH chat. Only the mentioned robots respond. IM replies use each robot's name and avatar without adding an internal `@botId` line.

## Install or update from npm

Requires **DSH 0.1.5-rc.2 or newer**. Installation no longer pins every DSH peer to one exact release. The plugin checks required interfaces at startup and when attaching an Agent. [compatibility.json](compatibility.json) separates accepted versions and tested revisions from the reproducible build pin in [dsh-version.json](dsh-version.json).

The following versions are published on npm under the experimental `next` tag, verified on **2026-10-19**.

| Package | Published version | Purpose |
| --- | --- | --- |
| [@zzzpyyy/dsh-bot](https://www.npmjs.com/package/@zzzpyyy/dsh-bot) | `0.8.0` | Required base: Web chats and the IM configuration panel |
| [@zzzpyyy/dsh-bot-feishu](https://www.npmjs.com/package/@zzzpyyy/dsh-bot-feishu) | `0.4.0` | Optional Feishu connection and group creation |
| [@zzzpyyy/dsh-bot-infoflow](https://www.npmjs.com/package/@zzzpyyy/dsh-bot-infoflow) | `0.5.0` | Optional InfoFlow connection; requires enterprise SDK access |

**Specify a version or `@next` when installing.** The examples below pin this release. To install the version currently tagged `next`, use `@zzzpyyy/dsh-bot@next`, `@zzzpyyy/dsh-bot-feishu@next`, or `@zzzpyyy/dsh-bot-infoflow@next`. Installing a bare package name uses `latest`, which still points to older releases as of the verification date above.

Use the same package set above on DSH **0.1.5-rc.2** and **0.2.0-rc.2**. Later DSH versions are admitted without a new plugin release, but acceptance is not a guarantee of compatibility with untested or changed interfaces. Feishu and InfoFlow accept Bot `>=0.8.0 <1.0.0`, so a Bot update no longer forces matching connector releases. See the [compatibility policy and matrix](docs/compatibility.md).

In **Desktop → plugin manager**, install `@zzzpyyy/dsh-bot@0.8.0`, then add the optional companion packages you need to the same profile.

If Feishu installation reports `ERR_PNPM_IGNORED_BUILDS` for `protobufjs`, explicitly disable that optional install script in the profile as described in the [Feishu guide](docs/feishu.zh.md#安装与开发), then retry.

For an existing compatible **DSH CLI Web profile**, use:

```sh
dsh plugin --profile web add @zzzpyyy/dsh-bot@0.8.0
# Optional: Feishu integration
dsh plugin --profile web add @zzzpyyy/dsh-bot-feishu@0.4.0
```

InfoFlow additionally requires `@baidu/infoflow-sdk-nodejs@2026.8.28` from your authorized enterprise registry. Configure `@baidu` registry access in the target profile's package-manager environment before installing its companion; the public package does not bundle the private SDK or credentials:

```sh
dsh plugin --profile web add @zzzpyyy/dsh-bot-infoflow@0.5.0
```

Use the same `DSH_HOME` and profile as your running installation. For upgrades, back up that data directory, let active replies finish, stop the Host, update the base and installed companions to the versions in the table, then restart. Saved Bot identities, bindings and conversation history remain in the same data directory. Installing a companion exposes its configuration page; it does not create robots or enable unconfigured connections. See the [Feishu guide](docs/feishu.zh.md) and [InfoFlow guide](docs/infoflow.md) for permissions and setup.

After installation, enable the plugin and open **DSH Bots**. Configure the model through DSH's native settings. Desktop uses the same Bot code as Web and uses the native transport provided by DSH (the 0.1 Desktop pipe or the 0.2 authenticated Web Host). It keeps its own DSH data; existing Web chats are not imported automatically. Do not enable another copy of Bot Mode alongside this bundle.

The published base and Feishu packages passed npm installation and Desktop Host startup checks on both **DSH 0.1.5-rc.2 and 0.2.0-rc.2** on **2026-10-19**. All three registry archives match the local release archives by SHA-512.

Package tests exercise Desktop's Host, Web authentication and asset loading, plus both IM companions with deterministic model and transport fixtures. They cover private/group routing, group handoffs, duplicate messages, shared groups and isolation after restart. Published packages contain no test model or fixture. Windows Desktop is not yet verified.

## Web quick start (source)

Requirements: Git, **Node.js 24+**, **pnpm 11.7.0**, a C/C++ build toolchain, and a model provider supported by DSH. On macOS, install Xcode Command Line Tools (`xcode-select --install`). On Ubuntu, install `build-essential` and `python3`. Source installation downloads and builds the DSH workspace; allow several minutes and several GB of free disk space. macOS is locally verified; Linux is covered by the repository's CI workflow. Windows installation is not yet verified.

```sh
npm install --global pnpm@11.7.0
git clone https://github.com/zzzpyyy/dsh-bot.git
cd dsh-bot
npm run setup
npm start
```

Open the authenticated URL printed by `dsh web`, then select **DSH Bots** in the sidebar. Configure a model in DSH's native settings, create your first Bot, and create a group when you have several Bots. No model key is included, and no mock model is used by `npm start`.

Setup downloads the exact [DSH commit](https://github.com/deepseek-ai/deepseek-harness/commit/639ed015397290b3745d163aafe02ffee4aa3f84) recorded in [dsh-version.json](dsh-version.json), copies the plugin into a separate `.runtime/deepseek-harness-<version>` workspace, applies TypeScript registration and a plugin-only lockfile addition, installs with a frozen lockfile, and builds the native Web profile. After editing plugin source, use `npm run build:plugin` for an incremental build; first-time installation still requires setup. Edit `plugin/`, not the managed copy under `.runtime/`. Setup never modifies a separate DSH installation.

The source plugin retains its internal `@deepseek-ai/dsh-experimental-bot-mode` workspace identity. The public bundle wraps its compiled implementation as `@zzzpyyy/dsh-bot`; it is not the unscoped `dsh-bot` npm package. Only source builds require the pinned DSH revision; npm archives use independent compatibility ranges.

## Port, data, and working directory

The default port is **3093**. Use another port if it is already occupied:

```sh
npm start -- --port 3094 --no-open
```

Data is stored in `.data/` by default; the default Bot working directory is `.data/workspace/`. Both are ignored by Git. Override them explicitly:

```sh
DSH_HOME="$HOME/.dsh-bot" DSH_BOT_WORKDIR="/path/to/your/project" npm start
```

DSH provides tools and approvals according to the selected preset. Choose the Bot working directory accordingly. Keep the data directory when updating, and stop the running instance before rebuilding. Press Ctrl+C to stop the foreground service. This distribution does not install a background or login service.

For authentication errors, reopen the current URL printed by the running service. Once authenticated, bookmark the plain address using the same host, port, and browser profile. A cleared or expired browser cookie requires authentication again.

## Configuration

Defaults are in the [plugin reference](docs/plugin-reference.md#configuration). To override them, create a local patch such as:

```yaml
- id: bot-mode
  config:
    historyMessages: 80
    maxBots: 8
    maxMessages: 10000
```

Pass its absolute path through DSH's native CLI:

```sh
npm start -- --patch /absolute/path/bot-settings.patch.yml
```

## Current limits

- Group replies appear when complete; token streaming, tools, and approvals are in each member's execution Session.
- Bots inherit DSH's selected model. Per-Bot models, identity editing and scheduling are not implemented. Bot-to-Bot handoffs are supported only within connected Feishu or InfoFlow groups; private chats and Web chats require human messages to dispatch work.
- Use the extensible `standard` preset. Complete-prompt presets such as `minimal` are rejected.
- A restart marks unfinished public replies interrupted. It does not resend them; inspect the execution Session before retrying uncertain tool work.
- There is no Bot/chat deletion or large-history pagination yet. Removing and rejoining a member creates a new Session and preserves the public history.

## Development and verification

After setup:

```sh
npm run check
npm test
npm run pack
npm run pack:feishu
npm run pack:infoflow
npm run test:install
npm run test:package
npm run test:feishu-package
npm run test:infoflow-managed-package
npm run test:im-isolation-package
npm run test:im-delegation-package
```

Tests run inside the prepared DSH workspace and cover routing, native slots and UI interactions, persistence, stop, and process restart. `pack` creates the compiled archive and checksums in `dist/`; `test:package` unpacks that archive into isolated profiles and checks DSH's compatibility gate, Desktop/Web Host authentication, asset loading and restart continuity. The Desktop Host test does not require Electron or a display. Only tests substitute a deterministic model; no API key is needed. GitHub Actions performs a clean setup/build and the same tests, then retains the archive as a CI artifact. It does not publish to npm. `npm run test:install` verifies both local base and Feishu archives through DSH's shared plugin manager. After publication, `npm run test:registry` checks installation from npm; it requires public registry access and is not part of CI.

See the [architecture](docs/architecture.md), [full plugin reference](docs/plugin-reference.md), and [release notes](CHANGELOG.md). When changing the DSH pin, update the integration patch and validate a fresh installation rather than assuming compatibility with pre-stable APIs.

## License

[MIT](LICENSE). DeepSeek Harness remains under its upstream license. The copyright notice is retained; see [NOTICE](NOTICE).
