# Docker deployment

Build from a source checkout with Node 24, Git and Docker. `container:prepare` exports only the pinned upstream Git objects; local profiles, credentials, `.env` files and workspace data are excluded from the image context.

```sh
npm run container:prepare
docker compose build
docker compose up -d
docker compose logs bot
```

Open the native authentication link printed in the container log, replacing its container IP with `127.0.0.1` and keeping port `3093` and its token. Compose publishes only `127.0.0.1:3093`; if another local service owns this port, change the host side of the mapping and use that port in the browser. The service retains DSH authentication and trusted-host checks and runs as UID 1000. It binds its concrete private bridge address through DSH's public host option.

The `bot-data` volume stores all DSH profiles, credentials, Bot state, history, ledger and attachments under `/data`. The `bot-workspace` volume stores task files under `/workspace`. Stop the service and back up both volumes before upgrades; `docker compose down` retains them. Replacing the image does not migrate an existing host data directory automatically. The image starts the base Bot plugin; install optional companions into its Web profile when needed.

For a Bot browser, add an isolated browser capability in Controls, set its executable to `/usr/bin/chromium`, and explicitly grant selected Bots. Chromium is installed inside the container; no host browser directory is mounted.

Builds cap Node heaps at 2 GB and native build workers at two. Container type checks include production source roots and their imports; the main CI job also checks the upstream test roots. Dependencies have a separate cached layer. The following optional build arguments select official image mirrors or a Debian mirror when upstream downloads are unavailable:

```sh
docker compose build --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:24.19.0-bookworm-slim --build-arg DEBIAN_MIRROR=http://mirrors.tuna.tsinghua.edu.cn
```

Acceptance uses its own container and volumes. It checks anonymous denial, authenticated native RPC, non-root execution, Bot/memory persistence after restart, health and real Chromium navigation through the pinned MCP server. It removes only its own test container and volumes.

```sh
DSH_BOT_TEST_IMAGE=dsh-bot:local npm run test:container
```

Container acceptance remains pending until recorded in the [completion ledger](feature-completion.md). Source archives have no Git worktree provenance and cannot be mistaken for clean npm release builds.
