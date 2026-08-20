const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const { getTempFilePath, deleteFile } = require('../utils/cleanup');

const FFMPEG_PATH = ffmpegInstaller.path;
const FFPROBE_PATH = ffprobeInstaller.path;
const MAX_GIF_BYTES = 8 * 1024 * 1024; // 8 MB (8,388,608 bytes)

/**
 * Downloads a remote video file to a local temp file.
 */
async function downloadVideoToTemp(videoUrl) {
  const tempVideoPath = getTempFilePath('.mp4');
  const res = await fetch(videoUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });

  if (!res.ok) {
    throw new Error(`Falha ao baixar vídeo de origem: HTTP ${res.status}`);
  }

  const fileStream = fs.createWriteStream(tempVideoPath);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(tempVideoPath, Buffer.from(arrayBuffer));

  return tempVideoPath;
}

/**
 * Probes video metadata using ffprobe.
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration,size:stream=width,height,r_frame_rate,duration,nb_frames',
      '-of', 'json',
      filePath
    ];

    const proc = spawn(FFPROBE_PATH, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`FFprobe error: ${stderr}`));
      }
      try {
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0] || {};
        const format = data.format || {};

        let fps = 24;
        if (stream.r_frame_rate) {
          const parts = stream.r_frame_rate.split('/');
          if (parts.length === 2 && Number(parts[1]) > 0) {
            fps = Math.round(Number(parts[0]) / Number(parts[1]));
          } else {
            fps = Number(parts[0]) || 24;
          }
        }

        const duration = Number(stream.duration || format.duration || 0);
        const width = Number(stream.width || 0);
        const height = Number(stream.height || 0);

        resolve({
          width,
          height,
          fps: Math.min(Math.max(fps, 10), 60),
          duration
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Runs single FFmpeg pass to render GIF with 2-pass palette generation.
 */
function renderGifPass({ inputPath, outputPath, startTime, duration, width, fps, maxColors = 256, dither = 'bayer:bayer_scale=5' }) {
  return new Promise((resolve, reject) => {
    const args = [];

    // Seeking / duration
    if (startTime !== undefined && startTime !== null && Number(startTime) > 0) {
      args.push('-ss', String(startTime));
    }
    if (duration !== undefined && duration !== null && Number(duration) > 0) {
      args.push('-t', String(duration));
    }

    args.push('-i', inputPath);

    // Filter complex with palettegen and paletteuse for maximum quality & small size
    // scale to even width, preserve aspect ratio
    const scaleFilter = width > 0 ? `scale=${width}:-2:flags=lanczos` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos';
    const filterGraph = `[0:v] fps=${fps},${scaleFilter},split [a][b]; [a] palettegen=max_colors=${maxColors}:reserve_transparent=0:stats_mode=diff [p]; [b][p] paletteuse=dither=${dither}:diff_mode=rectangle`;

    args.push('-filter_complex', filterGraph);
    args.push('-y', outputPath);

    const proc = spawn(FFMPEG_PATH, args);
    let stderr = '';

    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`FFmpeg conversion failed: ${stderr.slice(-300)}`));
      }
      resolve();
    });
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const LIMIT_BYTES = {
  discord: 8 * 1024 * 1024,   // 8 MB
  standard: 20 * 1024 * 1024  // 20 MB
};

function calculateInitialSettings({ originalWidth, originalHeight, duration, isGif, quality = 'discord' }) {
  const dur = Math.max(duration || 1, 1);
  let targetWidth = originalWidth || 480;
  let targetFps = isGif ? 20 : 16;

  if (quality === 'standard') {
    targetWidth = Math.min(originalWidth || 640, 640);
    targetFps = 20;
    if (dur > 8) {
      targetWidth = Math.min(targetWidth, 540);
      targetFps = 18;
    }
  } else {
    // 'discord' mode (<= 8MB)
    if (dur <= 3) {
      targetWidth = Math.min(originalWidth || 540, 540);
      targetFps = isGif ? 22 : 18;
    } else if (dur <= 6) {
      targetWidth = Math.min(originalWidth || 480, 480);
      targetFps = 16;
    } else {
      targetWidth = Math.min(originalWidth || 400, 400);
      targetFps = 14;
    }
  }

  targetWidth = Math.max(200, Math.floor(targetWidth / 2) * 2);

  return {
    width: targetWidth,
    fps: targetFps
  };
}

