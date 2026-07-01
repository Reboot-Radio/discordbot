import {
  FETCH_USER_URL,
  SCHEDULE_URL,
  STATIONS_URL,
  STATS_URL,
  fetchJson,
  resolveMediaUrl,
} from './config.js';

export function toSlotArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.slots)) return payload.slots;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.slots && typeof payload.slots === 'object') {
    return Object.values(payload.slots);
  }
  return [];
}

export function parseStatsDisplay(stats) {
  const isLive = !!stats?.meta?.stream?.is_live;
  const isOffline = !!stats?.meta?.stream?.is_offline || !!stats?.meta?.song?.offline;
  const presenter = stats?.presenter?.name?.trim() || 'Reboot';
  const station = stats?.meta?.stream?.station || 'default';

  if (isLive) {
    const streamer = stats?.meta?.stream?.streamer_name?.trim()
      || stats?.presenter?.name?.trim()
      || 'Reboot';

    return {
      isLive: true,
      isOffline: false,
      presenter: streamer,
      artist: streamer,
      track: 'Live on air',
      art: resolveMediaUrl(stats?.presenter?.avatar || stats?.song?.art),
      station,
    };
  }

  return {
    isLive: false,
    isOffline,
    presenter,
    artist: stats?.song?.artist?.trim() || 'Unknown artist',
    track: stats?.song?.track?.trim() || (isOffline ? 'Station offline' : 'Unknown track'),
    art: resolveMediaUrl(stats?.song?.art || stats?.presenter?.avatar),
    station,
  };
}

export async function getNowPlayingStats() {
  const stats = await fetchJson(STATS_URL, { method: 'GET' });
  if (!stats?.presenter && !stats?.song) {
    throw new Error('Stats response did not include presenter or song data.');
  }
  return stats;
}

export function buildPresenceText(stats) {
  const display = parseStatsDisplay(stats);
  if (display.isLive) {
    return `${display.presenter} Live on air`.slice(0, 128);
  }
  return `${display.presenter} Playing ${display.track} By ${display.artist}`.slice(0, 128);
}

export async function fetchScheduleSlots(offset = 0) {
  const payload = await fetchJson(SCHEDULE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ offset: String(offset) }).toString(),
  });

  if (payload?.response === false && !payload?.slots) {
    throw new Error(payload?.error || 'Schedule API returned an error.');
  }

  return toSlotArray(payload);
}

export async function fetchLinkedUser(discordId) {
  const url = new URL(FETCH_USER_URL);
  url.searchParams.set('discord_id', discordId);
  return fetchJson(url.toString(), { method: 'GET' });
}

export async function fetchStations() {
  const payload = await fetchJson(STATIONS_URL, { method: 'GET' });
  return Array.isArray(payload) ? payload : [];
}

export async function resolveStreamUrl(preferredSlug = '') {
  const stations = await fetchStations();
  if (stations.length === 0) {
    return null;
  }

  const slug = String(preferredSlug || '').trim().toLowerCase();
  let station = null;

  if (slug) {
    station = stations.find((row) => String(row.id).toLowerCase() === slug
      || String(row.name || '').toLowerCase() === slug);
  }

  if (!station) {
    station = stations.find((row) => String(row.is_default) === '1' || row.is_default === 1 || row.is_default === true)
      || stations[0];
  }

  return station?.stream_url || null;
}
