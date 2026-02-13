import 'dotenv/config';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import {
  ActivityType,
  AttachmentBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const {
  DISCORD_TOKEN,
  RADIO_STREAM_URL,
  STATS_URL = 'https://rebootradio.uk/v3/api/stats',
  SCHEDULE_URL = 'https://rebootradio.uk/v3/api/getDaySlots',
  FETCH_USER_URL = 'https://rebootradio.uk/v3/api/fetchUser',
  LINKED_ROLE_MAP_JSON = '{}',
  STAFF_ROLE_ID = '',
  MEMBER_ROLE_ID = '',
} = process.env;

const TARGET_GUILD_ID = '1470711513097568389';
const SCHEDULE_CHANNEL_NAME = 'schedule';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const STATE_FILE = path.join(DATA_DIR, 'schedule-state.json');
const PRESENCE_UPDATE_INTERVAL_MS = 60_000;

if (!DISCORD_TOKEN) {
  throw new Error('Missing DISCORD_TOKEN in environment.');
}

if (!RADIO_STREAM_URL) {
  throw new Error('Missing RADIO_STREAM_URL in environment.');
}

const FONT_5X7 = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00100', '01000', '10000', '00000', '00000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00100', '00100'],
  "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
});

const player = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Pause,
  },
});

const voiceConnections = new Map();
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

const linkedRoleMap = (() => {
  try {
    const parsed = JSON.parse(LINKED_ROLE_MAP_JSON);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('Invalid LINKED_ROLE_MAP_JSON; expected JSON object.', error);
    return {};
  }
})();

const scheduleState = {
  channelId: null,
  messageId: null,
  lastScheduleHash: null,
  lastLiveSlot: null,
};

const slashCommands = [
  new SlashCommandBuilder().setName('play').setDescription('Join your voice channel and play the radio stream.'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop streaming and leave the voice channel.'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Show current now-playing info from stats API.'),
  new SlashCommandBuilder().setName('verify').setDescription('Verify your RebootRadio account and sync linked roles.'),
  new SlashCommandBuilder().setName('presenter').setDescription('Show live presenter and next 2 slots.'),
].map((command) => command.toJSON());

function extractJsonFromMixedBody(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in response body.');
  }

  return JSON.parse(text.slice(start, end + 1));
}

async function getNowPlayingStats() {
  const response = await fetch(STATS_URL, {
    headers: {
      'User-Agent': 'RebootRadioDiscordBot/1.0',
      Accept: 'application/json,text/plain,*/*',
    },
  });

  const body = await response.text();

  if (!response.ok && !body.includes('{')) {
    throw new Error(`Stats request failed: ${response.status} ${response.statusText}`);
  }

  return extractJsonFromMixedBody(body);
}

function buildNowPlayingEmbed(stats) {
  const presenter = stats?.presenter?.name || 'Unknown';
  const artist = stats?.song?.artist || 'Unknown artist';
  const track = stats?.song?.track || 'Unknown track';
  const coverArt = stats?.song?.art || stats?.presenter?.avatar || null;

  const embed = new EmbedBuilder()
    .setTitle('RebootRadio — Now Playing')
    .setDescription(`**${track}**\nby *${artist}*`)
    .addFields({ name: 'Presenter', value: presenter, inline: true })
    .setColor(0xff0055)
    .setTimestamp();

  if (coverArt?.startsWith('http')) {
    embed.setThumbnail(coverArt);
  }

  return embed;
}


function buildLiveActivityFromStats(stats) {
  const presenter = stats?.presenter?.name?.trim() || 'AutoDJ';
  const artist = stats?.song?.artist?.trim() || 'Unknown Artist';
  const track = stats?.song?.track?.trim() || 'Unknown Song';
  const songArt = stats?.song?.art || 'no song art';

  const name = 'RebootRadio'.slice(0, 128);
  const state = `Live: ${presenter} | Art: ${songArt}`.slice(0, 128);
  const details = `${track} — ${artist}`.slice(0, 128);

  return {
    name,
    state,
    details,
  };
}

async function updateBotPresence() {
  if (!client.user) {
    return;
  }

  try {
    const stats = await getNowPlayingStats();
    const activity = buildLiveActivityFromStats(stats);

    client.user.setPresence({
      activities: [
        {
          name: activity.name,
          state: activity.state,
          details: activity.details,
          type: ActivityType.Playing,
        },
      ],
      status: 'online',
    });
  } catch (error) {
    console.error('Failed to update bot presence:', error);
  }
}

