import 'dotenv/config';
import {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('send')
    .setDescription('發送一條訊息到指定頻道')
    .addChannelOption(option =>
      option.setName('channel').setDescription('目標頻道').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message').setDescription('訊息內容').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('定時發送一次訊息')
    .addChannelOption(option =>
      option.setName('channel').setDescription('目標頻道').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message').setDescription('訊息內容').setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('delay')
        .setDescription('多久後發送，例如 10m、2h、1d、1d2h30m')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('schedule-weekly')
    .setDescription('每週固定時間發送公告')
    .addChannelOption(option =>
      option.setName('channel').setDescription('目標頻道').setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('day')
        .setDescription('星期幾')
        .setRequired(true)
        .addChoices(
          { name: 'Monday', value: 'monday' },
          { name: 'Tuesday', value: 'tuesday' },
          { name: 'Wednesday', value: 'wednesday' },
          { name: 'Thursday', value: 'thursday' },
          { name: 'Friday', value: 'friday' },
          { name: 'Saturday', value: 'saturday' },
          { name: 'Sunday', value: 'sunday' }
        )
    )
    .addStringOption(option =>
      option.setName('time').setDescription('時間，例如 20:30').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message').setDescription('公告內容').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('schedule-list')
    .setDescription('查看固定公告')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('schedule-delete')
    .setDescription('刪除固定公告')
    .addStringOption(option =>
      option.setName('id').setDescription('公告 ID').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('tempvoice-set')
    .setDescription('設置 Join to Create 語音頻道')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('語音頻道')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('tempvoice-disable')
    .setDescription('關閉 Join to Create')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('giveaway-start')
    .setDescription('開啟 Giveaway 創建表單')
    .addChannelOption(option =>
      option.setName('channel').setDescription('抽獎頻道').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('giveaway-end')
    .setDescription('手動結束抽獎')
    .addStringOption(option =>
      option.setName('message_id').setDescription('抽獎訊息 ID').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('giveaway-reroll')
    .setDescription('重新抽中獎者')
    .addStringOption(option =>
      option.setName('message_id').setDescription('抽獎訊息 ID').setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('winners').setDescription('重抽幾人').setRequired(false).setMinValue(1)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('giveaway-participants')
    .setDescription('查看參與人數')
    .addStringOption(option =>
      option.setName('message_id').setDescription('抽獎訊息 ID').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // 👇 普通用戶可用（沒有權限限制）
  new SlashCommandBuilder()
    .setName('team-create')
    .setDescription('創建組隊招募')
    .addChannelOption(option =>
      option.setName('channel').setDescription('發布到哪個頻道').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('title').setDescription('標題，例如 CODM 組隊').setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('max_players')
        .setDescription('人數上限')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(99)
    )
    .addStringOption(option =>
      option.setName('description').setDescription('說明 / 時間 / 規則').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('team-end')
    .setDescription('手動關閉組隊招募')
    .addStringOption(option =>
      option.setName('message_id').setDescription('組隊訊息 ID').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('team-list')
    .setDescription('查看組隊參與名單')
    .addStringOption(option =>
      option.setName('message_id').setDescription('組隊訊息 ID').setRequired(true)
    )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('開始註冊 GLOBAL Slash 指令...');

    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );

    console.log('Slash 指令註冊成功');
  } catch (error) {
    console.error(error);
  }
})();