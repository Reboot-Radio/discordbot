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
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';

const {
  DISCORD_TOKEN,
  RADIO_STREAM_URL,
  STATS_URL = 'https://rebootradio.uk/v3/api/stats',
} = process.env;

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

const slashCommands = [
  new SlashCommandBuilder().setName('play').setDescription('Join your voice channel and play the radio stream.'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop streaming and leave the voice channel.'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Show current now-playing info from stats API.'),
].map((command) => command.toJSON());

function extractJsonFromMixedBody(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in stats response body.');
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

  for (const guild of client.guilds.cache.values()) {
    try {
      await registerGuildCommands(guild.id);
      console.log(`Registered slash commands for guild ${guild.name} (${guild.id})`);
    } catch (error) {
      console.error(`Failed to register commands for guild ${guild.id}:`, error);
    }
  }
});

client.on('guildCreate', async (guild) => {
  try {
    await registerGuildCommands(guild.id);
    console.log(`Registered slash commands for new guild ${guild.name} (${guild.id})`);
  } catch (error) {
    console.error(`Failed to register commands for new guild ${guild.id}:`, error);
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
