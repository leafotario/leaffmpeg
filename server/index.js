const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { extractTweetMedia } = require('./services/twitterExtractor');
const { convertToGif, formatBytes, MAX_GIF_BYTES } = require('./services/gifConverter');
const { deleteFile, cleanOldFiles } = require('./utils/cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// In-memory store for generated files
const generatedFiles = new Map();

/**
 * Route: Extract metadata and video stream from Tweet/X URL
 */
app.post('/api/extract', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Forneça uma URL válida do Twitter/X.' });
    }

    console.log(`[API] Extracting tweet: ${url}`);
    const mediaData = await extractTweetMedia(url);

    return res.json({
      success: true,
      data: mediaData
    });
  } catch (err) {
    console.error('[API] Extraction error:', err.message);
    return res.status(400).json({
      success: false,
      error: err.message || 'Erro ao extrair mídia do tweet.'
    });
  }
});

/**
 * Route: Convert video/GIF to optimized GIF <= 8MB
 */
app.post('/api/convert', async (req, res) => {
  try {
    const {
      url,
      videoUrl,
      tweetId,
      startTime,
      duration,
      quality = 'auto',
      customWidth,
      customFps
    } = req.body;

    let targetVideoUrl = videoUrl;
    let actualTweetId = tweetId || 'media';

    // If videoUrl not provided, extract it on the fly
    if (!targetVideoUrl && url) {
      const extracted = await extractTweetMedia(url);
      targetVideoUrl = extracted.bestVideoUrl;
      actualTweetId = extracted.id;
    }

    if (!targetVideoUrl) {
      return res.status(400).json({ error: 'Nenhuma URL de vídeo encontrada para converter.' });
    }

    console.log(`[API] Starting GIF conversion for tweet ${actualTweetId} (Quality: ${quality})`);

    const result = await convertToGif({
      videoUrl: targetVideoUrl,
      startTime,
      duration,
      quality,
      customWidth,
      customFps,
      tweetId: actualTweetId
    });

    const fileId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    generatedFiles.set(fileId, {
      filePath: result.filePath,
      fileName: result.fileName,
      createdAt: Date.now(),
      fileSize: result.fileSize
    });

    return res.json({
      success: true,
      fileId,
      fileName: result.fileName,
      fileSize: result.fileSize,
      fileSizeFormatted: result.fileSizeFormatted,
      downloadUrl: `/api/download/${fileId}`,
      previewUrl: `/api/preview/${fileId}`,
      width: result.width,
      fps: result.fps,
      duration: result.duration,
      passes: result.passes,
      withinLimit: result.withinLimit,
      maxLimitFormatted: '8.00 MB'
    });
  } catch (err) {
    console.error('[API] Conversion error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Erro durante a conversão do GIF.'
    });
  }
});

/**
 * Route: Direct download of converted GIF
 */
app.get('/api/download/:fileId', (req, res) => {
  const { fileId } = req.params;
  const fileData = generatedFiles.get(fileId);

  if (!fileData || !fs.existsSync(fileData.filePath)) {
    return res.status(404).send('Arquivo expirou ou não foi encontrado.');
  }

  res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
  res.setHeader('Content-Type', 'image/gif');

  const stream = fs.createReadStream(fileData.filePath);
  stream.pipe(res);
});

/**
 * Route: Inline preview of converted GIF
 */
app.get('/api/preview/:fileId', (req, res) => {
  const { fileId } = req.params;
  const fileData = generatedFiles.get(fileId);

  if (!fileData || !fs.existsSync(fileData.filePath)) {
    return res.status(404).send('GIF não encontrado.');
  }

  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const stream = fs.createReadStream(fileData.filePath);
  stream.pipe(res);
});

/**
 * Route: Health check
 */
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    maxSize: '8MB',
    timestamp: new Date().toISOString()
  });
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Periodic cleanup of in-memory files map
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of generatedFiles.entries()) {
    if (now - data.createdAt > 30 * 60 * 1000) {
      deleteFile(data.filePath);
      generatedFiles.delete(id);
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`⚡ Twitter/X GIF Downloader rodando!`);
  console.log(`🌐 Acesse: http://localhost:${PORT}`);
  console.log(`🎯 Limite estrito: 8MB por GIF`);
  console.log(`=========================================`);
});
