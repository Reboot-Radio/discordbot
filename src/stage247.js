import {
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  getVoiceConnection,
} from '@discordjs/voice';
import {
  STAGE_CHANNEL_ID,
  STAGE_TITLE,
  STAGE_247_ENABLED,
  STAFF_ROLE_ID,
  TARGET_GUILD_ID,
  setStage247Enabled,
} from './config.js';
import { setEnvPersist } from './envStore.js';

const RECOVERY_DELAY_MS = 2_000;

let recoveryTimer = null;
let recoveryInProgress = false;
let stageTitle = STAGE_TITLE;

export function getStageTitle() {
  return stageTitle;
}

export function setStageTitle(title) {
  stageTitle = title;
}

export function isStage247Active(guildId) {
  return Boolean(
    STAGE_247_ENABLED
    && STAGE_CHANNEL_ID
    && guildId === TARGET_GUILD_ID,
  );
}

export function isStage247Configured() {
  return Boolean(STAGE_CHANNEL_ID && TARGET_GUILD_ID);
}

export function memberIsAdmin(member) {
  if (!member) return false;

  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  return Boolean(STAFF_ROLE_ID && member.roles.cache.has(STAFF_ROLE_ID));
}

export function getMainServerStageBlockMessage() {
  const stageLink = STAGE_CHANNEL_ID
    ? `<#${STAGE_CHANNEL_ID}>`
    : 'the stage channel';

  return `Woah, i love reboot as much as the next guy but you cant run that command in the main server because it messes up the stage setup, however you can come and listen in the stage: ${stageLink}`;
}

function getVoiceApi(deps) {
  return {
    establishVoiceConnection: deps.establishVoiceConnection,
    getGuildPlayer: deps.getGuildPlayer,
    createFfmpegAudioResource: deps.createFfmpegAudioResource,
    safeDestroyGuildVoice: deps.safeDestroyGuildVoice,
    voiceConnections: deps.voiceConnections,
  };
}

export async function ensureStageInstance(guild, channel, title) {
  const existing = await guild.stageInstances.fetch(channel.id).catch(() => null);

  if (existing) {
    if (existing.topic !== title) {
      await existing.setTopic(title);
    }
    return existing;
  }

  return guild.stageInstances.create(channel.id, {
    topic: title,
  });
}

export async function endStageInstance(guild, channelId = STAGE_CHANNEL_ID) {
  if (!channelId) return;

  const existing = await guild.stageInstances.fetch(channelId).catch(() => null);
  if (existing) {
    await existing.delete();
  }
}

export async function ensureStageSpeaker(guild) {
  const me = guild.members.me;
  if (!me?.voice?.channelId || me.voice.channelId !== STAGE_CHANNEL_ID) {
    return;
  }

  if (me.voice.suppress) {
    await me.voice.setSuppressed(false);
  }
}

export async function startStage247(client, deps) {
  if (!isStage247Configured() || !STAGE_247_ENABLED) {
    return;
  }

  const guild = await client.guilds.fetch(TARGET_GUILD_ID).catch(() => null);
  if (!guild) {
    console.error(`Stage 24/7: could not fetch target guild ${TARGET_GUILD_ID}`);
    return;
  }

  const channel = await guild.channels.fetch(STAGE_CHANNEL_ID).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildStageVoice) {
    console.error(`Stage 24/7: STAGE_CHANNEL_ID ${STAGE_CHANNEL_ID} is not a stage channel`);
    return;
  }

  const voiceApi = getVoiceApi(deps);
  const existingConnection = voiceApi.voiceConnections.get(guild.id)
    || getVoiceConnection(guild.id);

  if (
    existingConnection
    && existingConnection.state.status !== VoiceConnectionStatus.Destroyed
    && existingConnection.joinConfig.channelId === STAGE_CHANNEL_ID
  ) {
    await ensureStageInstance(guild, channel, stageTitle);
    await ensureStageSpeaker(guild);

    const player = voiceApi.getGuildPlayer(guild.id);
    if (player.state.status === AudioPlayerStatus.Idle) {
      player.play(voiceApi.createFfmpegAudioResource(guild.id));
    }

    return;
  }

  const connection = await voiceApi.establishVoiceConnection(channel);
  const player = voiceApi.getGuildPlayer(guild.id);
  const resource = voiceApi.createFfmpegAudioResource(guild.id);

  connection.subscribe(player);
  player.play(resource);
  voiceApi.voiceConnections.set(guild.id, connection);

  await ensureStageInstance(guild, channel, stageTitle);
  await ensureStageSpeaker(guild);

  console.log(`Stage 24/7: joined ${channel.name} and started streaming`);
}

