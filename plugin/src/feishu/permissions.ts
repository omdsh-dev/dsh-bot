/** One application-identity permission manifest for every IM binding path. */
export function bindingScopes(): { tenant: string[] } {
  return { tenant: [
    'im:message.p2p_msg:readonly',
    'im:message.group_at_msg:readonly',
    'im:message:send_as_bot',
    'im:message:readonly', // Download attachments from users' messages.
    'im:resource', // Upload images/files and access the bot's own resources.
    'im:chat:read',
    'im:chat:create',
    'im:chat.members:bot_access',
  ] }
}
/** Feishu console's batch-import format; contains no credentials or user scopes. */
export function bindingPermissionImport(): string { return JSON.stringify({ scopes: bindingScopes() }, null, 2) }
