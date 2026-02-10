# RebootRadio Discord Bot

A Discord bot that can:

- Join your voice channel and play your radio stream.
- Show now playing stats from `https://rebootradio.uk/v3/api/stats`.
- Parse stats JSON even when the endpoint includes PHP warning HTML before the JSON body.
- Auto-register slash commands per server, including when the bot joins a new server.

## Slash commands

- `/play` — join your current voice channel and start streaming.
- `/stop` — stop and leave voice channel.
- `/nowplaying` — show now playing data in an embed.

## Setup

1. Create a Discord bot in the Developer Portal.
2. Enable **SERVER MEMBERS INTENT** only if your setup needs it (not required for current commands).
3. Invite bot with permissions: View Channels, Send Messages, Connect, Speak.
4. Install dependencies and configure env.

```bash
npm install
cp .env.example .env
# edit .env with your token + stream URL
npm start
```

## Environment variables

- `DISCORD_TOKEN` (required)
- `RADIO_STREAM_URL` (required)
- `STATS_URL` (optional, defaults to `https://rebootradio.uk/v3/api/stats`)

## Notes about your stats endpoint

Your endpoint may return HTML warnings before JSON due to upstream SSL validation failures. The bot handles this by extracting the JSON object from the response text before parsing.

Example payload tail still parsed:

```json
{"presenter":{"id":-1,"name":"AutoDJ"},"song":{"artist":"","track":"RebootRadio.UK/OFFLINE"}}
```

## Production tips

- Use PM2/systemd to keep the bot alive.
- Prefer a direct stream URL (MP3/AAC) for `RADIO_STREAM_URL`.
- If stream playback fails on your host, install FFmpeg and ensure Opus libraries are available.
