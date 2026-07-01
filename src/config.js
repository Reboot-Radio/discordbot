function trimSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (error) {
    console.error(`Invalid ${name}; expected JSON object.`, error);
    return fallback;
  }
}

export const SITE_BASE_URL = trimSlash(process.env.SITE_BASE_URL || 'https://rebootradio.uk/v3');
export const STATION_SLUG = String(process.env.STATION_SLUG || '').trim();
export const TARGET_GUILD_ID = process.env.TARGET_GUILD_ID || '1470711513097568389';
export const SCHEDULE_CHANNEL_NAME = process.env.SCHEDULE_CHANNEL_NAME || 'schedule';
export const STREAM_USER_AGENT = process.env.STREAM_USER_AGENT || 'RebootRadioBotByRebootMedia Group';
export const PRESENCE_UPDATE_INTERVAL_MS = Number(process.env.PRESENCE_UPDATE_INTERVAL_MS || 60_000);

export const RADIO_STREAM_URL = process.env.RADIO_STREAM_URL || '';
export const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';

export const LINKED_ROLE_MAP = parseJsonEnv('LINKED_ROLE_MAP_JSON', {});
export const FEATURE_ROLE_MAP = parseJsonEnv('FEATURE_ROLE_MAP_JSON', {});
export const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || '';
export const MEMBER_ROLE_ID = process.env.MEMBER_ROLE_ID || '';

export function apiUrl(route) {
  const path = String(route || '').replace(/^\//, '');
  return `${SITE_BASE_URL}/api/${path}`;
}

function buildStatsUrl() {
  const url = new URL(apiUrl('stats'));
  if (STATION_SLUG) {
    url.searchParams.set('station', STATION_SLUG);
  }
  return url.toString();
}

export const STATS_URL = process.env.STATS_URL || buildStatsUrl();
export const SCHEDULE_URL = process.env.SCHEDULE_URL || apiUrl('getDaySlots');
export const FETCH_USER_URL = process.env.FETCH_USER_URL || apiUrl('fetchUser');
export const STATIONS_URL = process.env.STATIONS_URL || apiUrl('stations');
export const SETTINGS_URL = `${SITE_BASE_URL}/settings`;

export function resolveMediaUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${SITE_BASE_URL}/${url.replace(/^\//, '')}`;
}

export function extractJsonFromMixedBody(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in response body.');
  }

  return JSON.parse(text.slice(start, end + 1));
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'RebootRadioDiscordBot/1.1',
      ...(options.headers || {}),
    },
  });

  const body = await response.text();
  const payload = body.includes('{') || body.includes('[')
    ? extractJsonFromMixedBody(body)
    : JSON.parse(body);

  if (!response.ok && payload?.error) {
    throw new Error(`${response.status} ${response.statusText}: ${payload.error}`);
  }

  if (!response.ok && !body.includes('{') && !body.includes('[')) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return payload;
}
