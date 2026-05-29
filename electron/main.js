const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let ffmpegChild = null;
let currentTempPath = null;

function getFfmpegPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  }
  return path.join(__dirname, '..', 'ffmpeg.exe');
}

function defaultOutputBasename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `recording_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.mp4`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 520,
    minWidth: 480,
    minHeight: 420,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'M3U8 Downloader',
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', payload);
  }
}

function killFfmpeg() {
  if (ffmpegChild && !ffmpegChild.killed) {
    try {
      ffmpegChild.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    ffmpegChild = null;
  }
}

function cleanupTemp() {
  if (currentTempPath) {
    try {
      if (fs.existsSync(currentTempPath)) fs.unlinkSync(currentTempPath);
    } catch {
      /* ignore */
    }
    currentTempPath = null;
  }
}

function runFfmpeg(ffmpeg, args, onStderr) {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    ffmpegChild = child;
    child.stderr.on('data', (chunk) => onStderr(chunk.toString()));
    child.on('error', (err) => {
      ffmpegChild = null;
      resolve({ code: -1, signal: null, error: err.message || String(err) });
    });
    child.on('close', (code, signal) => {
      ffmpegChild = null;
      resolve({ code, signal, error: null });
    });
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  killFfmpeg();
  cleanupTemp();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killFfmpeg();
  cleanupTemp();
});

ipcMain.handle('pick-save-folder', async () => {
  const defaultPath = app.getPath('downloads');
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '저장 폴더',
    defaultPath,
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths || !filePaths[0]) return null;
  return filePaths[0];
});

ipcMain.handle('open-folder', async (_e, targetPath) => {
  if (!targetPath) return;
  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    const dir = stat.isDirectory() ? targetPath : path.dirname(targetPath);
    await shell.openPath(dir);
    return;
  }
  const parent = path.dirname(targetPath);
  if (fs.existsSync(parent)) await shell.openPath(parent);
});

ipcMain.handle('start-download', async (_event, { url, outputDir }) => {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'M3U8 주소(URL)를 입력해 주세요.' };
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return { ok: false, error: 'http:// 또는 https:// 로 시작하는 주소를 입력해 주세요.' };
  }
  const dir = (outputDir || '').trim();
  if (!dir) {
    return { ok: false, error: '저장할 폴더를 선택해 주세요.' };
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, error: '선택한 폴더를 찾을 수 없습니다. 다시 선택해 주세요.' };
  }

  const ffmpeg = getFfmpegPath();
  if (!fs.existsSync(ffmpeg)) {
    return {
      ok: false,
      error: `FFmpeg를 찾을 수 없습니다.\n예상 경로: ${ffmpeg}`,
    };
  }

  const outputPath = path.join(dir, defaultOutputBasename());
  const tempPath = `${outputPath}.part.ts`;
  sendProgress({ type: 'saveAs', baseName: path.basename(outputPath) });

  killFfmpeg();
  cleanupTemp();
  currentTempPath = tempPath;

  const timeRe = /time=(\d+):(\d+):(\d+\.\d+)/;
  const handleStderr = (phase) => (text) => {
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const m = line.match(timeRe);
      if (m) {
        sendProgress({ type: 'time', time: `${m[1]}:${m[2]}:${m[3]}`, phase });
      }
    }
    sendProgress({ type: 'log', line: text.trimEnd() });
  };

  // Phase 1: HLS → MPEG-TS (TS muxer normalizes the discontinuity-induced
  // PTS jumps that come from concatenated fMP4 sources).
  const dlArgs = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-stats',
    '-y',
    '-fflags', '+genpts',
    '-i', trimmed,
    '-c', 'copy',
    '-bsf:v', 'h264_mp4toannexb',
    '-f', 'mpegts',
    tempPath,
  ];

  const dl = await runFfmpeg(ffmpeg, dlArgs, handleStderr('download'));

  if (dl.error) {
    cleanupTemp();
    return { ok: false, error: dl.error };
  }
  if (dl.signal === 'SIGTERM') {
    cleanupTemp();
    return { ok: false, error: '사용자에 의해 중지되었습니다.' };
  }
  if (dl.code !== 0) {
    cleanupTemp();
    return {
      ok: false,
      error: `FFmpeg 다운로드가 비정상 종료했습니다 (코드 ${dl.code}).\n네트워크·URL·DRM 여부를 확인해 주세요.`,
    };
  }

  // Phase 2: MPEG-TS → MP4 (fast remux, normalized timestamps preserved).
  sendProgress({ type: 'log', line: '[mux] MP4로 마무리 중…' });
  const muxArgs = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-stats',
    '-y',
    '-i', tempPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    outputPath,
  ];

  const mux = await runFfmpeg(ffmpeg, muxArgs, handleStderr('mux'));

  cleanupTemp();

  if (mux.error) {
    return { ok: false, error: mux.error };
  }
  if (mux.signal === 'SIGTERM') {
    return { ok: false, error: '사용자에 의해 중지되었습니다.' };
  }
  if (mux.code !== 0) {
    return {
      ok: false,
      error: `FFmpeg MP4 변환이 비정상 종료했습니다 (코드 ${mux.code}).`,
    };
  }

  return { ok: true, outputPath };
});

ipcMain.handle('cancel-download', async () => {
  killFfmpeg();
  cleanupTemp();
  return { ok: true };
});
