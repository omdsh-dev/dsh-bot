# Release notes

## 0.2.1

Published as `@zzzpyyy/dsh-bot@0.2.1` on npm under the experimental `next` tag. Compatible with DSH `0.1.5-rc.2`.

- Verified registry installation through the real Desktop plugin manager, followed by a native Host group-chat test in a fresh profile. `npm run test:registry` makes this post-publication check reproducible.

- Remove the declaration-only `dsh-client-ui-slots` runtime peer, which is not supplied by the production Desktop package set.
- Test against the exact first-party dependency closure selected by Desktop's own packaging code, excluding development-only packages.
- Supersedes the withdrawn 0.2.0 GitHub preview. No 0.2.0 npm package was published.

## 0.2.0 (withdrawn preview)

Compiled plugin bundle for DSH Web and Desktop `0.1.5-rc.2`.

- Public bundle manifest and activation patch, with the generated implementation identity preserved inside the archive.
- Exact peer dependencies for host-owned DSH packages, ordinary dependencies kept separate, and no lifecycle scripts or test fixtures in the release package.
- Archive tests through the real Desktop Host and Web transport, including dependency mismatch rejection, Bot context isolation, cancellation, and Session continuity across Desktop restarts.
- macOS Electron interaction check: open DSH Bots, send `@all`, and receive two Bot replies using a test model.
- Bilingual installation/compatibility documentation and CI archive artifacts.

The GitHub prerelease includes the compiled `.tgz` and SHA-256 checksum. npm publication is pending; Desktop's registry-only plugin manager cannot install the GitHub attachment directly. Other DSH versions, registry installation, and Windows Desktop have not been verified.

## 0.1.0

Initial experimental source release of the native DSH Bot Mode plugin.

- Persistent Bot identities, canonical private chats, and explicit multi-Bot groups.
- Mention/reply routing, cancellation, retries, and native execution Session navigation.
- Chat search/filtering, quick member mentions, chat details, and bilingual responsive UI.
- Pinned DSH setup, isolated default data, installation checks, and CI build/profile tests.

Uses DSH `0.1.5-rc.2` at `c291e7961a515f6d7af9304e7fd1d257929aef26`. This is a GitHub source release, not an npm publication. See the README for requirements and current limitations.
