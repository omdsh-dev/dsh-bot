# Docker deployment

Build from a source checkout with Node 24, Git and Docker. `container:prepare` exports only the pinned upstream Git objects; local profiles, credentials, `.env` files and workspace data are excluded from the image context.

```sh
npm run container:prepare
docker compose build
docker compose up -d
docker compose logs bot
```

The native DSH CLI deliberately permits only `127.0.0.1` listening. Compose therefore uses the **host network**, with no port publishing or proxy that changes the listener. Open the native authentication link printed in the container log. The service retains DSH authentication and trusted-host checks and runs as UID 1000. If port 3093 is occupied, use `DSH_BOT_PORT=3094 docker compose up -d`; the health check follows that port.

This deployment supports Docker Engine on Linux. Docker Desktop 4.34 or newer also requires **Settings → Resources → Network → Enable host networking**, followed by Apply and restart. Docker Desktop Enhanced Container Isolation is incompatible with host networking; use the native desktop entry when retaining that setting. See [Docker's host-network requirements](https://docs.docker.com/engine/network/drivers/host/). Host networking shares the host network namespace, while application authentication, filesystem/container isolation and the loopback listener remain in place.

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

On Docker Desktop without host networking enabled, `DSH_BOT_TEST_CONTAINER_INTERNAL=1` runs the same service checks inside the Linux VM; it does **not** verify host-browser reachability. CI runs the default test from the Linux host.

The final image passed service, persistence and Chromium acceptance locally; Linux host access passed in [CI `40158827579`](https://github.com/zzzpyyy/dsh-bot/actions/runs/40158827579). See the [completion ledger](feature-completion.md) for the verified release. Source archives have no Git worktree provenance and cannot be mistaken for clean npm release builds.
