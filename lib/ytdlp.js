const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Download audio using yt-dlp safely
 * @param {string} url
 * @returns {Promise<string>} - Path to the downloaded audio file
 */
async function downloadAudio(url) {
    return new Promise((resolve, reject) => {
        const filename = `audio_${Date.now()}.mp3`;
        const tmpDir = path.join(process.cwd(), 'tmp');
        const outputPath = path.join(tmpDir, filename);

        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir);
        }

        // Use spawn to avoid shell injection
        const args = ['-x', '--audio-format', 'mp3', '-o', outputPath, url];
        const ls = spawn('yt-dlp', args);

        ls.on('close', (code) => {
            if (code !== 0) {
                // Fallback: try without conversion if ffmpeg fails
                const fallbackPath = path.join(tmpDir, `audio_${Date.now()}.%(ext)s`);
                const fallbackArgs = ['-f', 'bestaudio', '-o', fallbackPath, url];
                const fb = spawn('yt-dlp', fallbackArgs);

                fb.on('close', (codeFb) => {
                    if (codeFb !== 0) return reject(new Error('Gagal mendownload audio.'));

                    const files = fs.readdirSync(tmpDir);
                    const baseName = path.basename(fallbackPath).split('.%(ext)s')[0];
                    const actualFile = files.find(f => f.startsWith(baseName));
                    if (actualFile) resolve(path.join(tmpDir, actualFile));
                    else reject(new Error('File tidak ditemukan.'));
                });
            } else {
                resolve(outputPath);
            }
        });

        ls.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Download video using yt-dlp safely
 * @param {string} url
 * @returns {Promise<string>} - Path to the downloaded video file
 */
async function downloadVideo(url) {
    return new Promise((resolve, reject) => {
        const filename = `video_${Date.now()}.mp4`;
        const tmpDir = path.join(process.cwd(), 'tmp');
        const outputPath = path.join(tmpDir, filename);

        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir);
        }

        const args = ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '-o', outputPath, url];
        const ls = spawn('yt-dlp', args);

        ls.on('close', (code) => {
            if (code !== 0) return reject(new Error('Gagal mendownload video.'));
            resolve(outputPath);
        });

        ls.on('error', (err) => {
            reject(err);
        });
    });
}

module.exports = { downloadAudio, downloadVideo };
