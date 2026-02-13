# RebootRadio Discord Bot

A Discord bot that can:

- Join your voice channel and play your radio stream.
- Show now playing stats from `https://rebootradio.uk/v3/api/stats`.
- Auto-update bot now-playing using rich presence style activity (Playing): name = song title, details = artist, state = live presenter, large image = song art, and profile/website buttons.
- Parse stats JSON even when the endpoint includes PHP warning HTML before the JSON body.
- Auto-register slash commands per server, including when the bot joins a new server.
- In guild `1470711513097568389`, auto-create `#schedule`, post a schedule PNG, and keep it updated.
- Verify users against RebootRadio and sync linked Discord roles with `/verify`.

## Slash commands

- `/play` — join your current voice channel and start streaming.
- `/stop` — stop and leave voice channel.
- `/nowplaying` — show now playing data in an embed.
- `/verify` — check `fetchUser?discord_id=<id>` and sync linked roles in the official server.
- `/presenter` — generate and send only the lineup image (no embed, no extra text).

## Special schedule automation

For guild `1470711513097568389`:

- Bot sends `POST` to `https://rebootradio.uk/v3/api/getDaySlots` with form body `offset=0` (`application/x-www-form-urlencoded`).
- Bot creates a `#schedule` text channel if needed.
- Bot posts/edits one persistent message with a generated `schedule.png` image.
- Channel ID and message ID are stored permanently in `data/schedule-state.json`.
- Bot checks every minute; if timetable data changes or the live hour changes (Europe/London), it updates the message.
- Slot content is shifted back by 1 while hour labels stay unchanged (e.g. old 13:00 content now appears on 12:00).
- On startup, a manual check runs immediately.

## Linked role verification

In the official RebootRadio guild only (`1470711513097568389`):

- `/verify` sends a GET request to:
  - `https://rebootradio.uk/v3/api/fetchUser?discord_id=<DISCORD_USER_ID>`
- If `found` is `false`, the bot tells the user to link on the RebootRadio website.
- If `found` is `true`:
  - all mapped numeric roles from `roles[]` are added,
  - mapped roles not present in `roles[]` are removed,
  - unmapped numbers are ignored,
  - role `0` grants `STAFF_ROLE_ID`,
  - any found user also gets `MEMBER_ROLE_ID`.

## Setup

1. Create a Discord bot in the Developer Portal.
2. Invite bot with permissions: View Channels, Send Messages, Connect, Speak, Manage Channels, Manage Roles.
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
- `MINI_TIMETABLE_URL` (optional, defaults to `https://rebootradio.uk/v3/api/miniTimetable`)
- `FETCH_USER_URL` (optional, defaults to `https://rebootradio.uk/v3/api/fetchUser`)
- `LINKED_ROLE_MAP_JSON` (optional, JSON map of numeric role code to Discord role ID, e.g. `{"1":"123...","3":"456..."}`)
- `STAFF_ROLE_ID` (optional, assigned when API role `0` is present)
- `MEMBER_ROLE_ID` (optional, assigned whenever API `found` is true)

## Notes

- Schedule image is generated as PNG in-process (no external image library dependency).
- If stream playback fails on your host, install FFmpeg and ensure Opus libraries are available.
