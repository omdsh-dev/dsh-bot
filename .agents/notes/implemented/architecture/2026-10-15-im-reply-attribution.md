# IM reply attribution

Managed InfoFlow and Feishu bindings send each Bot's reply through its own platform robot. The bridge emits the original response body without prepending the internal Bot ID: platform names and avatars already identify the speaker, while a synthetic `@dsh` line looks like an extra mention. Reply routing still uses the persisted delivery Bot ID and destination; body text is not routing metadata. Normal mentions inside the model response are preserved without stripping or rewriting.

Legacy InfoFlow connectors with multiple configured Bots share one platform sender. Their composition explicitly enables textual attribution; single-Bot legacy connectors and page-managed bindings omit it. Existing queued deliveries remain immutable and retain their previously recorded content.

Bridge regressions compare exact outgoing text for private and group chats on both platforms, including literal mentions that must survive. Packaged Host tests cover independent and shared managed groups, original body delivery, platform routing and restart isolation. The legacy packaged fixture retains its existing attribution assertion.