function startPresenceUpdater() {
  setInterval(async () => {
    await updateBotPresence();
  }, PRESENCE_UPDATE_INTERVAL_MS);
}

function toSlotArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.slots)) return payload.slots;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function getLiveSlotFromLondonTime() {
  const londonHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour12: false,
      hour: '2-digit',
    }).format(new Date()),
  );

  return londonHour === 0 ? 24 : londonHour;
}

function buildScheduleSignature(slots, liveSlot) {
  return createHash('sha256').update(JSON.stringify({ slots, liveSlot })).digest('hex');
}

function normalizeSlot(slot, index) {
  const fallbackTitle = `Slot ${index + 1}`;
  if (typeof slot === 'string') {
    return { title: slot, subtitle: '' };
  }

  return {
    title: slot?.show_name || slot?.name || slot?.title || slot?.presenter || fallbackTitle,
    subtitle: slot?.presenter || slot?.description || slot?.dj || '',
  };
}

function sanitizeText(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 :\-\/&.'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createCanvas(width, height, color = [11, 11, 18, 255]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * 4;
    data[idx] = color[0];
    data[idx + 1] = color[1];
    data[idx + 2] = color[2];
    data[idx + 3] = color[3];
  }
  return { width, height, data };
}

function setPixel(canvas, x, y, rgba) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const idx = (y * canvas.width + x) * 4;
  canvas.data[idx] = rgba[0];
  canvas.data[idx + 1] = rgba[1];
  canvas.data[idx + 2] = rgba[2];
  canvas.data[idx + 3] = rgba[3] ?? 255;
}

function fillRect(canvas, x, y, width, height, rgba) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      setPixel(canvas, xx, yy, rgba);
    }
  }
}

function drawText(canvas, x, y, text, rgba, scale = 2, maxChars = 50) {
  const cleaned = sanitizeText(text).slice(0, maxChars);
  let cursorX = x;

  for (const ch of cleaned) {
    const glyph = FONT_5X7[ch] || FONT_5X7[' '];
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy][gx] === '1') {
          fillRect(canvas, cursorX + gx * scale, y + gy * scale, scale, scale, rgba);
        }
      }
    }
    cursorX += (5 + 1) * scale;
  }
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = createCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function canvasToPng(canvas) {
  const { width, height, data } = canvas;
  const rowLen = width * 4;
  const raw = Buffer.alloc((rowLen + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (rowLen + 1);
    raw[rawOffset] = 0;
    data.copy(raw, rawOffset + 1, y * rowLen, (y + 1) * rowLen);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createSchedulePng(slots, liveSlot) {
  const usableSlots = slots.slice(0, 24);
  const width = 1180;
  const rowHeight = 40;
  const topPadding = 92;
  const bottomPadding = 26;
  const height = topPadding + bottomPadding + usableSlots.length * rowHeight;
  const canvas = createCanvas(width, height, [11, 11, 18, 255]);

  drawText(canvas, 24, 18, 'REBOOTRADIO SCHEDULE', [255, 255, 255, 255], 3, 26);
  drawText(canvas, 24, 58, 'LIVE SLOT FROM EUROPE/LONDON TIME', [184, 184, 200, 255], 2, 42);

  usableSlots.forEach((_, index) => {
    const y = topPadding + index * rowHeight;
    const slotHour = index + 1;
    const isLive = slotHour === liveSlot;
    const bg = isLive ? [255, 31, 143, 255] : index % 2 === 0 ? [24, 24, 37, 255] : [17, 17, 27, 255];
    const shiftedSlot = usableSlots[(index + 1) % usableSlots.length] || {};
    const normalized = normalizeSlot(shiftedSlot, index);
    const timeLabel = slotHour === 24 ? '12:00 AM' : `${String(slotHour).padStart(2, '0')}:00`;

    fillRect(canvas, 20, y, 1140, 36, bg);
    drawText(canvas, 34, y + 10, timeLabel, [249, 249, 251, 255], 2, 10);
    drawText(canvas, 170, y + 8, normalized.title, [255, 255, 255, 255], 2, 55);
    drawText(canvas, 170, y + 22, normalized.subtitle, [215, 215, 223, 255], 1, 110);

    if (isLive) {
      drawText(canvas, 1088, y + 12, 'LIVE', [255, 255, 255, 255], 2, 6);
    }
  });

  return canvasToPng(canvas);
}


async function fetchLinkedUser(discordId) {
  const url = new URL(FETCH_USER_URL);
  url.searchParams.set('discord_id', discordId);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'RebootRadioDiscordBot/1.0',
    },
  });

  const body = await response.text();
  const payload = body.includes('{') ? extractJsonFromMixedBody(body) : JSON.parse(body);

  if (!response.ok) {
    throw new Error(`Fetch user request failed: ${response.status} ${response.statusText}`);
  }

  return payload;
}

