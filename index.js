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

  for (const match of text.matchAll(regex)) {
    matchFound = true;
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

  if (!matchFound || total <= 0) return null;
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

function teamButtonRow(teamId, closed = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`team_join_${teamId}`)
      .setLabel('Join')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`team_leave_${teamId}`)
      .setLabel('Leave')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`team_delete_${teamId}`)
      .setLabel('Delete')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(false)
  );
}

function buildTeamEmbed(team) {
  const players = team.players || [];
  const lines = [
    `**人数：** ${players.length}/${team.maxPlayers}`,
    ''
  ];

  if (team.description?.trim()) {
    lines.push(normalizeMessage(team.description));
    lines.push('');
  }

  lines.push(`**创建者：** <@${team.createdBy}>`);
  lines.push('');

  if (players.length) {
    lines.push('**参与名单：**');
    players.forEach((id, index) => {
      lines.push(`${index + 1}. <@${id}>`);
    });
  } else {
    lines.push('**参与名单：**');
    lines.push('目前还没有人参加');
  }

  return new EmbedBuilder()
    .setColor(APPLE_GREEN)
    .setTitle(team.title)
    .setDescription(lines.join('\n'))
    .setFooter({ text: team.closed ? '报名已关闭' : '点击按钮参加、退出或删除' })
    .setTimestamp();
}

async function saveDb() {
  await db.write();
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

  const timer = setTimeout(() => sendScheduledMessage(item), delay);
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
    clearTimeout(weeklyTimers.get(item.id));
    weeklyTimers.delete(item.id);
  }

  const nextRun = getNextWeeklyRun(item.day, item.time);
  if (!nextRun) return;

  item.nextRunAt = nextRun.toISOString();
  saveDb().catch(console.error);

  const delay = nextRun.getTime() - Date.now();
  const timer = setTimeout(() => sendWeeklyMessage(item), delay);
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

  const timer = setTimeout(() => endGiveaway(giveaway.id), delay);
  giveawayTimers.set(giveaway.id, timer);
}

async function refreshTeamMessage(team) {
  try {
    const channel = await client.channels.fetch(team.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(team.messageId);
    await message.edit({
      embeds: [buildTeamEmbed(team)],
      components: [teamButtonRow(team.id, team.closed)]
    });
  } catch (error) {
    console.error('更新组队消息失败:', error);
  }
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

  await member.voice.setChannel(newChannel).catch(async error => {
    console.error('移动用户到临时语音频道失败:', error);

    db.data.tempVoiceChannels = db.data.tempVoiceChannels.filter(x => x.channelId !== newChannel.id);
    await saveDb();
    await newChannel.delete().catch(() => {});
  });
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
        const channel = interaction.options.getChannel('channel', true);
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
        const channel = interaction.options.getChannel('channel', true);
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
          clearTimeout(weeklyTimers.get(id));
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
        const channel = interaction.options.getChannel('channel', true);

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
          clearTimeout(giveawayTimers.get(giveaway.id));
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
        const channel = interaction.options.getChannel('channel', true);
        const title = interaction.options.getString('title', true);
        const description = interaction.options.getString('description') || '';
        const maxPlayers = interaction.options.getInteger('max_players', true);

        if (!channel.isTextBased()) {
          await interaction.reply({
            content: '请选择文字频道。',
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
          closed: false,
          createdBy: interaction.user.id,
          createdAt: new Date().toISOString()
        };

        const sentMessage = await channel.send({
          embeds: [buildTeamEmbed(team)],
          components: [teamButtonRow(team.id, false)]
        });

        team.messageId = sentMessage.id;
        db.data.teamPosts.push(team);
        await saveDb();

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

        const players = team.players || [];

        if (!players.length) {
          await interaction.reply({
            content: `**${team.title}**\n目前还没有人参加。`,
            ephemeral: true
          });
          return;
        }

        const lines = players.map((id, index) => `${index + 1}. <@${id}>`);

        await interaction.reply({
          content: `**${team.title}**\n人数：${players.length}/${team.maxPlayers}\n\n${lines.join('\n')}`.slice(0, 1900),
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

    if (interaction.customId.startsWith('team_join_')) {
      const teamId = interaction.customId.replace('team_join_', '');
      const team = db.data.teamPosts.find(t => t.id === teamId);

      if (!team) {
        await interaction.reply({
          content: '找不到这个组队消息。',
          ephemeral: true
        });
        return;
      }

      if (team.closed) {
        await interaction.reply({
          content: '这个组队报名已经关闭。',
          ephemeral: true
        });
        return;
      }

      team.players ||= [];

      if (team.players.includes(interaction.user.id)) {
        await interaction.reply({
          content: '你已经参加了。',
          ephemeral: true
        });
        return;
      }

      if (team.players.length >= team.maxPlayers) {
        await interaction.reply({
          content: '人数已满。',
          ephemeral: true
        });
        return;
      }

      team.players.push(interaction.user.id);
      await saveDb();
      await refreshTeamMessage(team);

      await interaction.reply({
        content: '你已成功加入组队。',
        ephemeral: true
      });

      return;
    }

    if (interaction.customId.startsWith('team_leave_')) {
      const teamId = interaction.customId.replace('team_leave_', '');
      const team = db.data.teamPosts.find(t => t.id === teamId);

      if (!team) {
        await interaction.reply({
          content: '找不到这个组队消息。',
          ephemeral: true
        });
        return;
      }

      team.players ||= [];

      if (!team.players.includes(interaction.user.id)) {
        await interaction.reply({
          content: '你本来就没有参加。',
          ephemeral: true
        });
        return;
      }

      team.players = team.players.filter(id => id !== interaction.user.id);
      await saveDb();
      await refreshTeamMessage(team);

      await interaction.reply({
          content: '你已退出组队。',
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
        await interaction.reply({
          content: '只有创建这个组队的人或管理员可以删除。',
          ephemeral: true
        });
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