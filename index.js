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
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

  // ✅ 权限控制（核心修复）
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

    // ===== SCHEDULE（简单版）=====
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

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`人数：0/${maxPlayers}`)
        .setColor('#34C759');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('join')
          .setLabel('Join')
          .setStyle(ButtonStyle.Success)
      );

      const msg = await channel.send({
        embeds: [embed],
        components: [row]
      });

      db.data.teamPosts.push({
        id: msg.id,
        players: [],
        maxPlayers
      });

      await db.write();

      return interaction.reply({
        content: '组队已创建',
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


client.login(process.env.DISCORD_TOKEN);