async function syncLinkedRoles(member, apiRoles) {
  const roleIdsToAdd = new Set();
  const mappedRoleIds = new Set(Object.values(linkedRoleMap).filter(Boolean));

  for (const roleNumber of apiRoles) {
    const mappedRoleId = linkedRoleMap[String(roleNumber)];
    if (mappedRoleId) {
      roleIdsToAdd.add(mappedRoleId);
    }
  }

  if (apiRoles.includes('0') && STAFF_ROLE_ID) {
    roleIdsToAdd.add(STAFF_ROLE_ID);
  }

  if (MEMBER_ROLE_ID) {
    roleIdsToAdd.add(MEMBER_ROLE_ID);
  }

  const currentRoleIds = new Set(member.roles.cache.map((role) => role.id));

  const mappedManagedIds = new Set(mappedRoleIds);
  if (STAFF_ROLE_ID) mappedManagedIds.add(STAFF_ROLE_ID);
  if (MEMBER_ROLE_ID) mappedManagedIds.add(MEMBER_ROLE_ID);

  const toAdd = [...roleIdsToAdd].filter((roleId) => !currentRoleIds.has(roleId));
  const toRemove = [...mappedManagedIds].filter((roleId) => currentRoleIds.has(roleId) && !roleIdsToAdd.has(roleId));

  if (toAdd.length > 0) {
    await member.roles.add(toAdd, 'Linked role sync via /verify');
  }

  if (toRemove.length > 0) {
    await member.roles.remove(toRemove, 'Linked role sync via /verify');
  }

  return { added: toAdd.length, removed: toRemove.length };
}

async function runVerify(interaction) {
  if (interaction.guildId !== TARGET_GUILD_ID) {
    await interaction.reply({
      content: 'Linked role verification is only available in the official RebootRadio server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await fetchLinkedUser(interaction.user.id);

    if (!result?.found) {
      await interaction.editReply('No linked RebootRadio account found. Please link your Discord account on the RebootRadio website first.');
      return;
    }

    const apiRoles = Array.isArray(result.roles) ? result.roles.map((value) => String(value)) : [];
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const syncResult = await syncLinkedRoles(member, apiRoles);

    await interaction.editReply(`Verification successful. Role sync complete. Added: ${syncResult.added}, Removed: ${syncResult.removed}.`);
  } catch (error) {
    console.error('Verify command failed:', error);
    await interaction.editReply('Verification failed right now. Please try again in a moment.');
  }
}

function getShiftedSlot(slots, displayHour) {
  if (!Array.isArray(slots) || slots.length === 0) return null;
  const idx = (displayHour % slots.length);
  return slots[idx] ?? null;
}

function formatHourLabel(hour24) {
  if (hour24 === 0 || hour24 === 24) return '12:00 AM';
  return `${String(hour24).padStart(2, '0')}:00`;
}

function createPresenterCardPng(liveSlot, nextSlots) {
  const width = 1180;
  const height = 420;
  const canvas = createCanvas(width, height, [11, 11, 18, 255]);

  fillRect(canvas, 20, 20, 1140, 120, [255, 31, 143, 255]);
  drawText(canvas, 40, 40, 'LIVE PRESENTER', [255, 255, 255, 255], 2, 24);
  drawText(canvas, 40, 76, `${liveSlot.time} ${liveSlot.presenter}`, [255, 255, 255, 255], 2, 68);

  drawText(canvas, 40, 170, 'NEXT SLOTS', [184, 184, 200, 255], 2, 20);

  nextSlots.forEach((slot, i) => {
    const y = 210 + i * 85;
    fillRect(canvas, 40, y, 1100, 70, i % 2 === 0 ? [24, 24, 37, 255] : [17, 17, 27, 255]);
    drawText(canvas, 60, y + 18, `${slot.time} ${slot.presenter}`, [255, 255, 255, 255], 2, 70);
  });

  return canvasToPng(canvas);
}

async function runPresenter(interaction) {
  await interaction.deferReply();

  try {
    const slots = await fetchScheduleSlots(0);
    const currentHour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour12: false,
        hour: '2-digit',
      }).format(new Date()),
    );

    const displayHour = currentHour === 0 ? 24 : currentHour;
    const liveShifted = getShiftedSlot(slots, displayHour);
    const next1 = getShiftedSlot(slots, displayHour + 1);
    const next2 = getShiftedSlot(slots, displayHour + 2);

    const liveData = normalizeSlot(liveShifted || {}, displayHour - 1);
    const nextData = [next1, next2].map((slot, idx) => normalizeSlot(slot || {}, displayHour + idx));

    const liveCard = {
      time: formatHourLabel(displayHour),
      presenter: liveData.title,
    };

    const nextCards = [
      {
        time: formatHourLabel((displayHour + 1) % 24),
        presenter: nextData[0].title,
      },
      {
        time: formatHourLabel((displayHour + 2) % 24),
        presenter: nextData[1].title,
      },
    ];

    const image = createPresenterCardPng(liveCard, nextCards);
    const lineupAttachment = new AttachmentBuilder(image, { name: 'presenter.png' });

    await interaction.editReply({
      content: '',
      files: [lineupAttachment],
    });
  } catch (error) {
    console.error('Presenter command failed:', error);
    await interaction.editReply('Could not build presenter image right now.');
  }
}

