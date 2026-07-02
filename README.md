# Reboot Radio Discord Bot

A Discord bot for the [Reboot Radio v3](https://rebootradio.uk/v3/) site.

## Features

- Join voice and play the station stream (`/play`, `/stop`)
- Show now playing from the v3 stats API (`/nowplaying`)
- Live presence text from stats, including live presenter mode
- Auto schedule channel image in the official guild
- Linked account verification and role sync (`/verify`)
- Presenter lineup image (`/presenter`)
- List configured stations (`/stations`)
- **24/7 stage streaming** in the official guild (joins a configured stage channel, starts a stage, and plays continuously)

## Slash commands

- `/play` — join your voice channel and stream the radio
- `/stop` — stop and leave voice
- `/nowplaying` — embed with track, presenter, station, and artwork
- `/verify` — sync Discord roles from linked Reboot Radio account
- `/presenter` — live presenter + next two slots image
- `/stations` — list stations from `/api/stations`
- `/stage-title` — admin: set the main server stage title (persisted in `.env`)
- `/247-toggle` — admin: enable or disable 24/7 stage streaming (persisted in `.env`)

In the official guild while 24/7 stage mode is on, `/play` and `/stop` are blocked. Users are prompted to join the stage channel to listen.

## v3 API integration

The bot reads from the current v3 API surface:

| Endpoint | Use |
|----------|-----|
| `GET /api/stats` | Now playing, live/offline state, artwork |
| `POST /api/getDaySlots` | Schedule and presenter commands |
| `GET /api/fetchUser?discord_id=` | `/verify` role sync |
| `GET /api/stations` | Station list and default stream URL fallback |

Set `SITE_BASE_URL` once (default `https://rebootradio.uk/v3`). Individual API URLs are derived automatically unless overridden.

### Stats format

The bot supports the current stats payload, including:

- `presenter`, `song`
- `meta.stream.is_live`, `meta.stream.is_offline`, `meta.stream.station`
- relative artwork paths such as `avatars/default.png` (resolved against `SITE_BASE_URL`)

### Verify / role sync

`/verify` calls `fetchUser` and syncs:

- numeric `roles[]` via `LINKED_ROLE_MAP_JSON`
- optional `features[]` slugs via `FEATURE_ROLE_MAP_JSON` (e.g. `radio_visualizer`)
- `STAFF_ROLE_ID` when role `0` is present
- `MEMBER_ROLE_ID` for any linked account

Users who are not linked are directed to **Settings** on the site to connect Discord.

## Setup

```bash
npm install
cp .env.example .env
# edit .env
npm start
```

`@snazzah/davey`, `@noble/ciphers`, and `opusscript` are required for Discord voice (DAVE E2EE + encoding). On startup the bot logs `generateDependencyReport()`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `SITE_BASE_URL` | No | Site root, default `https://rebootradio.uk/v3` |
| `RADIO_STREAM_URL` | No* | Stream URL; falls back to default station from `/api/stations` |
| `STATION_SLUG` | No | Adds `?station=` to stats requests |
| `TARGET_GUILD_ID` | No | Guild for schedule automation and `/verify` |
| `LINKED_ROLE_MAP_JSON` | No | Map site role numbers to Discord role IDs |
| `FEATURE_ROLE_MAP_JSON` | No | Map feature slugs to Discord role IDs |
| `STAFF_ROLE_ID` | No | Staff role when API role `0` is present |
| `MEMBER_ROLE_ID` | No | Role granted to verified linked users |
| `STAGE_CHANNEL_ID` | No* | Stage channel ID for 24/7 streaming in the official guild |
| `STAGE_TITLE` | No | Stage topic/title, default `Reboot Radio — Live 24/7` |
| `STAGE_247_ENABLED` | No | `true`/`false`, default `true`; persisted when toggled via `/247-toggle` |

\* Either `RADIO_STREAM_URL` or a default station with `stream_url` from the API is required.

\*\* Set `STAGE_CHANNEL_ID` to enable 24/7 stage mode. The bot needs **Connect**, **Speak**, and **Manage Channels** (or stage moderator) in that stage channel.

## Role mapping setup

Run the interactive mapper (updates only `LINKED_ROLE_MAP_JSON`, `FEATURE_ROLE_MAP_JSON`, `STAFF_ROLE_ID`, and `MEMBER_ROLE_ID` in your existing `.env`):

```bash
npm run setup-roles
```

For the full username list with Discord IDs, add database credentials to `.env` (optional, setup script only):

```
SITE_DB_HOST=localhost
SITE_DB_USER=reboot
SITE_DB_PASSWORD=your_password
SITE_DB_NAME=reboot_panel
```

Without `SITE_DB_*`, the script uses the built-in usergroups list and loads usernames from the public `searchCommunity` API (Discord IDs won't be shown).

## Notes

- Schedule PNG is generated in-process (no image library dependency).
- Stream playback uses FFmpeg with user-agent `Reboot Radio Bot by Reboot Media Group`.
- Voice join retries with extended readiness timeout to reduce intermittent connection failures.
- Install FFmpeg on the host running the bot.
- 24/7 stage mode auto-rejoins if the bot is moved, kicked, disconnected, or the stream ends. Admins can disable it with `/247-toggle`; the setting survives restarts via `.env`.

## Site dependency

`/verify` requires `api/routes/fetchUser.php` on the site to use the shared app database connection and return `found`, `roles`, and optionally `features` for linked users.
