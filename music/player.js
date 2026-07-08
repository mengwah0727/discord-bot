import { Player } from 'discord-player';
import { SpotifyExtractor } from '@discord-player/extractor';
import { YoutubeiExtractor } from 'discord-player-youtubei';
import ffmpegPath from 'ffmpeg-static';
import { authorizeVoiceControl, nextLoopMode, stepVolume } from './policy.js';
import { buildMusicPanel, buildQueueEmbed } from './panel.js';
import { resolveLinkResult } from './resolver.js';

const MUSIC_COMMANDS = new Set(['play', 'music']);

function errorMessage(error) {
  console.error('音乐功能错误:', error);
  return '音乐播放失败，请稍后再试或换一个歌曲链接。';
}

async function replyPrivately(interaction, content) {
  const payload = { content, ephemeral: true };
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

function getVoiceAuthorization(interaction, queue) {
  return authorizeVoiceControl({
    memberChannelId: interaction.member?.voice?.channelId || null,
    botChannelId: queue?.channel?.id || null
  });
}

async function refreshStoredPanel(queue) {
  const { channel, panelMessageId } = queue.metadata || {};
  if (!channel?.messages || !panelMessageId || !queue.currentTrack) return;

  try {
    const message = await channel.messages.fetch(panelMessageId);
    await message.edit(buildMusicPanel(queue));
  } catch (error) {
    console.warn('无法更新音乐面板:', error.message);
  }
}

async function finishStoredPanel(queue, content) {
  const { channel, panelMessageId } = queue.metadata || {};
  if (!channel?.messages || !panelMessageId) return;

  try {
    const message = await channel.messages.fetch(panelMessageId);
    await message.edit({ content, embeds: [], components: [] });
  } catch (error) {
    console.warn('无法结束音乐面板:', error.message);
  }
}

export async function createMusicService(client, options = {}) {
  const player = options.player || new Player(client, { ffmpegPath });

  if (options.loadExtractors !== false) {
    await player.extractors.register(YoutubeiExtractor, {
      cookie: process.env.YOUTUBE_COOKIE || undefined,
      ignoreSignInErrors: true,
      logLevel: 'ALL'
    });
    await player.extractors.register(SpotifyExtractor, {});
  }

  player.events.on('playerStart', async queue => {
    await refreshStoredPanel(queue);
  });

  player.events.on('playerError', async (queue, error) => {
    console.error('音乐串流失败:', error);
    await queue.metadata?.channel?.send('当前歌曲无法播放，正在尝试下一首。').catch(() => {});
  });

  player.on('debug', message => {
    console.log('[Music/Player]', message);
  });

  player.events.on('debug', (queue, message) => {
    console.log(`[Music/Queue:${queue.id}]`, message);
  });

  player.events.on('playerSkip', async (queue, track, reason, description) => {
    console.error('歌曲被跳过:', {
      title: track?.title,
      reason,
      description
    });

    const metadata = queue.metadata || {};
    if (metadata.skipNoticeSent || !metadata.channel) return;
    metadata.skipNoticeSent = true;
    queue.setMetadata(metadata);

    const detail = String(description || reason || '无法取得音频来源').slice(0, 500);
    await metadata.channel.send(
      `歌曲无法播放，已自动跳过。\n原因：\`${detail.replaceAll('`', "'")}\``
    ).catch(() => {});
  });

  player.events.on('error', (queue, error) => {
    console.error('音乐队列错误:', error);
  });

  player.events.on('emptyQueue', async queue => {
    await finishStoredPanel(queue, '队列已播放完毕。');
  });

  player.events.on('emptyChannel', async queue => {
    await finishStoredPanel(queue, '语音频道已经没人，Bot 已自动离开。');
  });

  async function handlePlay(interaction) {
    const channel = interaction.member?.voice?.channel;
    if (!channel) {
      await interaction.reply({ content: '请先加入语音频道。', ephemeral: true });
      return;
    }

    const existingQueue = player.nodes.get(interaction.guildId);
    const authorization = getVoiceAuthorization(interaction, existingQueue);
    if (!authorization.ok) {
      await interaction.reply({ content: authorization.message, ephemeral: true });
      return;
    }

    const query = interaction.options.getString('query', true).trim();
    await interaction.deferReply();

    try {
      const result = await player.play(channel, query, {
        requestedBy: interaction.user,
        afterSearch: async searchResult => resolveLinkResult({
          input: query,
          result: searchResult,
          search: searchText => player.search(searchText, { requestedBy: interaction.user })
        }),
        nodeOptions: {
          metadata: { channel: interaction.channel, panelMessageId: null },
          leaveOnEnd: true,
          leaveOnEndCooldown: 15_000,
          leaveOnEmpty: true,
          leaveOnEmptyCooldown: 60_000,
          leaveOnStop: true,
          leaveOnStopCooldown: 1_000,
          skipOnNoStream: true,
          volume: 60
        }
      });

      const message = await interaction.editReply(buildMusicPanel(result.queue));
      result.queue.setMetadata({ channel: interaction.channel, panelMessageId: message.id });
    } catch (error) {
      await interaction.editReply({ content: errorMessage(error), embeds: [], components: [] });
    }
  }

  async function handleMusic(interaction) {
    const queue = player.nodes.get(interaction.guildId);
    if (!queue?.currentTrack) {
      await interaction.reply({ content: '目前没有歌曲正在播放。', ephemeral: true });
      return;
    }

    const authorization = getVoiceAuthorization(interaction, queue);
    if (!authorization.ok) {
      await interaction.reply({ content: authorization.message, ephemeral: true });
      return;
    }

    const message = await interaction.reply({ ...buildMusicPanel(queue), fetchReply: true });
    queue.setMetadata({ channel: interaction.channel, panelMessageId: message.id });
  }

  async function handleCommand(interaction) {
    if (!MUSIC_COMMANDS.has(interaction.commandName)) return false;
    if (interaction.commandName === 'play') await handlePlay(interaction);
    if (interaction.commandName === 'music') await handleMusic(interaction);
    return true;
  }

  async function handleButton(interaction) {
    if (!interaction.customId?.startsWith('music_')) return false;

    const queue = player.nodes.get(interaction.guildId);
    if (!queue?.currentTrack) {
      await replyPrivately(interaction, '目前没有歌曲正在播放。');
      return true;
    }

    const authorization = getVoiceAuthorization(interaction, queue);
    if (!authorization.ok) {
      await replyPrivately(interaction, authorization.message);
      return true;
    }

    if (interaction.customId === 'music_queue') {
      await interaction.reply({ embeds: [buildQueueEmbed(queue)], ephemeral: true });
      return true;
    }

    await interaction.deferUpdate();

    try {
      switch (interaction.customId) {
        case 'music_previous':
          if (queue.history.isEmpty()) {
            await interaction.followUp({ content: '没有上一首歌曲。', ephemeral: true });
            return true;
          }
          await queue.history.previous();
          break;
        case 'music_pause':
          queue.node.setPaused(!queue.node.isPaused());
          break;
        case 'music_skip':
          queue.node.skip();
          break;
        case 'music_stop':
          queue.delete();
          await interaction.message.edit({ content: '播放已停止。', embeds: [], components: [] });
          return true;
        case 'music_shuffle':
          if (queue.tracks.size < 2) {
            await interaction.followUp({ content: '队列歌曲不足，暂时不能随机排序。', ephemeral: true });
            return true;
          }
          queue.tracks.shuffle();
          break;
        case 'music_loop':
          queue.setRepeatMode(nextLoopMode(queue.repeatMode));
          break;
        case 'music_volume_down':
          queue.node.setVolume(stepVolume(queue.node.volume, -10));
          break;
        case 'music_volume_up':
          queue.node.setVolume(stepVolume(queue.node.volume, 10));
          break;
        default:
          return false;
      }

      if (queue.currentTrack) await interaction.message.edit(buildMusicPanel(queue));
    } catch (error) {
      await interaction.followUp({ content: errorMessage(error), ephemeral: true });
    }

    return true;
  }

  return {
    handleCommand,
    handleButton,
    destroy: () => player.destroy()
  };
}
