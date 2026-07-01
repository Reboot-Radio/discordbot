import 'dotenv/config';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionDisconnectReason,
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
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  DISCORD_TOKEN,
  FEATURE_ROLE_MAP,
  LINKED_ROLE_MAP,
  MEMBER_ROLE_ID,
  PRESENCE_UPDATE_INTERVAL_MS,
  RADIO_STREAM_URL,
  SCHEDULE_CHANNEL_NAME,
  SETTINGS_URL,
  STAFF_ROLE_ID,
  STREAM_USER_AGENT,
  TARGET_GUILD_ID,
} from './config.js';
import {
  buildPresenceText,
  fetchLinkedUser,
  fetchScheduleSlots,
  fetchStations,
  getNowPlayingStats,
  parseStatsDisplay,
  resolveStreamUrl,
  toSlotArray,
} from './siteApi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const STATE_FILE = path.join(DATA_DIR, 'schedule-state.json');

let activeStreamUrl = RADIO_STREAM_URL;

if (!DISCORD_TOKEN) {
  throw new Error('Missing DISCORD_TOKEN in environment.');
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

const linkedRoleMap = LINKED_ROLE_MAP;
const featureRoleMap = FEATURE_ROLE_MAP;

const scheduleState = {
  channelId: null,
  messageId: null,
  lastScheduleHash: null,
  lastLiveSlot: null,
};


const ffmpegProcesses = new Map();

function stopGuildFfmpeg(guildId) {
  const processRef = ffmpegProcesses.get(guildId);
  if (!processRef) return;

  try {
    processRef.kill('SIGKILL');
  } catch (error) {
    console.error(`Failed to kill ffmpeg process for guild ${guildId}:`, error);
  }

  ffmpegProcesses.delete(guildId);
}

function createFfmpegAudioResource(guildId) {
  stopGuildFfmpeg(guildId);

  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-user_agent',
    STREAM_USER_AGENT,
    '-i',
    RADIO_STREAM_URL || activeStreamUrl,
    '-f',
    's16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    'pipe:1',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  ffmpeg.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) {
      console.error(`[ffmpeg:${guildId}] ${message}`);
    }
  });

  ffmpeg.on('close', () => {
    ffmpegProcesses.delete(guildId);
  });

  ffmpegProcesses.set(guildId, ffmpeg);

  return createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
  });
}

const slashCommands = [
  new SlashCommandBuilder().setName('play').setDescription('Join your voice channel and play the radio stream.'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop streaming and leave the voice channel.'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Show current now-playing info from stats API.'),
  new SlashCommandBuilder().setName('verify').setDescription('Verify your RebootRadio account and sync linked roles.'),
  new SlashCommandBuilder().setName('presenter').setDescription('Show live presenter and next 2 slots.'),
  new SlashCommandBuilder().setName('stations').setDescription('List available RebootRadio stations.'),
].map((command) => command.toJSON());

function buildNowPlayingEmbed(stats) {
  const display = parseStatsDisplay(stats);
  const embed = new EmbedBuilder()
    .setTitle('RebootRadio — Now Playing')
    .setColor(display.isLive ? 0xff3355 : 0xff0055)
    .setTimestamp();

  if (display.isLive) {
    embed
      .setDescription('**Live on air**')
      .addFields(
        { name: 'Presenter', value: display.presenter, inline: true },
        { name: 'Station', value: display.station, inline: true },
      );
  } else {
    embed
      .setDescription(`**${display.track}**\nby *${display.artist}*`)
      .addFields(
        { name: 'Presenter', value: display.presenter, inline: true },
        { name: 'Station', value: display.station, inline: true },
      );
  }

  if (display.art) {
    embed.setThumbnail(display.art);
  }

  return embed;
}

