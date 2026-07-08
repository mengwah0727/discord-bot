import { SlashCommandBuilder } from 'discord.js';

export const musicCommands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('播放或加入歌曲')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('歌名、YouTube 或 Spotify 链接')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('music')
    .setDescription('显示音乐控制面板')
];
