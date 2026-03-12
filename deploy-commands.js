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
        .setDescription('多久后发送，例如 10m、2h、1d、1d 2h 30m')
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
      option
        .setName('time')
        .setDescription('时间，24小时制，例如 20:30')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message').setDescription('公告内容').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('schedule-list')
    .setDescription('查看所有固定公告')
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
    .setDescription('设置 Join to Create 入口语音频道')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('入口语音频道')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('tempvoice-disable')
    .setDescription('关闭 Join to Create 临时语音频道功能')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('giveaway-start')
    .setDescription('开始抽奖')
    .addChannelOption(option =>
      option.setName('channel').setDescription('发布抽奖的频道').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('prize').setDescription('奖品').setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('description')
        .setDescription('抽奖说明，例如活动内容、领奖方式、规则')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('duration')
        .setDescription('持续时间，例如 1d 2h 50m、2h30m、45m')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('winners').setDescription('中奖人数').setRequired(true).setMinValue(1)
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
      option.setName('winners').setDescription('重抽人数').setRequired(false).setMinValue(1)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('giveaway-participants')
    .setDescription('查看参与者名单和人数')
    .addStringOption(option =>
      option.setName('message_id').setDescription('抽奖消息 ID').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function main() {
  await rest.put(
    Routes.applicationGuildCommands(
      process.env.DISCORD_CLIENT_ID,
      process.env.DISCORD_GUILD_ID
    ),
    { body: commands }
  );

  console.log('Slash 指令注册成功');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});