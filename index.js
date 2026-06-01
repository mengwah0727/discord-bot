import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

const APPLE_GREEN = '#34C759';
const UTC_PLUS_8_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2_147_483_647;

const requiredEnvVars = ['DISCORD_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(name => !process.env[name]);

if (missingEnvVars.length) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_PATH = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const adapter = new JSONFile(DB_PATH);
const db = new Low(adapter, {
  scheduledMessages: [],
  weeklySchedules: [],
  giveaways: [],
  teamPosts: [],
  tempVoiceConfig: {},
  tempVoiceChannels: []
});

await db.read();

if (!db.data) {
  db.data = {
    scheduledMessages: [],
    weeklySchedules: [],
    giveaways: [],
    teamPosts: [],
    tempVoiceConfig: {},
    tempVoiceChannels: []
  };
} else {
  db.data.scheduledMessages ||= [];
  db.data.weeklySchedules ||= [];
  db.data.giveaways ||= [];
  db.data.teamPosts ||= [];
  db.data.tempVoiceConfig ||= {};
  db.data.tempVoiceChannels ||= [];
}

await db.write();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const scheduleTimers = new Map();
const weeklyTimers = new Map();
const giveawayTimers = new Map();
const teamReminderTimers = new Map();

const dayMap = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const ADMIN_ONLY_COMMANDS = new Set([
  'send',
  'schedule',
  'schedule-weekly',
  'schedule-list',
  'schedule-delete',
  'tempvoice-set',
  'tempvoice-disable',
  'giveaway-start',
  'giveaway-end',
  'giveaway-reroll',
  'giveaway-participants'
]);

function parseDuration(input) {
  if (!input) return null;

  const text = input.trim().toLowerCase().replace(/\s+/g, '');
  const regex = /(\d+)(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/g;

  let total = 0;
  let matchFound = false;

  let consumed = '';

  for (const match of text.matchAll(regex)) {
    matchFound = true;
    consumed += match[0];
    const value = Number(match[1]);
    const unit = match[2];

    if (['d', 'day', 'days'].includes(unit)) {
      total += value * 24 * 60 * 60 * 1000;
    } else if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(unit)) {
      total += value * 60 * 60 * 1000;
    } else if (['m', 'min', 'mins', 'minute', 'minutes'].includes(unit)) {
      total += value * 60 * 1000;
    }
  }

  if (!matchFound || consumed !== text || total <= 0) return null;
  return total;
}

function parseTime(input) {
  const match = input.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function normalizeMessage(text) {
  return String(text).replace(/\\n/g, '\n');
}

function toUtc8Date(date = new Date()) {
  return new Date(date.getTime() + UTC_PLUS_8_OFFSET_MS);
}

function fromUtc8ToUtc(dateUtc8) {
  return new Date(dateUtc8.getTime() - UTC_PLUS_8_OFFSET_MS);
}

function getNextWeeklyRun(day, time) {
  const targetDay = dayMap[day];
  if (targetDay === undefined) return null;

  const parsed = parseTime(time);
  if (!parsed) return null;

  const nowUtc8 = toUtc8Date(new Date());

  const currentDay = nowUtc8.getUTCDay();
  const currentMinutes = nowUtc8.getUTCHours() * 60 + nowUtc8.getUTCMinutes();
  const targetMinutes = parsed.hour * 60 + parsed.minute;

  let diff = targetDay - currentDay;
  if (diff < 0) diff += 7;
  if (diff === 0 && targetMinutes <= currentMinutes) diff = 7;

  const nextUtc8 = new Date(nowUtc8);
  nextUtc8.setUTCDate(nowUtc8.getUTCDate() + diff);
  nextUtc8.setUTCHours(parsed.hour, parsed.minute, 0, 0);

  return fromUtc8ToUtc(nextUtc8);
}

function pickRandom(arr, count) {
  const copy = [...arr];
  const result = [];

  while (copy.length && result.length < count) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }

  return result;
}

function sanitizeChannelName(name) {
  const cleaned = name.replace(/[\\/:*?"<>|#@]/g, '').trim();
  return cleaned || 'Temporary Room';
}

function tempVoiceControlRows(channelId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tempvoice_rename_${channelId}`)
        .setLabel('改名')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tempvoice_limit_${channelId}`)
        .setLabel('限人数')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tempvoice_lock_${channelId}`)
        .setLabel('锁房')
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tempvoice_unlock_${channelId}`)
        .setLabel('解锁')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tempvoice_delete_${channelId}`)
        .setLabel('删除房间')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function formatRelativeEnds(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:R> (<t:${Math.floor(date.getTime() / 1000)}:F>)`;
}

function giveawayButtonRow(giveawayId, ended = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_join_${giveawayId}`)
      .setLabel('Join Giveaway')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(ended)
  );
}

function buildGiveawayEmbed(giveaway, hostUserId, entryCountOverride = null) {
  const entryCount = entryCountOverride ?? (giveaway.entries?.length || 0);
  const endsAt = new Date(giveaway.endsAt);

  const parts = [giveaway.prize, ''];

  if (giveaway.description?.trim()) {
    parts.push(normalizeMessage(giveaway.description));
    parts.push('');
  }

  parts.push(`Ends: ${formatRelativeEnds(endsAt)}`);
  parts.push(`Hosted by: <@${hostUserId}>`);
  parts.push(`Entries: ${entryCount}`);
  parts.push(`Winners: ${giveaway.winnerCount}`);

  return new EmbedBuilder()
    .setColor(APPLE_GREEN)
    .setDescription(parts.join('\n'))
    .setTimestamp();
}

const TEAM_ROLE_LABELS = {
  dps: '輸出',
  tank: '坦克',
  healer: '奶媽'
};

const TEAM_ROLE_EMOJIS = {
  dps: '⚔️',
  tank: '🛡️',
  healer: '💚'
};

function normalizeTeamPlayer(player) {
  if (typeof player === 'string') {
    return { userId: player, role: 'dps' };
  }

  return {
    userId: player.userId,
    role: player.role || 'dps'
  };
}

function parseTeamStartTime(input) {
  if (!input?.trim()) return null;

  const text = input.trim();
  let year;
  let month;
  let day;
  let hour;
  let minute;

  let match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const nowUtc8 = toUtc8Date(new Date());
    year = nowUtc8.getUTCFullYear();
    month = nowUtc8.getUTCMonth() + 1;
    day = nowUtc8.getUTCDate();
    hour = Number(match[1]);
    minute = Number(match[2]);
  } else {
    match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
      hour = Number(match[4]);
      minute = Number(match[5]);
    } else {
      match = text.match(/^(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
      if (!match) return null;

      year = toUtc8Date(new Date()).getUTCFullYear();
      month = Number(match[1]);
      day = Number(match[2]);
      hour = Number(match[3]);
      minute = Number(match[4]);
    }
  }

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  let utc8Date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  if (
    utc8Date.getUTCFullYear() !== year ||
    utc8Date.getUTCMonth() !== month - 1 ||
    utc8Date.getUTCDate() !== day ||
    utc8Date.getUTCHours() !== hour ||
    utc8Date.getUTCMinutes() !== minute
  ) {
    return null;
  }

  let startAt = fromUtc8ToUtc(utc8Date);

  if (/^\d{1,2}:\d{2}$/.test(text) && startAt.getTime() <= Date.now()) {
    utc8Date.setUTCDate(utc8Date.getUTCDate() + 1);
    startAt = fromUtc8ToUtc(utc8Date);
  }

  if (startAt.getTime() <= Date.now()) return null;
  return startAt;
}

function formatDiscordTimestamp(dateOrIso, style = 'F') {
  const date = new Date(dateOrIso);
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function normalizeTeamCollections(team) {
  team.players ||= [];
  team.waitlist ||= [];
  team.players = team.players.map(normalizeTeamPlayer);
  team.waitlist = team.waitlist.map(normalizeTeamPlayer);
}

function teamButtonRows(teamId, closed = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`team_role_dps_${teamId}`)
        .setLabel('輸出')
        .setEmoji('⚔️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed),
      new ButtonBuilder()
        .setCustomId(`team_role_tank_${teamId}`)
        .setLabel('坦克')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed),
      new ButtonBuilder()
        .setCustomId(`team_role_healer_${teamId}`)
        .setLabel('奶媽')
        .setEmoji('💚')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`team_leave_${teamId}`)
        .setLabel('退出')
        .setEmoji('🚪')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed),
      new ButtonBuilder()
        .setCustomId(`team_remind_${teamId}`)
        .setLabel('提醒')
        .setEmoji('🔔')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false),
      new ButtonBuilder()
        .setCustomId(`team_delete_${teamId}`)
        .setLabel('刪除')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(false)
    )
  ];
}

function buildTeamEmbed(team) {
  normalizeTeamCollections(team);
  const players = team.players;
  const waitlist = team.waitlist;

  const dpsPlayers = players.filter(p => p.role === 'dps');
  const tankPlayers = players.filter(p => p.role === 'tank');
  const healerPlayers = players.filter(p => p.role === 'healer');

  const lines = [
    `**人數：** ${players.length}/${team.maxPlayers}`,
    `**候補：** ${waitlist.length}`,
    ''
  ];

  if (team.startAt) {
    lines.push(`**開始時間：** ${formatDiscordTimestamp(team.startAt)} (${formatDiscordTimestamp(team.startAt, 'R')})`);
    lines.push('');
  }

  if (team.description?.trim()) {
    lines.push(normalizeMessage(team.description));
    lines.push('');
  }

  lines.push(`**創建者：** <@${team.createdBy}>`);
  lines.push('');
  lines.push('**參與名單：**');
  lines.push('');

  lines.push('⚔️ **輸出**');
  if (dpsPlayers.length) {
    dpsPlayers.forEach((player, index) => {
      lines.push(`${index + 1}. <@${player.userId}>`);
    });
  } else {
    lines.push('目前沒有人');
  }

  lines.push('');
  lines.push('🛡️ **坦克**');
  if (tankPlayers.length) {
    tankPlayers.forEach((player, index) => {
      lines.push(`${index + 1}. <@${player.userId}>`);
    });
  } else {
    lines.push('目前沒有人');
  }

  lines.push('');
  lines.push('💚 **奶媽**');
  if (healerPlayers.length) {
    healerPlayers.forEach((player, index) => {
      lines.push(`${index + 1}. <@${player.userId}>`);
    });
  } else {
    lines.push('目前沒有人');
  }

  lines.push('');
  lines.push('📌 **候補**');
  if (waitlist.length) {
    waitlist.forEach((player, index) => {
      const emoji = TEAM_ROLE_EMOJIS[player.role] || '✅';
      const label = TEAM_ROLE_LABELS[player.role] || '隊員';
      lines.push(`${index + 1}. ${emoji} ${label} - <@${player.userId}>`);
    });
  } else {
    lines.push('目前沒有人');
  }

  return new EmbedBuilder()
    .setColor(APPLE_GREEN)
    .setTitle(team.title)
    .setDescription(lines.join('\n'))
    .setFooter({ text: team.closed ? '報名已關閉' : '點擊職業按鈕加入、切換職業或退出' })
    .setTimestamp();
}

async function saveDb() {
  await db.write();
}

function scheduleLongTimeout(callback, delay) {
  if (delay <= MAX_TIMEOUT_MS) {
    return setTimeout(callback, delay);
  }

  const timer = {
    timeout: null,
    clear() {
      if (this.timeout) clearTimeout(this.timeout);
    }
  };

  const tick = () => {
    delay -= MAX_TIMEOUT_MS;

    if (delay <= MAX_TIMEOUT_MS) {
      timer.timeout = setTimeout(callback, delay);
      return;
    }

    timer.timeout = setTimeout(tick, MAX_TIMEOUT_MS);
  };

  timer.timeout = setTimeout(tick, MAX_TIMEOUT_MS);
  return timer;
}

function clearScheduledTimer(timer) {
  if (!timer) return;

  if (typeof timer.clear === 'function') {
    timer.clear();
    return;
  }

  clearTimeout(timer);
}

async function sendScheduledMessage(item) {
  try {
    const channel = await client.channels.fetch(item.channelId);
    if (!channel || !channel.isTextBased()) return;

    await channel.send(normalizeMessage(item.message));

    db.data.scheduledMessages = db.data.scheduledMessages.filter(x => x.id !== item.id);
    await saveDb();
    scheduleTimers.delete(item.id);
  } catch (err) {
    console.error('发送定时消息失败:', err);
  }
}

function scheduleMessageJob(item) {
  const delay = new Date(item.sendAt).getTime() - Date.now();

  if (delay <= 0) {
    sendScheduledMessage(item);
    return;
  }

  const timer = scheduleLongTimeout(() => sendScheduledMessage(item), delay);
  scheduleTimers.set(item.id, timer);
}

async function sendWeeklyMessage(item) {
  try {
    const channel = await client.channels.fetch(item.channelId);
    if (channel && channel.isTextBased()) {
      await channel.send(normalizeMessage(item.message));
    }
  } catch (err) {
    console.error('发送每周公告失败:', err);
  } finally {
    scheduleWeeklyJob(item);
  }
}

function scheduleWeeklyJob(item) {
  if (weeklyTimers.has(item.id)) {
    clearScheduledTimer(weeklyTimers.get(item.id));
    weeklyTimers.delete(item.id);
  }

  const nextRun = getNextWeeklyRun(item.day, item.time);
  if (!nextRun) return;

  item.nextRunAt = nextRun.toISOString();
  saveDb().catch(console.error);

  const delay = nextRun.getTime() - Date.now();
  const timer = scheduleLongTimeout(() => sendWeeklyMessage(item), delay);
  weeklyTimers.set(item.id, timer);
}

async function fetchGiveawayParticipants(giveaway) {
  const entryIds = giveaway.entries || [];
  const users = [];

  for (const id of entryIds) {
    try {
      const user = await client.users.fetch(id);
      if (!user.bot) {
        users.push({ id: user.id, username: user.username });
      }
    } catch {
      // ignore invalid user
    }
  }

  return users;
}

async function refreshGiveawayMessage(giveaway) {
  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(giveaway.messageId);
    const embed = buildGiveawayEmbed(giveaway, giveaway.createdBy, giveaway.entries?.length || 0);

    await message.edit({
      embeds: [embed],
      components: [giveawayButtonRow(giveaway.id, giveaway.ended)]
    });
  } catch (error) {
    console.error('更新抽奖消息失败:', error);
  }
}

async function endGiveaway(giveawayId, reroll = false, rerollCount = null) {
  const giveaway = db.data.giveaways.find(g => g.id === giveawayId);
  if (!giveaway) return;
  if (giveaway.ended && !reroll) return;

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(giveaway.messageId);
    const participants = await fetchGiveawayParticipants(giveaway);

    const winnerCount = rerollCount || giveaway.winnerCount;
    const winners = pickRandom(participants, winnerCount);

    giveaway.ended = true;
    giveaway.endedAt = new Date().toISOString();
    giveaway.participantCount = participants.length;
    giveaway.winnerIds = winners.map(w => w.id);
    await saveDb();

    await message.edit({
      embeds: [buildGiveawayEmbed(giveaway, giveaway.createdBy, participants.length)],
      components: [giveawayButtonRow(giveaway.id, true)]
    });

    const winnerMentions = winners.length
      ? winners.map(w => `<@${w.id}>`).join(', ')
      : '没有有效参与者';

    const resultText = reroll
      ? `🎉 **抽奖重抽结果**\n奖品：**${giveaway.prize}**\n中奖者：${winnerMentions}\n参与人数：${participants.length}`
      : `🎉 **抽奖结束**\n奖品：**${giveaway.prize}**\n中奖者：${winnerMentions}\n参与人数：${participants.length}`;

    await message.reply({ content: resultText });

    for (const winner of winners) {
      try {
        const user = await client.users.fetch(winner.id);
        await user.send(
          `🎉 恭喜你中奖了！\n奖品：**${giveaway.prize}**\n抽奖链接：${message.url}`
        );
      } catch {
        // ignore DM failure
      }
    }

    giveawayTimers.delete(giveaway.id);
  } catch (err) {
    console.error('结束抽奖失败:', err);
  }
}

function scheduleGiveawayEnd(giveaway) {
  const delay = new Date(giveaway.endsAt).getTime() - Date.now();

  if (delay <= 0) {
    endGiveaway(giveaway.id);
    return;
  }

  const timer = scheduleLongTimeout(() => endGiveaway(giveaway.id), delay);
  giveawayTimers.set(giveaway.id, timer);
}

async function refreshTeamMessage(team) {
  try {
    const channel = await client.channels.fetch(team.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(team.messageId);
    await message.edit({
      embeds: [buildTeamEmbed(team)],
      components: teamButtonRows(team.id, team.closed)
    });
  } catch (error) {
    console.error('更新组队消息失败:', error);
  }
}

async function sendTeamReminder(team, manual = false) {
  try {
    normalizeTeamCollections(team);

    const channel = await client.channels.fetch(team.channelId);
    if (!channel || !channel.isTextBased()) return false;

    const mentions = [...team.players, ...team.waitlist]
      .map(player => `<@${player.userId}>`)
      .join(' ');

    if (!mentions) return false;

    const startText = team.startAt
      ? `\n開始時間：${formatDiscordTimestamp(team.startAt)} (${formatDiscordTimestamp(team.startAt, 'R')})`
      : '';
    const waitlistText = team.waitlist.length ? `\n候補人數：${team.waitlist.length}` : '';
    const reasonText = manual ? '上線提醒' : '自動提醒';

    await channel.send({
      content: `🔔 **${reasonText}：${team.title}**\n${mentions}${startText}\n目前人數：${team.players.length}/${team.maxPlayers}${waitlistText}`
    });

    if (!manual) {
      team.reminderSentAt = new Date().toISOString();
      await saveDb();
    }

    return true;
  } catch (error) {
    console.error('发送组队提醒失败:', error);
    return false;
  }
}

function scheduleTeamReminder(team) {
  if (teamReminderTimers.has(team.id)) {
    clearScheduledTimer(teamReminderTimers.get(team.id));
    teamReminderTimers.delete(team.id);
  }

  if (!team.startAt || team.reminderSentAt || team.closed) return;

  const startAt = new Date(team.startAt).getTime();
  if (!Number.isFinite(startAt) || startAt <= Date.now()) return;

  const reminderAt = Math.max(Date.now() + 1000, startAt - 30 * 60 * 1000);
  const delay = reminderAt - Date.now();
  const timer = scheduleLongTimeout(async () => {
    await sendTeamReminder(team, false);
    teamReminderTimers.delete(team.id);
  }, delay);

  teamReminderTimers.set(team.id, timer);
}

function promoteWaitlistIfPossible(team) {
  normalizeTeamCollections(team);
  const promoted = [];

  while (team.players.length < team.maxPlayers && team.waitlist.length) {
    const next = team.waitlist.shift();
    if (team.players.some(player => player.userId === next.userId)) continue;

    team.players.push(next);
    promoted.push(next);
  }

  return promoted;
}

async function deleteTeamPost(team) {
  try {
    const channel = await client.channels.fetch(team.channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages.fetch(team.messageId).catch(() => null);
      if (message) {
        await message.delete().catch(() => {});
      }
    }
  } catch (error) {
    console.error('删除组队消息失败:', error);
  }

  db.data.teamPosts = db.data.teamPosts.filter(t => t.id !== team.id);
  if (teamReminderTimers.has(team.id)) {
    clearScheduledTimer(teamReminderTimers.get(team.id));
    teamReminderTimers.delete(team.id);
  }
  await saveDb();
}

async function deleteTempVoiceChannelNow(channel) {
  try {
    const freshChannel = await client.channels.fetch(channel.id).catch(() => null);

    if (!freshChannel || freshChannel.type !== ChannelType.GuildVoice) {
      db.data.tempVoiceChannels = db.data.tempVoiceChannels.filter(x => x.channelId !== channel.id);
      await saveDb();
      return;
    }

    if (freshChannel.members.size > 0) return;

    await freshChannel.delete('临时语音频道无人自动删除');

    db.data.tempVoiceChannels = db.data.tempVoiceChannels.filter(x => x.channelId !== channel.id);
    await saveDb();
  } catch (error) {
    console.error('删除临时语音频道失败:', error);
  }
}

async function getTempVoiceControlContext(interaction, channelId) {
  const tracked = db.data.tempVoiceChannels.find(x => x.channelId === channelId);
  if (!tracked) {
    return { error: '找不到这个临时语音房记录，可能已经被删除。' };
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    db.data.tempVoiceChannels = db.data.tempVoiceChannels.filter(x => x.channelId !== channelId);
    await saveDb();
    return { error: '这个临时语音房已经不存在。' };
  }

  let isAdmin = false;
  const guild = channel.guild;
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (member) {
    isAdmin = member.permissions.has(PermissionFlagsBits.ManageGuild);
  }

  if (tracked.creatorId !== interaction.user.id && !isAdmin) {
    return { error: '只有房主或管理员可以控制这个语音房。' };
  }

  return { tracked, channel, member, isAdmin };
}

async function replyTempVoiceControl(interaction, content) {
  await interaction.reply({
    content,
    ephemeral: interaction.inGuild()
  });
}

async function sendTempVoiceControlPanel(member, channel) {
  try {
    await member.send({
      content: `你的临时语音房已创建：**${channel.name}**\n使用下面按钮控制房间。`,
      components: tempVoiceControlRows(channel.id)
    });
  } catch {
    // ignore closed DMs
  }
}

async function createTempVoiceChannelFor(member, joinChannel) {
  const guild = member.guild;
  const parentId = joinChannel.parentId || null;
  const channelName = `${sanitizeChannelName(member.displayName)} 的房间`;

  const newChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildVoice,
    parent: parentId
  });

  db.data.tempVoiceChannels.push({
    guildId: guild.id,
    channelId: newChannel.id,
    creatorId: member.id,
    createdAt: new Date().toISOString()
  });
  await saveDb();

  let moved = true;
  await member.voice.setChannel(newChannel).catch(async error => {
    moved = false;
    console.error('移动用户到临时语音频道失败:', error);

    db.data.tempVoiceChannels = db.data.tempVoiceChannels.filter(x => x.channelId !== newChannel.id);
    await saveDb();
    await newChannel.delete().catch(() => {});
  });

  if (moved) {
    await sendTempVoiceControlPanel(member, newChannel);
  }
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Bot 已上线：${readyClient.user.tag}`);

  for (const item of db.data.scheduledMessages) {
    scheduleMessageJob(item);
  }

  for (const item of db.data.weeklySchedules) {
    scheduleWeeklyJob(item);
  }

  for (const g of db.data.giveaways.filter(x => !x.ended)) {
    scheduleGiveawayEnd(g);
  }

  for (const team of db.data.teamPosts.filter(x => !x.closed)) {
    normalizeTeamCollections(team);
    scheduleTeamReminder(team);
  }

  for (const temp of db.data.tempVoiceChannels) {
    const channel = await client.channels.fetch(temp.channelId).catch(() => null);

    if (!channel || channel.type !== ChannelType.GuildVoice) {
      db.data.tempVoiceChannels = db.data.tempVoiceChannels.filter(x => x.channelId !== temp.channelId);
      continue;
    }

    if (channel.members.size === 0) {
      await deleteTempVoiceChannelNow(channel);
    }
  }

  await saveDb();
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const guildId = newState.guild.id;
    const config = db.data.tempVoiceConfig[guildId];

    if (config?.joinChannelId && newState.channelId === config.joinChannelId) {
      const member = newState.member;
      const joinChannel = newState.channel;

      if (member?.user.bot || !joinChannel) return;

      await createTempVoiceChannelFor(member, joinChannel);
      return;
    }

    if (oldState.channelId) {
      const tracked = db.data.tempVoiceChannels.find(x => x.channelId === oldState.channelId);
      if (tracked) {
        const oldChannel = oldState.channel;
        if (oldChannel && oldChannel.members.size === 0) {
          await deleteTempVoiceChannelNow(oldChannel);
        }
      }
    }
  } catch (error) {
    console.error('处理临时语音频道事件失败:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    const needsAdmin = ADMIN_ONLY_COMMANDS.has(interaction.commandName);
    const hasPermission = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

    if (needsAdmin && !hasPermission) {
      await interaction.reply({
        content: '你需要有 Manage Server 权限才可以使用这个指令。',
        ephemeral: true
      });
      return;
    }

    try {
      if (interaction.commandName === 'send') {
        const channel = interaction.options.getChannel('channel', true);
        const text = interaction.options.getString('message', true);

        if (!channel.isTextBased()) {
          await interaction.reply({ content: '请选择文字频道。', ephemeral: true });
          return;
        }

        await channel.send(normalizeMessage(text));
        await interaction.reply({ content: '消息已发送。', ephemeral: true });
        return;
      }

      if (interaction.commandName === 'schedule') {
        const channel = interaction.channel;
        const text = interaction.options.getString('message', true);
        const delayText = interaction.options.getString('delay', true);

        if (!channel.isTextBased()) {
          await interaction.reply({ content: '请选择文字频道。', ephemeral: true });
          return;
        }

        const duration = parseDuration(delayText);

        if (!duration) {
          await interaction.reply({
            content: '时间格式错误，请使用 10m、2h、1d、1d2h30m 这种格式。',
            ephemeral: true
          });
          return;
        }

        const item = {
          id: crypto.randomUUID(),
          guildId: interaction.guildId,
          channelId: channel.id,
          message: text,
          sendAt: new Date(Date.now() + duration).toISOString(),
          createdBy: interaction.user.id,
          createdAt: new Date().toISOString()
        };

        db.data.scheduledMessages.push(item);
        await saveDb();
        scheduleMessageJob(item);

        await interaction.reply({
          content: `已设置一次性定时消息，将在 **${delayText}** 后发送。`,
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === 'schedule-weekly') {
        const channel = interaction.channel;
        const day = interaction.options.getString('day', true);
        const time = interaction.options.getString('time', true);
        const text = interaction.options.getString('message', true);

        if (!channel.isTextBased()) {
          await interaction.reply({ content: '请选择文字频道。', ephemeral: true });
          return;
        }

        if (!parseTime(time)) {
          await interaction.reply({
            content: '时间格式错误，请使用 24 小时制，例如 20:30',
            ephemeral: true
          });
          return;
        }

        const nextRun = getNextWeeklyRun(day, time);
        if (!nextRun) {
          await interaction.reply({
            content: '星期或时间格式错误。',
            ephemeral: true
          });
          return;
        }

        const item = {
          id: crypto.randomUUID(),
          guildId: interaction.guildId,
          channelId: channel.id,
          day,
          time,
          message: text,
          createdBy: interaction.user.id,
          createdAt: new Date().toISOString(),
          nextRunAt: nextRun.toISOString()
        };

        db.data.weeklySchedules.push(item);
        await saveDb();
        scheduleWeeklyJob(item);

        await interaction.reply({
          content: `每周公告已创建。\nID：\`${item.id}\`\n频道：${channel}\n时间：**${day} ${time} (GMT+8)**\n下次发送：<t:${Math.floor(nextRun.getTime() / 1000)}:F>`,
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === 'schedule-list') {
        const items = db.data.weeklySchedules.filter(x => x.guildId === interaction.guildId);

        if (!items.length) {
          await interaction.reply({
            content: '目前没有固定公告。',
            ephemeral: true
          });
          return;
        }

        const lines = items.map(item => {
          const channelMention = `<#${item.channelId}>`;
          const nextRunText = item.nextRunAt
            ? `<t:${Math.floor(new Date(item.nextRunAt).getTime() / 1000)}:F>`
            : '未知';

          return `ID：\`${item.id}\`\n频道：${channelMention}\n时间：**${item.day} ${item.time} (GMT+8)**\n下次发送：${nextRunText}\n内容：${normalizeMessage(item.message)}`;
        });

        await interaction.reply({
          content: lines.join('\n\n-------------------\n\n').slice(0, 1900),
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === 'schedule-delete') {
        const id = interaction.options.getString('id', true);
        const item = db.data.weeklySchedules.find(
          x => x.id === id && x.guildId === interaction.guildId
        );

        if (!item) {
          await interaction.reply({
            content: '找不到这个固定公告 ID。',
            ephemeral: true
          });
          return;
        }

        db.data.weeklySchedules = db.data.weeklySchedules.filter(x => x.id !== id);
        await saveDb();

        if (weeklyTimers.has(id)) {
          clearScheduledTimer(weeklyTimers.get(id));
          weeklyTimers.delete(id);
        }

        await interaction.reply({
          content: `已删除固定公告：\`${id}\``,
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === 'tempvoice-set') {
        const channel = interaction.options.getChannel('channel', true);

        if (channel.type !== ChannelType.GuildVoice) {
          await interaction.reply({
            content: '请选择一个语音频道。',
            ephemeral: true
          });
          return;
        }

        db.data.tempVoiceConfig[interaction.guildId] = {
          joinChannelId: channel.id,
          updatedAt: new Date().toISOString(),
          updatedBy: interaction.user.id
        };
        await saveDb();

        await interaction.reply({
          content: `Join to Create 已开启。\n入口频道：${channel}\n用户进入这个频道后，bot 会自动创建临时语音频道。\n没人后会立即自动删除。`,
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === 'tempvoice-disable') {
        delete db.data.tempVoiceConfig[interaction.guildId];
        await saveDb();

        await interaction.reply({
          content: 'Join to Create 已关闭。',
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === 'giveaway-start') {
        const channel = interaction.channel;

        if (!channel.isTextBased()) {
          await interaction.reply({
            content: '请选择文字频道。',
            ephemeral: true
          });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`giveaway_create_${channel.id}`)
          .setTitle('Create a Giveaway');

        const durationInput = new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Duration')
          .setPlaceholder('Ex: 1d 2h 50m')
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        const winnersInput = new TextInputBuilder()
          .setCustomId('winners')
          .setLabel('Number of Winners')
          .setPlaceholder('1')
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        const prizeInput = new TextInputBuilder()
          .setCustomId('prize')
          .setLabel('Prize')
          .setPlaceholder('Steam Gift Card')
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        const descriptionInput = new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Description')
          .setPlaceholder('参加方式、领奖方式、规则...')
          .setRequired(false)
          .setStyle(TextInputStyle.Paragraph);

        modal.addComponents(
          new ActionRowBuilder().addComponents(durationInput),
          new ActionRowBuilder().addComponents(winnersInput),
          new ActionRowBuilder().addComponents(prizeInput),
          new ActionRowBuilder().addComponents(descriptionInput)
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.commandName === 'giveaway-end') {
        const messageId = interaction.options.getString('message_id', true);
        const giveaway = db.data.giveaways.find(g => g.messageId === messageId);

        if (!giveaway) {
          await interaction.reply({ content: '找不到这个抽奖。', ephemeral: true });
          return;
        }

        if (giveawayTimers.has(giveaway.id)) {
          clearScheduledTimer(giveawayTimers.get(giveaway.id));
          giveawayTimers.delete(giveaway.id);
        }

        await endGiveaway(giveaway.id);
        await interaction.reply({ content: '抽奖已手动结束。', ephemeral: true });
        return;
      }

      if (interaction.commandName === 'giveaway-reroll') {
        const messageId = interaction.options.getString('message_id', true);
        const rerollCount = interaction.options.getInteger('winners') || 1;
        const giveaway = db.data.giveaways.find(g => g.messageId === messageId);

        if (!giveaway) {
          await interaction.reply({ content: '找不到这个抽奖。', ephemeral: true });
          return;
        }

        giveaway.ended = false;
        await saveDb();
        await endGiveaway(giveaway.id, true, rerollCount);

        await interaction.reply({
          content: `已重抽 ${rerollCount} 位中奖者。`,
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === 'giveaway-participants') {
        const messageId = interaction.options.getString('message_id', true);
        const giveaway = db.data.giveaways.find(g => g.messageId === messageId);

        if (!giveaway) {
          await interaction.reply({ content: '找不到这个抽奖。', ephemeral: true });
          return;
        }

        const participants = await fetchGiveawayParticipants(giveaway);

        if (!participants.length) {
          await interaction.reply({
            content: '目前还没有参与者。',
            ephemeral: true
          });
          return;
        }

        const list = participants.slice(0, 50).map(p => `<@${p.id}>`).join('\n');

        await interaction.reply({
          content: `参与人数：**${participants.length}**\n${list}`,
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === 'team-create') {
        const channel = interaction.channel;
        const title = interaction.options.getString('title', true);
        const description = interaction.options.getString('description') || '';
        const maxPlayers = interaction.options.getInteger('max_players', true);
        const startTimeText = interaction.options.getString('start_time') || '';

        if (!channel.isTextBased()) {
          await interaction.reply({
            content: '请选择文字频道。',
            ephemeral: true
          });
          return;
        }

        const startAt = startTimeText ? parseTeamStartTime(startTimeText) : null;
        if (startTimeText && !startAt) {
          await interaction.reply({
            content: '开始时间格式错误，请使用 `21:30`、`05-29 21:30` 或 `2026-05-29 21:30`，而且时间必须在未来。',
            ephemeral: true
          });
          return;
        }

        const team = {
          id: crypto.randomUUID(),
          guildId: interaction.guildId,
          channelId: channel.id,
          messageId: '',
          title,
          description,
          maxPlayers,
          players: [],
          waitlist: [],
          closed: false,
          startAt: startAt?.toISOString() || null,
          reminderSentAt: null,
          createdBy: interaction.user.id,
          createdAt: new Date().toISOString()
        };

        const sentMessage = await channel.send({
          embeds: [buildTeamEmbed(team)],
          components: teamButtonRows(team.id, false)
        });

        team.messageId = sentMessage.id;
        db.data.teamPosts.push(team);
        await saveDb();
        scheduleTeamReminder(team);

        await interaction.reply({
          content: `组队招募已创建，消息 ID：\`${sentMessage.id}\``,
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === 'team-list') {
        const messageId = interaction.options.getString('message_id', true);
        const team = db.data.teamPosts.find(t => t.messageId === messageId);

        if (!team) {
          await interaction.reply({
            content: '找不到这个组队消息。',
            ephemeral: true
          });
          return;
        }

        normalizeTeamCollections(team);
        const players = team.players;
        const waitlist = team.waitlist;

        if (!players.length && !waitlist.length) {
          await interaction.reply({
            content: `**${team.title}**\n目前還沒有人參加。`,
            ephemeral: true
          });
          return;
        }

        const lines = players.map((player, index) => {
          const emoji = TEAM_ROLE_EMOJIS[player.role] || '✅';
          const label = TEAM_ROLE_LABELS[player.role] || '隊員';
          return `${index + 1}. ${emoji} ${label} - <@${player.userId}>`;
        });
        const waitlistLines = waitlist.map((player, index) => {
          const emoji = TEAM_ROLE_EMOJIS[player.role] || '✅';
          const label = TEAM_ROLE_LABELS[player.role] || '隊員';
          return `${index + 1}. ${emoji} ${label} - <@${player.userId}>`;
        });
        const startText = team.startAt ? `\n開始時間：${formatDiscordTimestamp(team.startAt)}` : '';

        await interaction.reply({
          content: `**${team.title}**${startText}\n人數：${players.length}/${team.maxPlayers}\n候補：${waitlist.length}\n\n${lines.join('\n')}${waitlistLines.length ? `\n\n**候補**\n${waitlistLines.join('\n')}` : ''}`.slice(0, 1900),
          ephemeral: true
        });
        return;
      }

    } catch (error) {
      console.error(error);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: '发生错误，请查看终端窗口。',
          ephemeral: true
        }).catch(() => {});
      } else {
        await interaction.reply({
          content: '发生错误，请查看终端窗口。',
          ephemeral: true
        }).catch(() => {});
      }
    }

    return;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('giveaway_create_')) {
      const channelId = interaction.customId.replace('giveaway_create_', '');
      const durationText = interaction.fields.getTextInputValue('duration');
      const winnersText = interaction.fields.getTextInputValue('winners');
      const prize = interaction.fields.getTextInputValue('prize');
      const description = interaction.fields.getTextInputValue('description') || '';

      const duration = parseDuration(durationText);
      const winnerCount = Number(winnersText);

      if (!duration) {
        await interaction.reply({
          content: '时间格式错误，请使用 45m、2h、1d、1d2h50m 这种格式。',
          ephemeral: true
        });
        return;
      }

      if (!Number.isInteger(winnerCount) || winnerCount <= 0) {
        await interaction.reply({
          content: '中奖人数必须是大于 0 的整数。',
          ephemeral: true
        });
        return;
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        await interaction.reply({
          content: '找不到这个频道。',
          ephemeral: true
        });
        return;
      }

      const endsAt = new Date(Date.now() + duration);

      const giveaway = {
        id: crypto.randomUUID(),
        guildId: interaction.guildId,
        channelId: channel.id,
        messageId: '',
        prize,
        description,
        winnerCount,
        entries: [],
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
        endsAt: endsAt.toISOString(),
        ended: false,
        winnerIds: [],
        participantCount: 0
      };

      const embed = buildGiveawayEmbed(giveaway, interaction.user.id, 0);
      const sentMessage = await channel.send({
        embeds: [embed],
        components: [giveawayButtonRow(giveaway.id, false)]
      });

      giveaway.messageId = sentMessage.id;
      db.data.giveaways.push(giveaway);
      await saveDb();
      scheduleGiveawayEnd(giveaway);

      await interaction.reply({
        content: `抽奖已开始，消息 ID：\`${sentMessage.id}\``,
        ephemeral: true
      });

      return;
    }

    if (interaction.customId.startsWith('tempvoice_rename_submit_')) {
      const channelId = interaction.customId.replace('tempvoice_rename_submit_', '');
      const context = await getTempVoiceControlContext(interaction, channelId);

      if (context.error) {
        await replyTempVoiceControl(interaction, context.error);
        return;
      }

      const rawName = interaction.fields.getTextInputValue('name');
      const newName = sanitizeChannelName(rawName).slice(0, 90);

      await context.channel.setName(newName, `临时语音房房主改名: ${interaction.user.tag}`);
      await replyTempVoiceControl(interaction, `房间已改名为：**${newName}**`);
      return;
    }

    if (interaction.customId.startsWith('tempvoice_limit_submit_')) {
      const channelId = interaction.customId.replace('tempvoice_limit_submit_', '');
      const context = await getTempVoiceControlContext(interaction, channelId);

      if (context.error) {
        await replyTempVoiceControl(interaction, context.error);
        return;
      }

      const rawLimit = interaction.fields.getTextInputValue('limit').trim();
      const limit = Number(rawLimit);

      if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        await replyTempVoiceControl(interaction, '人数限制必须是 0 到 99 的整数。0 代表不限制。');
        return;
      }

      await context.channel.setUserLimit(limit, `临时语音房设置人数限制: ${interaction.user.tag}`);
      await replyTempVoiceControl(
        interaction,
        limit === 0 ? '人数限制已取消。' : `人数限制已设置为：**${limit}**`
      );
      return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('giveaway_join_')) {
      const giveawayId = interaction.customId.replace('giveaway_join_', '');
      const giveaway = db.data.giveaways.find(g => g.id === giveawayId);

      if (!giveaway) {
        await interaction.reply({
          content: '找不到这个抽奖。',
          ephemeral: true
        });
        return;
      }

      if (giveaway.ended) {
        await interaction.reply({
          content: '这个抽奖已经结束了。',
          ephemeral: true
        });
        return;
      }

      giveaway.entries ||= [];

      if (giveaway.entries.includes(interaction.user.id)) {
        await interaction.reply({
          content: '你已经参加过这个抽奖了。',
          ephemeral: true
        });
        return;
      }

      giveaway.entries.push(interaction.user.id);
      await saveDb();
      await refreshGiveawayMessage(giveaway);

      await interaction.reply({
        content: '你已经成功参加抽奖。',
        ephemeral: true
      });

      return;
    }

    if (interaction.customId.startsWith('tempvoice_')) {
      const parts = interaction.customId.split('_');
      const action = parts[1];
      const channelId = parts.slice(2).join('_');
      const context = await getTempVoiceControlContext(interaction, channelId);

      if (context.error) {
        await replyTempVoiceControl(interaction, context.error);
        return;
      }

      if (action === 'rename') {
        const modal = new ModalBuilder()
          .setCustomId(`tempvoice_rename_submit_${channelId}`)
          .setTitle('修改语音房名字');
        const nameInput = new TextInputBuilder()
          .setCustomId('name')
          .setLabel('新的房间名字')
          .setPlaceholder('例如：五排开黑')
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(90);

        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
        await interaction.showModal(modal);
        return;
      }

      if (action === 'limit') {
        const modal = new ModalBuilder()
          .setCustomId(`tempvoice_limit_submit_${channelId}`)
          .setTitle('设置人数限制');
        const limitInput = new TextInputBuilder()
          .setCustomId('limit')
          .setLabel('人数限制，0 代表不限制')
          .setPlaceholder('例如：5')
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(2);

        modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
        await interaction.showModal(modal);
        return;
      }

      if (action === 'lock') {
        await context.channel.permissionOverwrites.edit(
          context.channel.guild.roles.everyone,
          { Connect: false },
          { reason: `临时语音房锁房: ${interaction.user.tag}` }
        );
        await context.channel.permissionOverwrites.edit(
          context.tracked.creatorId,
          { Connect: true },
          { reason: '保留房主连接权限' }
        );

        await replyTempVoiceControl(interaction, '房间已锁定，其他人不能再加入。');
        return;
      }

      if (action === 'unlock') {
        await context.channel.permissionOverwrites.edit(
          context.channel.guild.roles.everyone,
          { Connect: null },
          { reason: `临时语音房解锁: ${interaction.user.tag}` }
        );

        await replyTempVoiceControl(interaction, '房间已解锁。');
        return;
      }

      if (action === 'delete') {
        await context.channel.delete(`临时语音房房主删除: ${interaction.user.tag}`);
        db.data.tempVoiceChannels = db.data.tempVoiceChannels.filter(x => x.channelId !== channelId);
        await saveDb();

        await replyTempVoiceControl(interaction, '房间已删除。');
        return;
      }
    }

    if (interaction.customId.startsWith('team_role_')) {
      const roleAndId = interaction.customId.replace('team_role_', '');
      const [role, ...teamIdParts] = roleAndId.split('_');
      const teamId = teamIdParts.join('_');
      const team = db.data.teamPosts.find(t => t.id === teamId);

      if (!team) {
        await interaction.reply({
          content: '找不到這個組隊消息。',
          ephemeral: true
        });
        return;
      }

      if (team.closed) {
        await interaction.reply({
          content: '這個組隊報名已經關閉。',
          ephemeral: true
        });
        return;
      }

      if (!TEAM_ROLE_LABELS[role]) {
        await interaction.reply({
          content: '職業選擇錯誤。',
          ephemeral: true
        });
        return;
      }

      normalizeTeamCollections(team);

      const existingPlayer = team.players.find(player => player.userId === interaction.user.id);
      const existingWaitlistPlayer = team.waitlist.find(player => player.userId === interaction.user.id);

      if (!existingPlayer && team.players.length >= team.maxPlayers) {
        if (existingWaitlistPlayer) {
          existingWaitlistPlayer.role = role;
        } else {
          team.waitlist.push({
            userId: interaction.user.id,
            role
          });
        }

        await saveDb();
        await refreshTeamMessage(team);

        await interaction.reply({
          content: `人數已滿，你已加入候補，想玩的職業是 ${TEAM_ROLE_EMOJIS[role]} **${TEAM_ROLE_LABELS[role]}**。`,
          ephemeral: true
        });
        return;
      }

      if (existingPlayer) {
        existingPlayer.role = role;
      } else {
        team.waitlist = team.waitlist.filter(player => player.userId !== interaction.user.id);
        team.players.push({
          userId: interaction.user.id,
          role
        });
      }

      await saveDb();
      await refreshTeamMessage(team);

      await interaction.reply({
        content: `你已選擇 ${TEAM_ROLE_EMOJIS[role]} **${TEAM_ROLE_LABELS[role]}**。`,
        ephemeral: true
      });

      return;
    }

    if (interaction.customId.startsWith('team_leave_')) {
      const teamId = interaction.customId.replace('team_leave_', '');
      const team = db.data.teamPosts.find(t => t.id === teamId);

      if (!team) {
        await interaction.reply({
          content: '找不到這個組隊消息。',
          ephemeral: true
        });
        return;
      }

      normalizeTeamCollections(team);

      const joined = team.players.some(player => player.userId === interaction.user.id);
      const waitlisted = team.waitlist.some(player => player.userId === interaction.user.id);

      if (!joined && !waitlisted) {
        await interaction.reply({
          content: '你本來就沒有參加。',
          ephemeral: true
        });
        return;
      }

      team.players = team.players.filter(player => player.userId !== interaction.user.id);
      team.waitlist = team.waitlist.filter(player => player.userId !== interaction.user.id);
      const promoted = promoteWaitlistIfPossible(team);
      await saveDb();
      await refreshTeamMessage(team);

      await interaction.reply({
        content: promoted.length
          ? `你已退出組隊。候補已補上：${promoted.map(player => `<@${player.userId}>`).join(', ')}`
          : '你已退出組隊。',
        ephemeral: true
      });

      return;
    }

    if (interaction.customId.startsWith('team_remind_')) {
      const teamId = interaction.customId.replace('team_remind_', '');
      const team = db.data.teamPosts.find(t => t.id === teamId);

      if (!team) {
        await interaction.reply({
          content: '找不到这个组队消息。',
          ephemeral: true
        });
        return;
      }

      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
      const isCreator = interaction.user.id === team.createdBy;

      if (!isAdmin && !isCreator) {
        await interaction.reply({
          content: '只有创建者或管理员可以提醒队员。',
          ephemeral: true
        });
        return;
      }

      const sent = await sendTeamReminder(team, true);
      await interaction.reply({
        content: sent ? '已提醒隊員。' : '目前没有可提醒的队员或候补。',
        ephemeral: true
      });

      return;
    }

    if (interaction.customId.startsWith('team_delete_')) {
      const teamId = interaction.customId.replace('team_delete_', '');
      const team = db.data.teamPosts.find(t => t.id === teamId);

      if (!team) {
        await interaction.reply({
          content: '找不到这个组队消息。',
          ephemeral: true
        });
        return;
      }

      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
      const isCreator = interaction.user.id === team.createdBy;

      if (!isAdmin && !isCreator) {
        await interaction.deferUpdate();
        return;
      }

      await deleteTeamPost(team);

      await interaction.reply({
        content: '组队消息已删除。',
        ephemeral: true
      });

      return;
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
