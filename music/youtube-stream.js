import youtubeDl from 'youtube-dl-exec';

export function createYoutubeDlStream(track, exec = youtubeDl.exec) {
  const process = exec(track.url, {
    format: track.live ? 'best[height<=360]' : 'bestaudio',
    output: '-',
    jsRuntimes: 'node',
    noWarnings: true,
    noProgress: true
  });

  let stderr = '';
  process.stderr?.on('data', chunk => {
    stderr = `${stderr}${chunk}`.slice(-2000);
  });

  process.catch(error => {
    console.error('[Music/yt-dlp] 串流失败:', stderr || error.message);
  });

  if (!process.stdout) {
    throw new Error('yt-dlp 没有返回音频串流。');
  }

  process.stdout.on('error', () => {
    if (!process.killed) process.kill();
  });

  return process.stdout;
}
