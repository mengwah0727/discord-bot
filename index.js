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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel]
});

const DATA_DIR = './data';
const DB_PATH = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const adapter = new JSONFile(DB_PATH);
const db = new Low(adapter, {
  teamPosts: []
});

await db.read();
db.data ||= { teamPosts: [] };
await db.write();


// ✅ 管理员指令列表（重点）
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
  'giveaway-participants',
  'team-end'
]);


client.once(Events.ClientReady, () => {
  console.log(`✅ Bot 已上线: ${client.user.tag}`);
});


client.on(Events.InteractionCreate, async interaction => {

  // ===== 按钮互动处理 =====
  if (interaction.isButton()) {
    const [action, postId] = interaction.customId.split(':');
    const userId = interaction.user.id;

    await db.read();
    const post = db.data.teamPosts.find(p => p.id === postId);

    if (!post) {
      return interaction.reply({ content: '找不到此组队资料。', ephemeral: true });
    }

    // 加入
    if (action === 'join') {
      if (post.closed) {
        return interaction.reply({ content: '此组队招募已关闭。', ephemeral: true });
      }
      if (post.players.includes(userId)) {
        return interaction.reply({ content: '你已经加入了！', ephemeral: true });
      }
      if (post.players.length >= post.maxPlayers) {
        return interaction.reply({ content: '人数已满，无法加入。', ephemeral: true });
      }
      post.players.push(userId);
      await db.write();

      await interaction.message.edit({
        embeds: [buildTeamEmbed(post)],
        components: buildTeamButtons(post)
      });
      return interaction.reply({ content: '✅ 已成功加入！', ephemeral: true });
    }

    // 离开
    if (action === 'leave') {
      if (!post.players.includes(userId)) {
        return interaction.reply({ content: '你还没有加入。', ephemeral: true });
      }
      post.players = post.players.filter(id => id !== userId);
      await db.write();

      await interaction.message.edit({
        embeds: [buildTeamEmbed(post)],
        components: buildTeamButtons(post)
      });
      return interaction.reply({ content: '✅ 已成功离开。', ephemeral: true });
    }

    // 删除（仅管理员）
    if (action === 'delete') {
      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
      if (!isAdmin) {
        return interaction.reply({ content: '你需要有 Manage Server 权限才能删除此组队。', ephemeral: true });
      }
      post.closed = true;
      await db.write();

      await interaction.message.edit({
        embeds: [buildTeamEmbed(post)],
        components: []
      });
      return interaction.reply({ content: '✅ 组队招募已关闭。', ephemeral: true });
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

  // ✅ 权限控制
  if (ADMIN_ONLY_COMMANDS.has(interaction.commandName) && !isAdmin) {
    return interaction.reply({
      content: '你需要有 Manage Server 权限才可以使用这个指令。',
      ephemeral: true
    });
  }

  try {

    // ===== SEND =====
    if (interaction.commandName === 'send') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');

      await channel.send(message);
      return interaction.reply({ content: '已发送', ephemeral: true });
    }

    // ===== SCHEDULE =====
    if (interaction.commandName === 'schedule') {
      return interaction.reply({
        content: '定时功能已触发（你原本逻辑可以继续用）',
        ephemeral: true
      });
    }

    // ===== TEAM CREATE =====
    if (interaction.commandName === 'team-create') {
      const channel = interaction.options.getChannel('channel');
      const title = interaction.options.getString('title');
      const maxPlayers = interaction.options.getInteger('max_players');
      const creatorId = interaction.user.id;

      const post = {
        id: null,
        title,
        players: [],
        maxPlayers,
        creatorId,
        closed: false
      };

      const msg = await channel.send({
        embeds: [buildTeamEmbed(post)],
        components: buildTeamButtons(post)
      });

      post.id = msg.id;
      db.data.teamPosts.push(post);
      await db.write();

      await msg.edit({
        embeds: [buildTeamEmbed(post)],
        components: buildTeamButtons(post)
      });

      return interaction.reply({
        content: `组队已创建，消息 ID：${msg.id}`,
        ephemeral: true
      });
    }

    // ===== TEAM LIST =====
    if (interaction.commandName === 'team-list') {
      return interaction.reply({
        content: '这里显示组队名单（你原逻辑可以保留）',
        ephemeral: true
      });
    }

  } catch (error) {
    console.error(error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '发生错误',
        ephemeral: true
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: '发生错误',
        ephemeral: true
      }).catch(() => {});
    }
  }
});


// ===== 工具函数 =====

function buildTeamEmbed(post) {
  const playerList = post.players.length > 0
    ? post.players.map(id => `<@${id}>`).join('\n')
    : '目前还没有人参加';

  const status = post.closed ? '（已关闭）' : '';

  return new EmbedBuilder()
    .setTitle(`${post.title} ${status}`)
    .addFields(
      { name: '人数', value: `${post.players.length}/${post.maxPlayers}` },
      { name: '创建者', value: `<@${post.creatorId}>` },
      { name: '参与名单', value: playerList }
    )
    .setFooter({ text: '点击按钮参加、退出或删除' })
    .setColor(post.closed ? '#FF3B30' : '#34C759');
}

function buildTeamButtons(post) {
  if (post.closed) return [];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join:${post.id}`)
      .setLabel('加入')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`leave:${post.id}`)
      .setLabel('離開')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`delete:${post.id}`)
      .setLabel('刪除')
      .setStyle(ButtonStyle.Danger)
  );

  return [row];
}


client.login(process.env.DISCORD_TOKEN);