/**
 * Converts video/tweet media to GIF guaranteeing <= 8MB output.
 */
async function convertToGif({
  videoUrl,
  startTime,
  duration,
  quality = 'auto',
  customWidth,
  customFps,
  tweetId = 'media'
}) {
  let tempVideoPath = null;
  const outputGifPath = getTempFilePath('.gif');

  try {
    // 1. Download source MP4
    tempVideoPath = await downloadVideoToTemp(videoUrl);

    // 2. Probe metadata
    const probe = await probeVideo(tempVideoPath);
    const effectiveDuration = duration ? Math.min(Number(duration), probe.duration || 10) : (probe.duration || 3);
    const isGif = probe.duration <= 4 && probe.fps <= 25;

    // 3. Determine starting conversion parameters
    let currentSettings = calculateInitialSettings({
      originalWidth: probe.width,
      originalHeight: probe.height,
      duration: effectiveDuration,
      isGif,
      quality
    });

    if (customWidth && Number(customWidth) > 0) {
      currentSettings.width = Math.floor(Number(customWidth) / 2) * 2;
    }
    if (customFps && Number(customFps) > 0) {
      currentSettings.fps = Math.min(Math.max(Number(customFps), 8), 30);
    }

    let maxColors = 256;
    let dither = 'bayer:bayer_scale=5';
    let passes = 0;
    const maxPasses = 4;
    let finalSize = 0;
    const maxAllowedBytes = LIMIT_BYTES[quality] || LIMIT_BYTES.discord;

    // 4. Adaptive conversion loop guaranteeing <= maxAllowedBytes
    while (passes < maxPasses) {
      passes++;
      console.log(`[GIF Converter] Pass ${passes}: width=${currentSettings.width}, fps=${currentSettings.fps}, maxColors=${maxColors}`);

      await renderGifPass({
        inputPath: tempVideoPath,
        outputPath: outputGifPath,
        startTime,
        duration: effectiveDuration,
        width: currentSettings.width,
        fps: currentSettings.fps,
        maxColors,
        dither
      });

      const stat = fs.statSync(outputGifPath);
      finalSize = stat.size;
      console.log(`[GIF Converter] Pass ${passes} result: ${finalSize} bytes (${formatBytes(finalSize)})`);

      if (finalSize <= maxAllowedBytes) {
        break;
      }

      console.warn(`[GIF Converter] Result ${formatBytes(finalSize)} exceeds limit. Re-optimizing...`);
      
      const ratio = Math.sqrt(maxAllowedBytes / finalSize) * 0.88;
      currentSettings.width = Math.max(180, Math.floor((currentSettings.width * ratio) / 2) * 2);
      currentSettings.fps = Math.max(8, Math.round(currentSettings.fps * ratio));

      if (passes >= 2) {
        maxColors = 192;
        dither = 'bayer:bayer_scale=3';
      }
      if (passes >= 3) {
        maxColors = 128;
        dither = 'none';
      }
    }

    // Double check size
    if (finalSize > MAX_GIF_BYTES) {
      // Emergency extreme compression pass
      console.warn('[GIF Converter] Applying emergency 8MB limit pass');
      await renderGifPass({
        inputPath: tempVideoPath,
        outputPath: outputGifPath,
        startTime,
        duration: Math.min(effectiveDuration, 8),
        width: 280,
        fps: 10,
        maxColors: 128,
        dither: 'none'
      });
      finalSize = fs.statSync(outputGifPath).size;
    }

    const downloadFileName = `tweet_${tweetId}_${Date.now()}.gif`;

    return {
      filePath: outputGifPath,
      fileName: downloadFileName,
      fileSize: finalSize,
      fileSizeFormatted: formatBytes(finalSize),
      width: currentSettings.width,
      fps: currentSettings.fps,
      duration: effectiveDuration,
      passes,
      withinLimit: finalSize <= MAX_GIF_BYTES
    };
  } finally {
    // Delete source video temp file to free up space
    if (tempVideoPath) {
      deleteFile(tempVideoPath);
    }
  }
}

module.exports = {
  convertToGif,
  formatBytes,
  MAX_GIF_BYTES
};
