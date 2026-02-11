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

const {
  DISCORD_TOKEN,
  RADIO_STREAM_URL,
  STATS_URL = 'https://rebootradio.uk/v3/api/stats',
  SCHEDULE_URL = 'https://rebootradio/v3/api/getDaySlots',
} = process.env;

const TARGET_GUILD_ID = '1470711513097568389';
const SCHEDULE_CHANNEL_NAME = 'schedule';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const STATE_FILE = path.join(DATA_DIR, 'schedule-state.json');

if (!DISCORD_TOKEN) {
  throw new Error('Missing DISCORD_TOKEN in environment.');
}

if (!RADIO_STREAM_URL) {
  throw new Error('Missing RADIO_STREAM_URL in environment.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const player = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Pause,
  },
});

const voiceConnections = new Map();
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

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

function toSlotArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.slots)) {
    return payload.slots;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

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
  return createHash('sha256')
    .update(JSON.stringify({ slots, liveSlot }))
    .digest('hex');
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

function createScheduleSvg(slots, liveSlot) {
  const usableSlots = slots.slice(0, 24);
  const width = 1180;
  const rowHeight = 40;
  const topPadding = 100;
  const bottomPadding = 40;
  const height = topPadding + bottomPadding + usableSlots.length * rowHeight;

  const rows = usableSlots
    .map((slot, index) => {
      const slotHour = index + 1;
      const isLive = slotHour === liveSlot;
      const y = topPadding + index * rowHeight;
      const timeLabel = slotHour === 24 ? '12:00 AM' : `${String(slotHour).padStart(2, '0')}:00`;
      const normalized = normalizeSlot(slot, index);
      const bg = isLive ? '#ff1f8f' : index % 2 === 0 ? '#181825' : '#11111b';
      const titleColor = '#ffffff';
      const subtitleColor = '#d7d7df';

      return `
      <rect x="20" y="${y}" width="1140" height="36" rx="6" fill="${bg}" />
      <text x="40" y="${y + 23}" font-size="16" fill="#f9f9fb" font-family="Arial, sans-serif">${escapeXml(timeLabel)}</text>
      <text x="170" y="${y + 20}" font-size="16" fill="${titleColor}" font-weight="700" font-family="Arial, sans-serif">${escapeXml(normalized.title)}</text>
      <text x="170" y="${y + 33}" font-size="12" fill="${subtitleColor}" font-family="Arial, sans-serif">${escapeXml(normalized.subtitle)}</text>
      ${isLive ? `<text x="1075" y="${y + 23}" font-size="12" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700">LIVE</text>` : ''}
      `;
    })
    .join('');

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#0b0b12"/>
    <text x="20" y="44" font-size="34" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700">RebootRadio Schedule</text>
    <text x="20" y="74" font-size="16" fill="#b8b8c8" font-family="Arial, sans-serif">Live slot highlighted based on Europe/London current hour</text>
    ${rows}
  </svg>
  `.trim();
}

function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function fetchScheduleSlots(offset = 0) {
  const response = await fetch(SCHEDULE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'RebootRadioDiscordBot/1.0',
    },
    body: JSON.stringify({ offset }),
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
    if (existing && existing.isTextBased()) {
      return existing;
    }
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
  if (!guild) {
    return;
  }

  const channel = await ensureScheduleChannel(guild);
  const slots = await fetchScheduleSlots(0);
  const liveSlot = getLiveSlotFromLondonTime();
  const scheduleHash = buildScheduleSignature(slots, liveSlot);

  const hasChanged =
    force ||
    scheduleHash !== scheduleState.lastScheduleHash ||
    scheduleState.lastLiveSlot !== liveSlot;

  if (!hasChanged) {
    return;
  }

  const svg = createScheduleSvg(slots, liveSlot);
  const attachment = new AttachmentBuilder(Buffer.from(svg, 'utf8'), { name: 'schedule.svg' });

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
  if (!client.user) {
    return;
  }

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
  if (!interaction.isChatInputCommand() || !interaction.guildId) {
    return;
  }

  if (interaction.commandName === 'play') {
    await joinAndPlay(interaction);
    return;
  }

  if (interaction.commandName === 'stop') {
    await stopStreaming(interaction);
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