async function updateBotPresence() {
  if (!client.user) {
    return;
  }

  try {
    const stats = await getNowPlayingStats();
    const statusText = buildPresenceText(stats);

    client.user.setPresence({
      activities: [{ name: statusText, type: ActivityType.Custom }],
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

async function syncLinkedRoles(member, apiRoles, apiFeatures = []) {
  const roleIdsToAdd = new Set();
  const mappedRoleIds = new Set(Object.values(linkedRoleMap).filter(Boolean));
  const managedFeatureRoleIds = new Set(Object.values(featureRoleMap).filter(Boolean));

  for (const roleNumber of apiRoles) {
    const mappedRoleId = linkedRoleMap[String(roleNumber)];
    if (mappedRoleId) {
      roleIdsToAdd.add(mappedRoleId);
    }
  }

  for (const featureSlug of apiFeatures) {
    const mappedRoleId = featureRoleMap[String(featureSlug)];
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

  const mappedManagedIds = new Set([...mappedRoleIds, ...managedFeatureRoleIds]);
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
      await interaction.editReply(`No linked RebootRadio account found. Link your Discord account in Settings first: ${SETTINGS_URL}`);
      return;
    }

    const apiRoles = Array.isArray(result.roles) ? result.roles.map((value) => String(value)) : [];
    const apiFeatures = Array.isArray(result.features) ? result.features.map((value) => String(value)) : [];
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const syncResult = await syncLinkedRoles(member, apiRoles, apiFeatures);

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

async function runStations(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const stations = await fetchStations();
    if (stations.length === 0) {
      await interaction.editReply('No stations are configured on RebootRadio right now.');
      return;
    }

    const lines = stations.map((station) => {
      const isDefault = String(station.is_default) === '1' || station.is_default === 1 || station.is_default === true;
      const label = isDefault ? `${station.name} (default)` : station.name;
      return `• ${label}${station.stream_url ? `\n  Stream: ${station.stream_url}` : ''}`;
    });

    await interaction.editReply(`**RebootRadio stations**\n${lines.join('\n')}`);
  } catch (error) {
    console.error('Stations command failed:', error);
    await interaction.editReply('Could not fetch stations right now.');
  }
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


async function respondToInteraction(interaction, payload) {
  const responsePayload = typeof payload === 'string' ? { content: payload } : payload;

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(responsePayload);
    } else {
      await interaction.reply(responsePayload);
    }
  } catch (error) {
    console.error('Failed to respond to interaction:', error);
  }
}


function stabilizeVoiceConnection(connection, guildId) {
  connection.on('error', (error) => {
    console.error(`Voice connection error (${guildId}):`, error);
  });

  connection.on('stateChange', (oldState, newState) => {
    const networking = Reflect.get(newState, 'networking');
    const udp = networking?.udp;

    if (udp?.keepAliveInterval) {
      clearInterval(udp.keepAliveInterval);
      udp.keepAliveInterval = null;
    }

    if (newState.status === VoiceConnectionStatus.Disconnected) {
      if (newState.reason === VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014) {
        connection.destroy();
        voiceConnections.delete(guildId);
      }
    }

    if (oldState.status !== newState.status) {
      console.log(`Voice state (${guildId}): ${oldState.status} -> ${newState.status}`);
    }
  });
}

async function establishVoiceConnection(channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  stabilizeVoiceConnection(connection, channel.guild.id);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    return connection;
  } catch (firstError) {
    try {
      connection.rejoin();
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      return connection;
    } catch (secondError) {
      connection.destroy();
      throw secondError || firstError;
    }
  }
}

async function joinAndPlay(interaction) {
  await interaction.deferReply();

  const channel = interaction.member?.voice?.channel;

  if (!channel) {
    await respondToInteraction(interaction, {
      content: 'Join a voice channel first, then run this command.',
    });
    return;
  }

  const existingConnection = voiceConnections.get(interaction.guildId);
  if (existingConnection && existingConnection.state.status !== VoiceConnectionStatus.Destroyed) {
    await respondToInteraction(interaction, {
      content: 'Already connected and playing. Use `/stop` first if you want me to reconnect.',
    });
    return;
  }

  let connection;

  try {
    connection = await establishVoiceConnection(channel);

    const resource = createFfmpegAudioResource(interaction.guildId);

    player.play(resource);
    connection.subscribe(player);
    voiceConnections.set(interaction.guildId, connection);

    await respondToInteraction(interaction, `Connected to **${channel.name}** and streaming your station.`);
  } catch (error) {
    if (connection) {
      connection.destroy();
    }
    voiceConnections.delete(interaction.guildId);

    const briefError = error?.code === 'ABORT_ERR'
      ? 'Voice gateway timed out while connecting.'
      : error?.message || 'Unknown connection error';

    console.error(`Failed to join or stream (${interaction.guildId}): ${briefError}`);
    await respondToInteraction(
      interaction,
      'I could not connect/play the station (voice connection timeout). Check bot voice permissions, UDP/voice networking on host, and ffmpeg availability.',
    );
  }
}

async function stopStreaming(interaction) {
  const connection = voiceConnections.get(interaction.guildId);

  if (!connection) {
    await interaction.reply({ content: 'I am not connected in this server.', ephemeral: true });
    return;
  }

  player.stop(true);
  stopGuildFfmpeg(interaction.guildId);
  connection.destroy();
  voiceConnections.delete(interaction.guildId);

  await interaction.reply('Stopped stream and left voice channel.');
}

client.on('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  if (!activeStreamUrl) {
    try {
      activeStreamUrl = await resolveStreamUrl();
      if (activeStreamUrl) {
        console.log(`Resolved stream URL from stations API: ${activeStreamUrl}`);
      }
    } catch (error) {
      console.error('Failed to resolve stream URL from stations API:', error);
    }
  }

  if (!activeStreamUrl) {
    throw new Error('Missing RADIO_STREAM_URL and no default station stream could be resolved.');
  }

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

  if (interaction.commandName === 'stations') {
    await runStations(interaction);
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
        player.play(createFfmpegAudioResource(guildId));
      } catch (error) {
        console.error(`Failed to restart stream for guild ${guildId}:`, error);
      }
    }
  }
});

client.login(DISCORD_TOKEN);
