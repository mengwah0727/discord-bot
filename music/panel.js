import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from 'discord.js';

const PANEL_COLOR = '#34C759';
const LOOP_LABELS = ['关闭', '单曲', '队列', '自动播放'];

function safeText(value, fallback = '未知') {
  return String(value || fallback).replaceAll('`', "'");
}

function makeButton(customId, label, emoji, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(style);
}

export function buildMusicPanel(queue) {
  const track = queue.currentTrack;
  const paused = queue.node.isPaused();
  const requesterId = track?.requestedBy?.id;
  const title = safeText(track?.title, '等待播放');
  const url = track?.url || null;
  const linkedTitle = url ? `[${title}](${url})` : `**${title}**`;

  const description = [
    linkedTitle,
    '',
    `**点歌者**  ${requesterId ? `<@${requesterId}>` : '未知'}`,
    `**时长**  ${safeText(track?.duration, '未知')}`,
    `**作者**  ${safeText(track?.author)}`,
    '',
    `**队列**  ${queue.tracks.size} 首　 **音量**  ${queue.node.volume}%　 **循环**  ${LOOP_LABELS[queue.repeatMode] || '关闭'}`
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('MUSIC PANEL')
    .setDescription(description);

  if (track?.thumbnail) embed.setThumbnail(track.thumbnail);

  const playbackRow = new ActionRowBuilder().addComponents(
    makeButton('music_previous', '上一首', '⏮️'),
    makeButton('music_pause', paused ? '继续' : '暂停', paused ? '▶️' : '⏸️', ButtonStyle.Primary),
    makeButton('music_skip', '下一首', '⏭️'),
    makeButton('music_stop', '停止', '⏹️', ButtonStyle.Danger)
  );

  const optionsRow = new ActionRowBuilder().addComponents(
    makeButton('music_shuffle', '随机', '🔀'),
    makeButton('music_loop', '循环', '🔁'),
    makeButton('music_queue', '队列', '📋'),
    makeButton('music_volume_down', '音量 -', '🔉'),
    makeButton('music_volume_up', '音量 +', '🔊')
  );

  return { embeds: [embed], components: [playbackRow, optionsRow] };
}

export function buildQueueEmbed(queue) {
  const tracks = queue.tracks.toArray().slice(0, 10);
  const description = tracks.length
    ? tracks.map((track, index) => `${index + 1}. ${safeText(track.title)}${track.duration ? ` (${track.duration})` : ''}`).join('\n')
    : '队列中没有下一首歌曲。';

  return new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(`播放队列 (${queue.tracks.size})`)
    .setDescription(description)
    .setFooter({ text: queue.tracks.size > 10 ? `只显示前 10 首，另有 ${queue.tracks.size - 10} 首` : 'YūBot Music' });
}