export async function stopStage247(client, deps) {
  const guild = await client.guilds.fetch(TARGET_GUILD_ID).catch(() => null);
  if (!guild) return;

  await endStageInstance(guild);
  deps.safeDestroyGuildVoice(guild.id);
  console.log('Stage 24/7: stopped stage and left voice channel');
}

export function scheduleStage247Recovery(client, deps) {
  if (!isStage247Configured() || !STAGE_247_ENABLED) {
    return;
  }

  if (recoveryTimer) {
    clearTimeout(recoveryTimer);
  }

  recoveryTimer = setTimeout(async () => {
    recoveryTimer = null;

    if (!STAGE_247_ENABLED || recoveryInProgress) {
      return;
    }

    recoveryInProgress = true;

    try {
      await startStage247(client, deps);
    } catch (error) {
      console.error('Stage 24/7 recovery failed:', error);
      scheduleStage247Recovery(client, deps);
    } finally {
      recoveryInProgress = false;
    }
  }, RECOVERY_DELAY_MS);
}

export function handleBotVoiceStateUpdate(oldState, newState, client, deps) {
  if (!STAGE_247_ENABLED || newState.guild.id !== TARGET_GUILD_ID) {
    return;
  }

  if (newState.member.id !== client.user.id) {
    return;
  }

  const leftStage = oldState.channelId === STAGE_CHANNEL_ID
    && newState.channelId !== STAGE_CHANNEL_ID;
  const disconnected = oldState.channelId === STAGE_CHANNEL_ID && !newState.channelId;
  const movedWithinStage = newState.channelId === STAGE_CHANNEL_ID
    && oldState.channelId
    && oldState.channelId !== STAGE_CHANNEL_ID;
  const suppressedOnStage = newState.channelId === STAGE_CHANNEL_ID && newState.suppress;

  if (leftStage || disconnected || movedWithinStage) {
    scheduleStage247Recovery(client, deps);
    return;
  }

  if (suppressedOnStage) {
    newState.setSuppressed(false).catch((error) => {
      console.error('Stage 24/7: failed to unsuppress bot:', error);
    });
  }
}

export function bindStage247ConnectionHandlers(connection, client, deps) {
  if (!isStage247Active(connection.joinConfig.guildId)) {
    return;
  }

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    if (STAGE_247_ENABLED) {
      scheduleStage247Recovery(client, deps);
    }
  });
}

export async function toggleStage247(client, deps, enabled) {
  setStage247Enabled(enabled);
  await setEnvPersist('STAGE_247_ENABLED', enabled ? 'true' : 'false');

  if (enabled) {
    await startStage247(client, deps);
    return 'enabled';
  }

  await stopStage247(client, deps);
  return 'disabled';
}

export async function updateStageTitle(client, deps, title) {
  const trimmed = title.trim().slice(0, 120);
  if (!trimmed) {
    throw new Error('Stage title cannot be empty.');
  }

  setStageTitle(trimmed);
  await setEnvPersist('STAGE_TITLE', trimmed);

  const guild = await client.guilds.fetch(TARGET_GUILD_ID).catch(() => null);
  if (!guild || !STAGE_CHANNEL_ID) {
    return trimmed;
  }

  const channel = await guild.channels.fetch(STAGE_CHANNEL_ID).catch(() => null);
  if (channel?.type === ChannelType.GuildStageVoice) {
    await ensureStageInstance(guild, channel, trimmed);
  }

  return trimmed;
}
