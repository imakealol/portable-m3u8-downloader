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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  killFfmpeg();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => killFfmpeg());

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
  sendProgress({ type: 'saveAs', baseName: path.basename(outputPath) });

  killFfmpeg();

  const args = [
    '-hide_banner',
    '-loglevel',
    'info',
    '-stats',
    '-y',
    '-i',
    trimmed,
    '-c',
    'copy',
    outputPath,
  ];

  ffmpegChild = spawn(ffmpeg, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const timeRe = /time=(\d+):(\d+):(\d+\.\d+)/;

  ffmpegChild.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const m = line.match(timeRe);
      if (m) {
        sendProgress({ type: 'time', time: `${m[1]}:${m[2]}:${m[3]}` });
      }
    }
    sendProgress({ type: 'log', line: text.trimEnd() });
  });

  return new Promise((resolve) => {
    ffmpegChild.on('error', (err) => {
      ffmpegChild = null;
      resolve({ ok: false, error: err.message || String(err) });
    });

    ffmpegChild.on('close', (code, signal) => {
      ffmpegChild = null;
      if (code === 0) {
        resolve({ ok: true, outputPath });
      } else if (signal === 'SIGTERM') {
        resolve({ ok: false, error: '사용자에 의해 중지되었습니다.' });
      } else {
        resolve({
          ok: false,
          error: `FFmpeg가 비정상 종료했습니다 (코드 ${code}).\n네트워크·URL·DRM 여부를 확인해 주세요.`,
        });
      }
    });
  });
});

ipcMain.handle('cancel-download', async () => {
  killFfmpeg();
  return { ok: true };
});
