#!/usr/bin/env node
/**
 * Interactive Discord ↔ site role mapper.
 * Updates only role-related keys in the current .env file.
 *
 * Site usergroups are built in (from rebootradio.uk usergroups table).
 * Optional SITE_DB_* loads live usernames; otherwise users come from searchCommunity API.
 */

import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { REST, Routes } from 'discord.js';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const ROLE_ENV_KEYS = [
  'LINKED_ROLE_MAP_JSON',
  'FEATURE_ROLE_MAP_JSON',
  'STAFF_ROLE_ID',
  'MEMBER_ROLE_ID',
];

/** rebootradio.uk `usergroups` table (id, name) */
const SITE_USERGROUPS = [
  { id: -2, name: 'Former' },
  { id: -1, name: 'Pending' },
  { id: 0, name: 'Staff' },
  { id: 1, name: 'Community Moderator' },
  { id: 2, name: 'Graphic Designer' },
  { id: 3, name: 'Station Presenter' },
  { id: 4, name: 'Station Mentor' },
  { id: 5, name: 'Community Manager' },
  { id: 6, name: 'Station Manager' },
  { id: 7, name: 'Developer' },
  { id: 9, name: 'Admin' },
  { id: 10, name: 'Leadership' },
  { id: 11, name: 'Owner' },
  { id: 12, name: 'Its Time.....' },
  { id: 13, name: 'Rebot' },
];

const DEFAULT_FEATURES = [{ slug: 'radio_visualizer', name: 'Radio Visualizer' }];

function parseJsonEnv(raw, fallback = {}) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function loadEnvFile() {
  try {
    return await fs.readFile(ENV_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`No .env file found at ${ENV_PATH}`);
    }
    throw error;
  }
}

async function updateEnvFile(updates) {
  let content = await loadEnvFile();

  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      if (!content.endsWith('\n')) {
        content += '\n';
      }
      content += `${line}\n`;
    }
  }

  await fs.writeFile(ENV_PATH, content, 'utf8');
}

async function fetchDiscordRoles(token, guildId) {
  const rest = new REST({ version: '10' }).setToken(token);
  const roles = await rest.get(Routes.guildRoles(guildId));
  return roles
    .map((role) => ({
      id: role.id,
      name: role.name,
      position: role.position,
    }))
    .sort((a, b) => b.position - a.position);
}

async function fetchSiteViaDb() {
  const host = process.env.SITE_DB_HOST;
  const user = process.env.SITE_DB_USER;
  const password = process.env.SITE_DB_PASSWORD;
  const database = process.env.SITE_DB_NAME;

  if (!host || !user || !database) {
    return null;
  }

  let mysql;
  try {
    mysql = await import('mysql2/promise');
  } catch {
    console.warn('mysql2 is not installed — run: npm install mysql2');
    return null;
  }

  const connection = await mysql.createConnection({
    host,
    user,
    password: password ?? '',
    database,
  });

  try {
    const [groups] = await connection.query(
      'SELECT id, name FROM usergroups ORDER BY id ASC',
    );
    const [users] = await connection.query(
      `SELECT id, username, roles, discord_id
       FROM users
       WHERE username IS NOT NULL AND username != ''
       ORDER BY username ASC`,
    );
    const [features] = await connection.query(
      'SELECT slug, name FROM features ORDER BY sort_order ASC, name ASC',
    );

    return {
      groups: groups.map((row) => ({ id: Number(row.id), name: String(row.name) })),
      users: users.map((row) => ({
        id: Number(row.id),
        username: String(row.username),
        roles: String(row.roles ?? ''),
        discordId: row.discord_id ? String(row.discord_id) : '',
      })),
      features: features.map((row) => ({
        slug: String(row.slug),
        name: String(row.name),
      })),
    };
  } finally {
    await connection.end();
  }
}

async function fetchSiteUsersViaApi(siteBaseUrl) {
  const base = siteBaseUrl.replace(/\/$/, '');
  const users = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 50) {
    const url = `${base}/api/searchCommunity?p=${page}&perPage=48&sort=name`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    const body = await response.text();
    const payload = JSON.parse(body.slice(body.indexOf('{')));

    if (!payload?.users) {
      break;
    }

    totalPages = Number(payload.totalPages || 1);

    for (const user of payload.users) {
      users.push({
        id: user.id,
        username: user.username,
        roles: user.role ? String(user.role.id) : '',
        roleLabel: user.role?.label ?? 'Member',
        discordId: '',
      });
    }

    page += 1;
  }

  return users;
}

async function fetchSiteWithoutDb(siteBaseUrl) {
  const users = await fetchSiteUsersViaApi(siteBaseUrl);
  return {
    groups: SITE_USERGROUPS,
    users,
    features: DEFAULT_FEATURES,
  };
}

function printDiscordRoles(roles) {
  console.log('\n=== Discord roles (main guild) ===');
  roles.forEach((role, index) => {
    console.log(`${index + 1}. ${role.name} (${role.id})`);
  });
}

function printSiteGroups(groups) {
  console.log('\n=== Site role groups ===');
  for (const group of groups) {
    let note = group.id === 0 ? ' → saved as STAFF_ROLE_ID' : ' → saved in LINKED_ROLE_MAP_JSON';
    if (group.id === -2 || group.id === -1) {
      note += ' (usually skip — not a Discord role)';
    }
    console.log(`${group.id}. ${group.name}${note}`);
  }
}

