# Claude Code Channels: Telegram Bridge Reference

> Research note (2026-04-19). Source: claude-code-guide agent crawl of
> [code.claude.com/docs](https://code.claude.com/docs/en/channels.md),
> [channels-reference](https://code.claude.com/docs/en/channels-reference.md),
> and [claude-plugins-official](https://github.com/anthropics/claude-plugins-official).
>
> **Requires Claude Code v2.1.80+ with claude.ai login** (not console/API key).

## TL;DR

A "channel" is a **local MCP server** that pushes events into a running Claude Code
session via `notifications/claude/channel`. Claude sees them as `<channel
source="…" chat_id="…">…</channel>` tags and replies by calling an MCP `reply` tool.
There is **no `~/.claude/channels/` filesystem watcher** — that directory is just
where some channels (fakechat, telegram) park their own state and uploads.

Telegram is a **first-party** channel maintained by Anthropic at
[external_plugins/telegram](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram).

---

## 1. Lifecycle: when do messages arrive?

- Channels only deliver while Claude Code is running with `--channels` (or
  `--dangerously-load-development-channels` for unapproved servers):

  ```bash
  claude --channels plugin:telegram@claude-plugins-official
  ```

- Without `--channels`, the MCP server may still connect but **notifications are
  silently dropped** and a startup warning is shown.
- The channel server runs as a stdio MCP subprocess. It is responsible for
  polling/listening to the external system (Telegram Bot API for telegram,
  WebSocket for fakechat, etc.).
- When the external system produces an event, the server calls
  `mcp.notification()` and Claude sees the message in the **next turn**. There is
  no retroactive injection into in-progress reasoning.

## 2. Inbound wire format

### What the MCP server sends

```ts
await mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: 'What is in my working directory?',  // becomes tag body
    meta: {
      chat_id:    '5',           // required for two-way replies
      message_id: 'msg-12345',   // optional, for quote-reply
      user:       'alice',       // optional metadata
      timestamp:  '1713628800',
      // any string-valued identifier-keyed entries become attributes
    },
  },
})
```

`meta` constraints:
- Values **must be strings**.
- Keys must be valid identifiers (`[A-Za-z_][A-Za-z0-9_]*`); hyphenated/special
  keys are **silently dropped**.
- `meta` may be omitted entirely for one-way alerts.

### What Claude sees in the conversation

```xml
<channel source="telegram" chat_id="5" message_id="msg-12345" user="alice" timestamp="1713628800">
What is in my working directory?
</channel>
```

`source` is set automatically from the MCP server name. Custom `meta` keys
become tag attributes.

### File uploads (fakechat-style)

If the server stores an uploaded file on disk first and passes its path:

```xml
<channel source="fakechat" chat_id="5" file_path="/Users/alice/.claude/channels/fakechat/inbox/screenshot.png">
I took a screenshot, can you help?
</channel>
```

Claude is expected to `Read` the `file_path` to pull the upload into context.
The current Claude Code client documents this convention for fakechat; other
channels can adopt it the same way.

## 3. Outbound reply path

**Only MCP tool calls reach the external system.** Claude's regular text output
is *not* routed back through the channel — only explicit tool invocations.

The server exposes a `reply` tool via `ListToolsRequestSchema`:

```ts
{
  name: 'reply',
  description: 'Send a message back over this channel',
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: { type: 'string' },
      text:    { type: 'string' },
    },
    required: ['chat_id', 'text'],
  },
}
```

Claude calls it with the `chat_id` from the inbound tag:

```
reply(chat_id="5", text="I found these files: …")
```

The server's `CallToolRequestSchema` handler implements the actual delivery
(POST to Telegram `sendMessage`, WebSocket broadcast for fakechat, etc.) and
returns `{ content: [{ type: 'text', text: 'sent' }] }`.

`source` and `message_id` are **read-only** — the reply tool doesn't need them
because the server already knows which platform it's bridging.

## 4. Permission relay (optional, two-way)

If the server declares `capabilities.experimental['claude/channel/permission']`,
Claude Code mirrors permission prompts to it:

**Outbound prompt** (Claude Code → server):
```ts
{
  method: 'notifications/claude/channel/permission_request',
  params: {
    request_id:    'abcde',           // 5 lowercase letters, [a-km-z] (skips l/i)
    tool_name:     'Bash',
    description:   'List files in the working directory',
    input_preview: 'ls -la',          // truncated to ~200 chars
  },
}
```

**Inbound verdict** (server → Claude Code):
```ts
{
  method: 'notifications/claude/channel/permission',
  params: { request_id: 'abcde', behavior: 'allow' },  // or 'deny'
}
```

Local terminal dialog and remote relay race; first verdict wins. Stale
request_ids are dropped silently.

## 5. Minimum server shape

```ts
const mcp = new Server(
  { name: 'telegram', version: '0.0.1' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},                  // REQUIRED
        'claude/channel/permission': {},        // optional, opt-in
      },
      tools: {},                                // required for two-way reply
    },
    instructions:
      'Messages arrive as <channel source="telegram" chat_id="…">. ' +
      'Reply with the reply tool, passing the same chat_id.',
  },
)
await mcp.connect(new StdioServerTransport())
```

Register in `.mcp.json`:

```json
{ "mcpServers": { "telegram": { "command": "bun", "args": ["./telegram.ts"] } } }
```

## 6. Telegram-specific bits

- Polling: subprocess hits Telegram Bot API `getUpdates` every 1–5s.
- Pairing flow:
  1. User DMs the bot; bot replies with a 6-char pairing code.
  2. User runs `/telegram:access pair <code>` in Claude Code.
  3. User's Telegram numeric ID is added to the allowlist.
  4. User runs `/telegram:access policy allowlist` to lock down.
- Token lives at `~/.claude/channels/telegram/.env`:
  ```
  TELEGRAM_BOT_TOKEN=<token_from_botfather>
  ```
- **Gate on `message.from.id`, not `message.chat.id`.** In group chats the
  former is the sender, the latter is the room — gating on room lets anyone in
  the group prompt-inject Claude's session.

## 7. Other channel types

| Feature | Direction | Trigger | Notes |
|---|---|---|---|
| Channels (this doc) | external → Claude | MCP push | Only while `--channels` is on |
| MCP servers | Claude → external | on-demand | Claude pulls; no push |
| Remote Control | you → Claude | manual | You drive from phone |
| Slack/Discord *apps* | external → Claude (cloud) | webhook | Spawns fresh cloud sandbox, not local session |

## 8. Org / Team policy

Channels are **off by default** on Team/Enterprise plans. Admins set:

```jsonc
{
  "channelsEnabled": true,
  "allowedChannelPlugins": [
    { "marketplace": "claude-plugins-official", "plugin": "telegram" }
    // …
  ]
}
```

`allowedChannelPlugins` **replaces** the Anthropic default allowlist when set.
`--dangerously-load-development-channels` does **not** bypass org policy.

## 9. Build-your-own checklist

To make a custom Telegram-shaped channel:

1. MCP server declaring `experimental['claude/channel']` and `tools: {}`.
2. External polling/listening loop (Bot API, webhook, etc.).
3. Sender allowlist gated on **identity**, with a pairing or self-message bootstrap.
4. `mcp.notification()` per inbound message with `chat_id` in `meta`.
5. `reply` tool that delivers back to the platform, keyed on `chat_id`.
6. Optional `claude/channel/permission` capability + handlers for remote approval.
7. Plugin packaging (`plugin.json` + manifest) for distribution; Anthropic
   security review required for the official allowlist.

## 10. Sources

- https://code.claude.com/docs/en/channels.md
- https://code.claude.com/docs/en/channels-reference.md
- https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram
- https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat
- https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord
- https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/imessage
- https://modelcontextprotocol.io