async function fetchScheduleSlots(offset = 0) {
  const response = await fetch(SCHEDULE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: '*/*',
      'Accept-Encoding': 'deflate, gzip',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    },
    body: new URLSearchParams({ offset: String(offset) }).toString(),
  });

  const body = await response.text();
  const payload = body.includes('{') ? extractJsonFromMixedBody(body) : JSON.parse(body);

  if (!response.ok) {
    throw new Error(`Schedule request failed: ${response.status} ${response.statusText}`);
  }

  return toSlotArray(payload);
}

async function loadScheduleState() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    scheduleState.channelId = parsed.channelId || null;
    scheduleState.messageId = parsed.messageId || null;
    scheduleState.lastScheduleHash = parsed.lastScheduleHash || null;
    scheduleState.lastLiveSlot = parsed.lastLiveSlot || null;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed loading schedule state:', error);
    }
  }
}

async function saveScheduleState() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(scheduleState, null, 2), 'utf8');
}

async function ensureScheduleChannel(guild) {
  if (scheduleState.channelId) {
    const existing = await guild.channels.fetch(scheduleState.channelId).catch(() => null);
    if (existing && existing.isTextBased()) return existing;
  }

  const byName = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === SCHEDULE_CHANNEL_NAME,
  );

  if (byName) {
    scheduleState.channelId = byName.id;
    await saveScheduleState();
    return byName;
  }

  const created = await guild.channels.create({
    name: SCHEDULE_CHANNEL_NAME,
    type: ChannelType.GuildText,
    reason: 'Create schedule channel for automated timetable image updates.',
  });

  scheduleState.channelId = created.id;
  await saveScheduleState();
  return created;
}

async function postOrUpdateScheduleMessage(force = false) {
  const guild = await client.guilds.fetch(TARGET_GUILD_ID).catch(() => null);
  if (!guild) return;

  const channel = await ensureScheduleChannel(guild);
  const slots = await fetchScheduleSlots(0);
  const liveSlot = getLiveSlotFromLondonTime();
  const scheduleHash = buildScheduleSignature(slots, liveSlot);

  const hasChanged = force || scheduleHash !== scheduleState.lastScheduleHash || scheduleState.lastLiveSlot !== liveSlot;
  if (!hasChanged) return;

  const png = createSchedulePng(slots, liveSlot);
  const attachment = new AttachmentBuilder(png, { name: 'schedule.png' });

  if (scheduleState.messageId) {
    const oldMessage = await channel.messages.fetch(scheduleState.messageId).catch(() => null);
    if (oldMessage) {
      await oldMessage.edit({
        content: `Updated schedule (${new Date().toISOString()})`,
        files: [attachment],
      });
    } else {
      const message = await channel.send({
        content: `Schedule (${new Date().toISOString()})`,
        files: [attachment],
      });
      scheduleState.messageId = message.id;
    }
  } else {
    const message = await channel.send({
      content: `Schedule (${new Date().toISOString()})`,
      files: [attachment],
    });
    scheduleState.messageId = message.id;
  }

  scheduleState.channelId = channel.id;
  scheduleState.lastScheduleHash = scheduleHash;
  scheduleState.lastLiveSlot = liveSlot;
  await saveScheduleState();
}

