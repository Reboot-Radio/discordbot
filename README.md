# RebootRadio Discord Bot

A Discord bot that can:

- Join your voice channel and play your radio stream.
- Show now playing stats from `https://rebootradio.uk/v3/api/stats`.
- Parse stats JSON even when the endpoint includes PHP warning HTML before the JSON body.
- Auto-register slash commands per server, including when the bot joins a new server.
- In guild `1470711513097568389`, auto-create `#schedule`, post a schedule PNG, and keep it updated.

## Slash commands

- `/play` — join your current voice channel and start streaming.
- `/stop` — stop and leave voice channel.
- `/nowplaying` — show now playing data in an embed.

## Special schedule automation

For guild `1470711513097568389`:

- Bot sends `POST` to `https://rebootradio.uk/v3/api/getDaySlots` with form body `offset=0` (`application/x-www-form-urlencoded`).
- Bot creates a `#schedule` text channel if needed.
- Bot posts/edits one persistent message with a generated `schedule.png` image.
- Channel ID and message ID are stored permanently in `data/schedule-state.json`.
- Bot checks every minute; if timetable data changes or the live hour changes (Europe/London), it updates the message.
- On startup, a manual check runs immediately.

## Setup

1. Create a Discord bot in the Developer Portal.
2. Invite bot with permissions: View Channels, Send Messages, Connect, Speak, Manage Channels.
3. Install dependencies and configure env.

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
- `SCHEDULE_URL` (optional, defaults to `https://rebootradio.uk/v3/api/getDaySlots`)

## Notes

- Schedule image is generated as PNG in-process (no external image library dependency).
- If stream playback fails on your host, install FFmpeg and ensure Opus libraries are available.
