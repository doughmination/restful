# dough-restful

A combined Discord **presence** (Lanyard-style) and **profile/badges** (dstn.to-style) API on a **single Cloudflare Worker + Durable Object**, powered by **one Discord bot**. It exposes a REST endpoint and a Lanyard-compatible WebSocket, returning a single unified JSON shape.

## Setup

### 1. Create the bot
1. https://discord.com/developers/applications → **New Application** → **Bot**.
2. **Reset Token**, copy it (this is `DISCORD_BOT_TOKEN`).
3. Under **Privileged Gateway Intents**, enable **PRESENCE INTENT** and **SERVER MEMBERS INTENT**.
4. Invite the bot to a server that contains the people you want to track (OAuth2 URL generator → scope `bot`). Presence is only visible for users sharing a server with the bot — same model as Lanyard.

### 2. Configure Cloudflare
```bash
pnpm install

# KV namespace for profile cache — paste the printed id into wrangler.jsonc
pnpx wrangler kv namespace create PROFILE_CACHE

# Secrets
pnpx wrangler secret put DISCORD_BOT_TOKEN
# Optional, ToS risk — only if you want the rich badges:
pnpx wrangler secret put DISCORD_USER_TOKEN
```

Optionally set `TRACKED_GUILD_IDS` in `wrangler.jsonc` (comma-separated) to limit monitoring to specific servers; empty = every guild the bot can see.

### 3. Run / deploy
```bash
# Local: copy .dev.vars.example -> .dev.vars and fill in tokens
pnpx wrangler dev

# Production
pnpx wrangler deploy
```