function startScheduleWatcher() {
  setInterval(async () => {
    try {
      await postOrUpdateScheduleMessage(false);
    } catch (error) {
      console.error('Schedule watcher update failed:', error);
    }
  }, 60_000);
}

async function registerGuildCommands(guildId) {
  if (!client.user) return;

  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
    body: slashCommands,
  });
}

async function joinAndPlay(interaction) {
  const channel = interaction.member?.voice?.channel;

  if (!channel) {
    await interaction.reply({
      content: 'Join a voice channel first, then run this command.',
      ephemeral: true,
    });
    return;
  }

  const existingConnection = voiceConnections.get(interaction.guildId);
  if (existingConnection && existingConnection.state.status !== VoiceConnectionStatus.Destroyed) {
    await interaction.reply({
      content: 'Already connected and playing. Use `/stop` first if you want me to reconnect.',
      ephemeral: true,
    });
    return;
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const resource = createAudioResource(RADIO_STREAM_URL, {
      inlineVolume: false,
    });

    player.play(resource);
    connection.subscribe(player);
    voiceConnections.set(interaction.guildId, connection);

    await interaction.reply(`Connected to **${channel.name}** and streaming your station.`);
  } catch (error) {
    connection.destroy();
    voiceConnections.delete(interaction.guildId);
    console.error('Failed to join or stream:', error);
    await interaction.reply('I could not connect/play the station. Check stream URL and ffmpeg/opus support on host.');
  }
}

async function stopStreaming(interaction) {
  const connection = voiceConnections.get(interaction.guildId);

  if (!connection) {
    await interaction.reply({ content: 'I am not connected in this server.', ephemeral: true });
    return;
  }

  player.stop(true);
  connection.destroy();
  voiceConnections.delete(interaction.guildId);

  await interaction.reply('Stopped stream and left voice channel.');
}

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await loadScheduleState();

  for (const guild of client.guilds.cache.values()) {
    try {
      await registerGuildCommands(guild.id);
      console.log(`Registered slash commands for guild ${guild.name} (${guild.id})`);
    } catch (error) {
      console.error(`Failed to register commands for guild ${guild.id}:`, error);
    }
  }

  try {
    await postOrUpdateScheduleMessage(true);
  } catch (error) {
    console.error('Initial manual schedule check failed:', error);
  }

  await updateBotPresence();
  startPresenceUpdater();
  startScheduleWatcher();
});

client.on('guildCreate', async (guild) => {
  try {
    await registerGuildCommands(guild.id);
    console.log(`Registered slash commands for new guild ${guild.name} (${guild.id})`);
  } catch (error) {
    console.error(`Failed to register commands for new guild ${guild.id}:`, error);
  }

  if (guild.id === TARGET_GUILD_ID) {
    try {
      await postOrUpdateScheduleMessage(true);
    } catch (error) {
      console.error('Failed to initialize schedule channel/message on guild join:', error);
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guildId) return;

  if (interaction.commandName === 'play') {
    await joinAndPlay(interaction);
    return;
  }

  if (interaction.commandName === 'stop') {
    await stopStreaming(interaction);
    return;
  }

  if (interaction.commandName === 'verify') {
    await runVerify(interaction);
    return;
  }

  if (interaction.commandName === 'presenter') {
    await runPresenter(interaction);
    return;
  }

  if (interaction.commandName === 'nowplaying') {
    try {
      await interaction.deferReply();
      const stats = await getNowPlayingStats();
      const embed = buildNowPlayingEmbed(stats);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Stats fetch failed:', error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Could not fetch now playing stats right now.');
      } else {
        await interaction.reply('Could not fetch now playing stats right now.');
      }
    }
  }
});

player.on(AudioPlayerStatus.Idle, () => {
  for (const [guildId, connection] of voiceConnections) {
    if (connection.state.status === VoiceConnectionStatus.Ready) {
      try {
        connection.subscribe(player);
        player.play(createAudioResource(RADIO_STREAM_URL));
      } catch (error) {
        console.error(`Failed to restart stream for guild ${guildId}:`, error);
      }
    }
  }
});

client.login(DISCORD_TOKEN);
