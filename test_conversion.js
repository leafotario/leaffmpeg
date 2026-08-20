const { convertToGif, MAX_GIF_BYTES, formatBytes } = require('./server/services/gifConverter');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function runTests() {
  console.log('--- TEST 1: Generate synthetic test video with FFmpeg ---');
  const tempInputVideo = path.join(__dirname, 'temp_test.mp4');
  
  // Generate 6-second synthetic test video
  spawnSync(ffmpegInstaller.path, [
    '-f', 'lavfi',
    '-i', 'testsrc=duration=6:size=1280x720:rate=30',
    '-pix_fmt', 'yuv420p',
    '-y', tempInputVideo
  ]);

  if (!fs.existsSync(tempInputVideo)) {
    throw new Error('Failed to generate test video');
  }
  console.log('Test video generated (1280x720 30fps 6s)');

  console.log('\n--- TEST 2: Convert Video to GIF (Default Auto Profile) ---');
  // We can pass local file URI or test conversion
  // Let's test renderGifPass directly and convertToGif
  const { getTempFilePath } = require('./server/utils/cleanup');
  const outputGif = getTempFilePath('.gif');

  const { convertToGif } = require('./server/services/gifConverter');
  
  // Let's spin up a small static test server or mock download
  const http = require('http');
  const server = http.createServer((req, res) => {
    fs.createReadStream(tempInputVideo).pipe(res);
  });
  
  await new Promise(r => server.listen(4567, r));
  const localUrl = 'http://localhost:4567/sample.mp4';

  const result = await convertToGif({
    videoUrl: localUrl,
    startTime: 0,
    duration: 6,
    quality: 'auto',
    tweetId: 'test12345'
  });

  server.close();
  fs.unlinkSync(tempInputVideo);

  console.log('Result:', {
    fileName: result.fileName,
    fileSize: result.fileSize,
    fileSizeFormatted: result.fileSizeFormatted,
    width: result.width,
    fps: result.fps,
    duration: result.duration,
    passes: result.passes,
    withinLimit: result.withinLimit
  });

  if (result.fileSize > MAX_GIF_BYTES) {
    throw new Error(`FAILURE: Result size ${result.fileSize} exceeded 8MB!`);
  }
  if (!fs.existsSync(result.filePath)) {
    throw new Error('FAILURE: Result GIF file does not exist on disk!');
  }

  console.log('✅ TEST PASSED: Converted GIF generated successfully under 8MB!');
  
  // Verify file magic bytes (GIF89a / GIF87a)
  const buffer = Buffer.alloc(6);
  const fd = fs.openSync(result.filePath, 'r');
  fs.readSync(fd, buffer, 0, 6, 0);
  fs.closeSync(fd);
  const header = buffer.toString('ascii');
  console.log('GIF Header Magic:', header);
  if (!header.startsWith('GIF8')) {
    throw new Error('Invalid GIF header!');
  }
  console.log('✅ VALID GIF CONFIRMED (Header: ' + header + ')');

  fs.unlinkSync(result.filePath);
  console.log('\n🎉 ALL CONVERSION & 8MB LIMIT TESTS PASSED! 🎉');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
