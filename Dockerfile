ARG NODE_IMAGE=node:24.19.0-bookworm-slim
FROM ${NODE_IMAGE} AS build
ARG DEBIAN_MIRROR=http://deb.debian.org
RUN sed -i "s@http://deb.debian.org@${DEBIAN_MIRROR}@g" /etc/apt/sources.list.d/debian.sources && apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 install -y --no-install-recommends git ca-certificates build-essential python3 && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.7.0
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1 NODE_OPTIONS=--max-old-space-size=2048 RAYON_NUM_THREADS=2 UV_THREADPOOL_SIZE=4
WORKDIR /opt/dsh-bot
COPY dsh-version.json ./
COPY scripts/common.mjs scripts/setup.mjs scripts/restore-container-runtime.mjs ./scripts/
COPY integration/dsh-workspace.patch ./integration/
COPY plugin/package.json ./plugin/package.json
COPY .container/runtime.bundle ./.container/runtime.bundle
RUN node scripts/restore-container-runtime.mjs && node scripts/setup.mjs --prepare-only
RUN --mount=type=cache,target=/root/.local/share/pnpm/store node --input-type=module -e "import {run,runtime} from './scripts/common.mjs'; run('pnpm',['install','--frozen-lockfile'],{cwd:runtime})"
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store node scripts/configure-container-build.mjs && DSH_BOT_CONTAINER_BUILD=1 npm run setup

FROM ${NODE_IMAGE}
ARG DEBIAN_MIRROR=http://deb.debian.org
RUN sed -i "s@http://deb.debian.org@${DEBIAN_MIRROR}@g" /etc/apt/sources.list.d/debian.sources && apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 install -y --no-install-recommends git ca-certificates tini chromium && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/dsh-bot /opt/dsh-bot
RUN mkdir -p /data /workspace && chown node:node /data /workspace
ENV NODE_ENV=production DSH_HOME=/data DSH_BOT_WORKDIR=/workspace
USER node
WORKDIR /workspace
VOLUME ["/data", "/workspace"]
EXPOSE 3093
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node /opt/dsh-bot/scripts/container-health.mjs
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/opt/dsh-bot/scripts/start-container.mjs"]
