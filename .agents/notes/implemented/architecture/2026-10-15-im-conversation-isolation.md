# Concurrent IM bindings and conversation isolation

A Bot owns a shared identity and native preset. Feishu and InfoFlow each own its binding, credentials, allowlists, socket and durable queues. An external Room is identified by provider, account, conversation kind and external ID; platform-specific shared-group handling never merges providers. Each Room member owns a separate native Session. Replies retain the original platform and destination through the outbox.

This permits simultaneous Feishu and InfoFlow bindings without duplicating the Bot or copying chat history. It isolates conversational context, not the deployment's filesystem, tool credentials or external memory stores. A stronger tool/data isolation requirement needs separately configured execution environments.

The packaged Host regression uses one Bot through Web, Feishu and InfoFlow private and group chats. It verifies two-turn continuity within each chat, absence of other chat markers in model inputs and stored history, reply routing, independent connection toggles, duplicate external IDs, and preserved histories and Session IDs after restart. Transport endpoints and model responses are fixtures; the test sends no real messages and does not establish platform-side delivery guarantees. The existing implementation needs no runtime change for this behavior.
