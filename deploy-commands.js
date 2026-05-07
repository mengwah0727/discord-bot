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
    .setDescription('发送一条消息到指定频道')
    .addChannelOption(option =>
      option.setName('channel').setDescription('目标频道').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message').setDescription('消息内容').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('定时发送一次消息')
    .addChannelOption(option =>
      option.setName('channel').setDescription('目标频道').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message').setDescription('消息内容').setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('delay')
        .setDescription('多久后发送，例如 10m、2h、1d、1d2h30m')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('schedule-weekly')
    .setDescription('每周固定时间发送公告')
    .addChannelOption(option =>
      option.setName('channel').setDescription('目标频道').setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('day')
        .setDescription('星期几')
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
      option.setName('time').setDescription('时间，例如 20:30').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message').setDescription('公告内容').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('schedule-list')
    .setDescription('查看固定公告')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('schedule-delete')
    .setDescription('删除固定公告')
    .addStringOption(option =>
      option.setName('id').setDescription('公告 ID').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('tempvoice-set')
    .setDescription('设置 Join to Create 语音频道')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('语音频道')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('tempvoice-disable')
    .setDescription('关闭 Join to Create')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('giveaway-start')
    .setDescription('打开 Giveaway 创建表单')
    .addChannelOption(option =>
      option.setName('channel').setDescription('抽奖频道').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('giveaway-end')
    .setDescription('手动结束抽奖')
    .addStringOption(option =>
      option.setName('message_id').setDescription('抽奖消息 ID').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('giveaway-reroll')
    .setDescription('重新抽中奖者')
    .addStringOption(option =>
      option.setName('message_id').setDescription('抽奖消息 ID').setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('winners').setDescription('重抽几人').setRequired(false).setMinValue(1)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('giveaway-participants')
    .setDescription('查看参与人数')
    .addStringOption(option =>
      option.setName('message_id').setDescription('抽奖消息 ID').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // 所有人可用
  new SlashCommandBuilder()
    .setName('team-create')
    .setDescription('创建组队招募')
    .addChannelOption(option =>
      option.setName('channel').setDescription('发布到哪个频道').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('title').setDescription('标题，例如 CODM 组队').setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('max_players')
        .setDescription('人数上限')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(99)
    )
    .addStringOption(option =>
      option.setName('description').setDescription('说明 / 时间 / 规则').setRequired(false)
    ),

  // 所有人可用
  new SlashCommandBuilder()
    .setName('team-list')
    .setDescription('查看组队参与名单')
    .addStringOption(option =>
      option.setName('message_id').setDescription('组队消息 ID').setRequired(true)
    )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('开始注册 Slash 指令...');
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
      ),
      { body: commands }
    );
    console.log('Slash 指令注册成功');
  } catch (error) {
    console.error(error);
  }
})();