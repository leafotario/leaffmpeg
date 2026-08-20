const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMP_DIR = path.join(__dirname, '..', '..', 'temp');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function getTempFilePath(extension = '.tmp') {
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  const filename = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  return path.join(TEMP_DIR, filename);
}

function deleteFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn(`[Cleanup] Failed to delete file ${filePath}:`, err.message);
  }
}

// Cleanup files older than maxAgeMs (default: 30 minutes)
function cleanOldFiles(maxAgeMs = 30 * 60 * 1000) {
  try {
    const now = Date.now();
    const files = fs.readdirSync(TEMP_DIR);

    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          console.log(`[Cleanup] Removed stale temp file: ${file}`);
        }
      } catch (err) {
        // file might be in use or already deleted
      }
    }
  } catch (err) {
    console.error('[Cleanup] Error during old files cleanup:', err.message);
  }
}

// Run cleanup every 15 minutes
setInterval(() => cleanOldFiles(), 15 * 60 * 1000);

module.exports = {
  TEMP_DIR,
  getTempFilePath,
  deleteFile,
  cleanOldFiles
};
