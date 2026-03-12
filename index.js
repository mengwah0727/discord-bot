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
  ChannelType
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
  tempVoiceConfig: {},
  tempVoiceChannels: []
});

await db.read();

if (!db.data) {
  db.data = {
    scheduledMessages: [],
    weeklySchedules: [],
    giveaways: [],
    tempVoiceConfig: {},
    tempVoiceChannels: []
  };
} else {
  db.data.scheduledMessages ||= [];
  db.data.weeklySchedules ||= [];
  db.data.giveaways ||= [];
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
  const channel = await client.channels.fetch(giveaway.channelId);
  if (!channel || !channel.isTextBased()) return [];

  const message = await channel.messages.fetch(giveaway.messageId);
  const reaction =
    message.reactions.cache.get('🎉') ||
    (await message.reactions.fetch('🎉').catch(() => null));

  if (!reaction) return [];

  const users = await reaction.users.fetch();
  return users.filter(user => !user.bot).map(user => ({
    id: user.id,
    username: user.username
  }));
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

    const winnerMentions = winners.length
      ? winners.map(w => `<@${w.id}>`).join(', ')
      : '没有有效参与者';

    const descriptionText = giveaway.description
      ? `**说明：** ${giveaway.description}\n`
      : '';

    const embed = new EmbedBuilder()
      .setColor(APPLE_GREEN)
      .setTitle(reroll ? '🎉 抽奖重抽结果' : '🎉 抽奖结束')
      .setDescription(
        `${descriptionText}**奖品：** ${giveaway.prize}\n**中奖者：** ${winnerMentions}\n**参与人数：** ${participants.length}`
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });

    for (const winner of winners) {
      try {
        const user = await client.users.fetch(winner.id);
        await user.send(
          `🎉 恭喜你中奖了！\n奖品：**${giveaway.prize}**\n抽奖链接：${message.url}`
        );
      } catch (error) {
        console.log(`无法私讯用户 ${winner.id}`);
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
  if (!interaction.isChatInputCommand()) return;

  const hasPermission = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

  if (!hasPermission) {
    await interaction.reply({
      content: '你需要有 Manage Server 权限才可以使用这些指令。',
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
          content: '时间格式错误，请使用 10m、2h、1d、1d 2h 30m 这种格式。',
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
      const prize = interaction.options.getString('prize', true);
      const description = interaction.options.getString('description') || '';
      const durationText = interaction.options.getString('duration', true);
      const winnerCount = interaction.options.getInteger('winners', true);

      if (!channel.isTextBased()) {
        await interaction.reply({ content: '请选择文字频道。', ephemeral: true });
        return;
      }

      const duration = parseDuration(durationText);

      if (!duration) {
        await interaction.reply({
          content: '时间格式错误，请使用 45m、2h、1d、1d 2h 50m、2h30m 这种格式。',
          ephemeral: true
        });
        return;
      }

      const endsAt = new Date(Date.now() + duration);

      const descriptionBlock = description
        ? `**说明：** ${normalizeMessage(description)}\n`
        : '';

      const embed = new EmbedBuilder()
        .setColor(APPLE_GREEN)
        .setTitle('🎉 抽奖开始')
        .setDescription(
          `${descriptionBlock}**奖品：** ${prize}\n**中奖人数：** ${winnerCount}\n**结束时间：** <t:${Math.floor(
            endsAt.getTime() / 1000
          )}:F>\n\n点击 🎉 参与抽奖！`
        )
        .setTimestamp();

      const giveawayMessage = await channel.send({ embeds: [embed] });
      await giveawayMessage.react('🎉');

      const giveaway = {
        id: crypto.randomUUID(),
        guildId: interaction.guildId,
        channelId: channel.id,
        messageId: giveawayMessage.id,
        prize,
        description,
        winnerCount,
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
        endsAt: endsAt.toISOString(),
        ended: false,
        winnerIds: [],
        participantCount: 0
      };

      db.data.giveaways.push(giveaway);
      await saveDb();
      scheduleGiveawayEnd(giveaway);

      await interaction.reply({
        content: `抽奖已开始，消息 ID：\`${giveawayMessage.id}\``,
        ephemeral: true
      });
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
});

client.login(process.env.DISCORD_TOKEN);