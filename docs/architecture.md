# Architecture

[中文](architecture.zh.md) | English

Bot Mode is a Host/Client Cordis plugin loaded through a DSH Web profile patch. The Host owns identities, canonical direct chats, membership, routing, and public history in DSH's `bot_mode` storage domain. The Client contributes to the existing main panel and sidebar slots and uses generated Remote codecs. There is no separate chat server or SDK subprocess.

Each Bot has a persistent native Session per chat membership. Scoped system-prompt contributions supply its identity. A delivery records bounded unseen public messages, an optional reply quote, and the current human request; private chat transcripts are not copied into group context. Explicit mentions take precedence over reply routing and the default responder. Only human sends and retries dispatch model work.

The public transcript and native Session log are separate durable stores. An interrupted process can leave the public response marked interrupted after its underlying Turn completed. Startup does not replay uncertain work. Stop cancels the owned response, and unloading the plugin cancels and drains its active work. Removing and rejoining a member creates a new Session without deleting public history.

This repository keeps the plugin source and a small integration patch. The patch adds workspace TypeScript paths, compiler references, and the plugin's pnpm lockfile importer. It does not modify the Agent loop, runtime transport, authentication, or model providers. Setup uses a pinned upstream checkout so generated APIs and native slots have a reproducible owner. Upstream generated documentation catalogs are not needed for this opt-in runtime.

The internal package remains private because its `workspace:` dependencies and build helpers belong to DSH. A public GitHub source distribution therefore prepares a compatible DSH checkout rather than pretending the directory is a standalone npm package. `.runtime/` is rebuildable; `.data/` holds user state and must be retained across updates. Native tools and model credentials remain DSH's responsibility.

See the [plugin reference](plugin-reference.md) for configuration, model-visible effects, and deferred features. The profile test launches built DSH twice with only the external model replaced and checks identity isolation, group/private context, cancellation, feed ordering, and persistence.