function printSiteUsers(users) {
  console.log('\n=== Site users ===');
  const linked = users.filter((user) => user.discordId);
  console.log(`Total users loaded: ${users.length} (${linked.length} with Discord linked)`);
  const sample = users.slice(0, 40);
  for (const user of sample) {
    const discord = user.discordId ? `discord:${user.discordId}` : 'discord:not linked';
    const roles = user.roles || user.roleLabel || '—';
    console.log(`- ${user.username} — roles: ${roles} — ${discord}`);
  }
  if (users.length > sample.length) {
    console.log(`… and ${users.length - sample.length} more`);
  }
}

function resolveDiscordRoleChoice(raw, discordRoles) {
  const value = String(raw ?? '').trim();
  if (!value || /^s(kip)?$/i.test(value)) {
    return null;
  }

  if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= discordRoles.length) {
    return discordRoles[Number(value) - 1].id;
  }

  if (/^\d{17,20}$/.test(value)) {
    return value;
  }

  const byName = discordRoles.find(
    (role) => role.name.toLowerCase() === value.toLowerCase(),
  );
  return byName?.id ?? null;
}

async function ask(rl, question) {
  const answer = await rl.question(question);
  return String(answer).trim();
}

async function mapSiteRoles(rl, siteGroups, discordRoles) {
  const linkedRoleMap = {};
  let staffRoleId = process.env.STAFF_ROLE_ID || '';

  for (const group of siteGroups) {
    const prompt = group.id === 0
      ? `\nSite role 0 "${group.name}" (staff) → Discord role [#, id, name, skip]: `
      : `\nSite role ${group.id} "${group.name}" → Discord role [#, id, name, skip]: `;

    const answer = await ask(rl, prompt);
    const discordRoleId = resolveDiscordRoleChoice(answer, discordRoles);
    if (!discordRoleId) {
      console.log('  skipped');
      continue;
    }

    if (group.id === 0) {
      staffRoleId = discordRoleId;
      console.log(`  STAFF_ROLE_ID=${discordRoleId}`);
    } else {
      linkedRoleMap[String(group.id)] = discordRoleId;
      console.log(`  LINKED_ROLE_MAP_JSON["${group.id}"]=${discordRoleId}`);
    }
  }

  return { linkedRoleMap, staffRoleId };
}

async function mapMemberRole(rl, discordRoles) {
  const answer = await ask(
    rl,
    '\nDiscord role for all verified linked members (MEMBER_ROLE_ID) [#, id, name, skip]: ',
  );
  return resolveDiscordRoleChoice(answer, discordRoles) || process.env.MEMBER_ROLE_ID || '';
}

async function mapFeatureRoles(rl, features, discordRoles) {
  const featureRoleMap = parseJsonEnv(process.env.FEATURE_ROLE_MAP_JSON, {});

  for (const feature of features) {
    const answer = await ask(
      rl,
      `\nFeature "${feature.slug}" (${feature.name}) → Discord role [#, id, name, skip]: `,
    );
    const discordRoleId = resolveDiscordRoleChoice(answer, discordRoles);
    if (!discordRoleId) {
      console.log('  skipped');
      continue;
    }
    featureRoleMap[feature.slug] = discordRoleId;
    console.log(`  FEATURE_ROLE_MAP_JSON["${feature.slug}"]=${discordRoleId}`);
  }

  return featureRoleMap;
}

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const guildId = process.env.TARGET_GUILD_ID || '1470711513097568389';
  const siteBaseUrl = process.env.SITE_BASE_URL || 'https://rebootradio.uk/v3';

  if (!token) {
    throw new Error('DISCORD_TOKEN is missing from .env');
  }

  console.log(`Using guild ${guildId}`);
  console.log(`Using site ${siteBaseUrl}`);
  console.log(`Will update only: ${ROLE_ENV_KEYS.join(', ')}`);

  const discordRoles = await fetchDiscordRoles(token, guildId);
  printDiscordRoles(discordRoles);

  let siteData = await fetchSiteViaDb();
  if (siteData) {
    console.log('\nLoaded site users from database (SITE_DB_*). Roles use built-in usergroups list.');
    siteData.groups = SITE_USERGROUPS;
  } else {
    console.log('\nUsing built-in usergroups list; loading site users via searchCommunity API.');
    siteData = await fetchSiteWithoutDb(siteBaseUrl);
  }

  printSiteGroups(siteData.groups);
  printSiteUsers(siteData.users);

  const rl = createInterface({ input, output });

  try {
    const { linkedRoleMap, staffRoleId } = await mapSiteRoles(rl, siteData.groups, discordRoles);
    const memberRoleId = await mapMemberRole(rl, discordRoles);
    const featureRoleMap = await mapFeatureRoles(rl, siteData.features, discordRoles);

    const updates = {
      LINKED_ROLE_MAP_JSON: JSON.stringify(linkedRoleMap),
      FEATURE_ROLE_MAP_JSON: JSON.stringify(featureRoleMap),
      STAFF_ROLE_ID: staffRoleId,
      MEMBER_ROLE_ID: memberRoleId,
    };

    console.log('\nSaving to .env:');
    for (const [key, value] of Object.entries(updates)) {
      console.log(`${key}=${value}`);
    }

    const confirm = await ask(rl, '\nWrite these values to .env? [Y/n]: ');
    if (confirm && !/^y(es)?$/i.test(confirm)) {
      console.log('Cancelled — .env not changed.');
      return;
    }

    await updateEnvFile(updates);
    console.log(`\nUpdated ${ENV_PATH}`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
