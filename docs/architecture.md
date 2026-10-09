# Architecture

[中文](architecture.zh.md) | English

Bot Mode is a Host/Client Cordis plugin loaded through a DSH profile patch in Web or Desktop. The Host owns identities, canonical direct chats, membership, routing, and public history in DSH's `bot_mode` storage domain. The Client contributes to the existing main panel and sidebar slots and uses generated Remote codecs. There is no separate chat server or SDK subprocess.

Each Bot has a persistent native Session per chat membership. Scoped system-prompt contributions supply its identity. A delivery records bounded unseen public messages, an optional reply quote, and the current human request; private chat transcripts are not copied into group context. Explicit mentions take precedence over reply routing and the default responder. Only human sends and retries dispatch model work.

The public transcript and native Session log are separate durable stores. An interrupted process can leave the public response marked interrupted after its underlying Turn completed. Startup does not replay uncertain work. Stop cancels the owned response, and unloading the plugin cancels and drains its active work. Removing and rejoining a member creates a new Session without deleting public history.

This repository keeps the plugin source and a small integration patch. The patch adds workspace TypeScript paths, compiler references, and the plugin's pnpm lockfile importer. It does not modify the Agent loop, runtime transport, authentication, or model providers. Setup uses a pinned upstream checkout so generated APIs and native slots have a reproducible owner. Upstream generated documentation catalogs are not needed for this opt-in runtime.

The source distribution prepares a pinned DSH checkout for building. `npm run pack` wraps the compiled implementation in the public `@zzzpyyy/dsh-bot` bundle, whose `dsh.bundle.patch` activates the nested entry. The implementation keeps its original private package identity because generated Typert codecs and client module registration refer to that identity. No generated identifiers are rewritten. The outer manifest converts host-owned dependencies to exact peer versions and keeps ordinary dependencies separate; source files, tests, build helpers, and `workspace:` ranges are excluded.

Desktop discovers the same `dsh.client.platform: web` entry as the browser interface. Its Host and Remote calls use the native byte-pipe/custom-protocol carrier instead of an HTTP listener. The plugin contains no Desktop-specific server or transport. Desktop manages its own profile and data. For the source Web launcher, `.runtime/` is rebuildable and `.data/` holds user state that must be retained across updates. Native tools and model credentials remain DSH's responsibility.

See the [plugin reference](plugin-reference.md) for configuration, model-visible effects, and deferred features. The profile test launches built DSH twice with only the external model replaced and checks identity isolation, group/private context, cancellation, feed ordering, and persistence.

Archive tests unpack the shipped tarball, run Desktop's real dependency validator, and launch the native Desktop Host without the development linked-profile override. Only the external model is replaced. Tests fetch the registered Bot client module through `dsh-app://`, restart the Host, and verify stable Session IDs. The same archive is also loaded through the authenticated Web transport. The test resource tree is not a signed app bundle; macOS window interaction is a separate manual check. Registry installation remains pending npm publication.
