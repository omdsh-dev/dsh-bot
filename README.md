# DSH Bot

[中文](README.zh.md) | English

Persistent AI teammates and multi-Bot chats inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Give each Bot a name and role, talk privately, or bring several Bots into one group. Every member keeps its own native DSH Session, tools, and approvals.

This is an independent, experimental community plugin. It is not an official DeepSeek product and is not affiliated with Grok, Cue, or Muse.

The current source version is **0.5.0 (unreleased)** and adds per-Bot [Feishu QR registration and binding](docs/feishu.zh.md). The [InfoFlow companion](docs/infoflow.md), its per-Bot configuration, and optional group creation remain available. The npm installation instructions below describe the published 0.2.1 release, which does not include these IM connectors.

Open **DSH Bots → IM connections** to manage Feishu and InfoFlow in one panel. Select a platform and Bot to configure its robot, connection and group access; Feishu also supports one-click group creation.

## What you can do

- Create Bots with a handle, display name, responsibilities, and DSH Agent preset.
- Keep one private chat per Bot and create groups with explicit membership.
- Address `@handle`, `@all`, or `@everyone`; click a member chip to insert a mention.
- Search and filter chats, reply to messages, stop an answer, or retry a failed answer.
- Open each Bot's native execution Session to see streaming, tools, questions, and approvals.
- Resume chats after restarting DSH. Chinese and English UI, light and dark themes, and narrow layouts are supported.

Bots respond only to a human send or retry. Their messages do not automatically trigger each other.

## Desktop compatibility

Version **0.2.1** includes a compiled plugin bundle for **DSH 0.1.5-rc.2**, pinned to the same upstream revision as the source distribution. Shared DSH dependencies have exact peer versions; other releases are not yet verified. A different shared dependency version is rejected by Desktop's plugin validator.

**Available on [npm](https://www.npmjs.com/package/@zzzpyyy/dsh-bot).** In Desktop's plugin manager, enter `@zzzpyyy/dsh-bot@0.2.1`. This experimental version is published under the `next` tag; use the exact version shown here. The [GitHub prerelease](https://github.com/zzzpyyy/dsh-bot/releases/tag/v0.2.1) also provides the same archive and `SHA256SUMS`. Desktop's plugin manager accepts registry packages, not GitHub URLs or local archives.

After installation, enable the plugin and open **DSH Bots**. Configure the model through DSH's native settings. Desktop uses the same Bot code as Web, runs through the native `dsh-app://` transport, and does not use port 3093. It keeps its own DSH data; existing Web chats are not imported automatically. Do not enable another copy of Bot Mode alongside this bundle.

The actual archive has been tested through Desktop's Host and Web authentication/asset serving. A macOS Electron window has also been checked interactively, including sending `@all` and receiving replies from two Bots. Tests use a deterministic model; the published package contains no test model or fixture. Installation from npm has been verified with DSH's real Desktop plugin manager in a fresh profile, followed by a native Host group-chat test. Windows Desktop is not yet verified.

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

Setup downloads the exact [DSH commit](https://github.com/deepseek-ai/deepseek-harness/commit/c291e7961a515f6d7af9304e7fd1d257929aef26) recorded in [dsh-version.json](dsh-version.json), copies the plugin into that managed workspace, applies TypeScript registration and a plugin-only lockfile addition, installs with a frozen lockfile, and builds the native Web profile. Run setup again after changing plugin source. Edit `plugin/`, not the managed copy under `.runtime/`. Setup never modifies a separate DSH installation.

The source plugin retains its internal `@deepseek-ai/dsh-experimental-bot-mode` workspace identity. The public bundle wraps its compiled implementation as `@zzzpyyy/dsh-bot`; it is not the unscoped `dsh-bot` npm package. Both distribution paths require the pinned DSH version.

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
- Bots inherit DSH's selected model. Per-Bot models, identity editing, automatic handoffs and scheduling are not implemented. Optional companions provide InfoFlow and Feishu text messaging.
- Use the extensible `standard` preset. Complete-prompt presets such as `minimal` are rejected.
- A restart marks unfinished public replies interrupted. It does not resend them; inspect the execution Session before retrying uncertain tool work.
- There is no Bot/chat deletion or large-history pagination yet. Removing and rejoining a member creates a new Session and preserves the public history.

## Development and verification

After setup:

```sh
npm run check
npm test
npm run pack
npm run test:package
```

Tests run inside the prepared DSH workspace and cover routing, native slots and UI interactions, persistence, stop, and process restart. `pack` creates the compiled archive and checksums in `dist/`; `test:package` unpacks that archive into isolated profiles and checks Desktop's dependency validator, native byte-pipe transport, restart continuity, and authenticated Web loading. The Desktop Host test does not require Electron or a display. Only tests substitute a deterministic model; no API key is needed. GitHub Actions performs a clean setup/build and the same tests, then retains the archive as a CI artifact. It does not publish to npm. After publication, `npm run test:registry` separately verifies an online installation through Desktop's real plugin manager; it requires public registry access and is not part of CI.

See the [architecture](docs/architecture.md), [full plugin reference](docs/plugin-reference.md), and [release notes](CHANGELOG.md). When changing the DSH pin, update the integration patch and validate a fresh installation rather than assuming compatibility with pre-stable APIs.

## License

[MIT](LICENSE). DeepSeek Harness remains under its upstream license. The copyright notice is retained; see [NOTICE](NOTICE).
