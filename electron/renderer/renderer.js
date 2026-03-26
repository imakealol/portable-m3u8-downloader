const urlInput = document.getElementById('url');
const saveFolderInput = document.getElementById('saveFolder');
const browseBtn = document.getElementById('browseBtn');
const downloadBtn = document.getElementById('downloadBtn');
const cancelBtn = document.getElementById('cancelBtn');
const statusText = document.getElementById('statusText');
const timeLine = document.getElementById('timeLine');
const logBox = document.getElementById('logBox');
const openFolderBtn = document.getElementById('openFolderBtn');

let lastOutputPath = null;
let removeProgressListener = null;
let logLines = [];
let downloadBaseName = '';

function setBusy(busy) {
  downloadBtn.disabled = busy;
  browseBtn.disabled = busy;
  cancelBtn.disabled = !busy;
  urlInput.disabled = busy;
}

function setStatus(text) {
  statusText.textContent = text;
}

function appendLog(line) {
  const maxLines = 80;
  logLines.push(line);
  if (logLines.length > maxLines) logLines = logLines.slice(-maxLines);
  logBox.textContent = logLines.join('\n');
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  logLines = [];
  logBox.textContent = '';
  timeLine.textContent = '';
  downloadBaseName = '';
}

browseBtn.addEventListener('click', async () => {
  const p = await window.api.pickSaveFolder();
  if (p) {
    saveFolderInput.value = p;
    openFolderBtn.disabled = false;
    lastOutputPath = null;
  }
});

downloadBtn.addEventListener('click', async () => {
  clearLog();
  const url = urlInput.value;
  const outputDir = saveFolderInput.value;
  setBusy(true);
  setStatus('다운로드 중…');
  openFolderBtn.disabled = true;

  if (removeProgressListener) {
    removeProgressListener();
    removeProgressListener = null;
  }
  removeProgressListener = window.api.onProgress((payload) => {
    if (payload.type === 'saveAs' && payload.baseName) {
      downloadBaseName = payload.baseName;
      timeLine.textContent = `파일명: ${downloadBaseName}`;
    } else if (payload.type === 'time') {
      const namePart = downloadBaseName ? `파일: ${downloadBaseName} · ` : '';
      timeLine.textContent = `${namePart}진행 시간: ${payload.time}`;
    } else if (payload.type === 'log' && payload.line) {
      appendLog(payload.line);
    }
  });

  const result = await window.api.startDownload(url, outputDir);

  if (removeProgressListener) {
    removeProgressListener();
    removeProgressListener = null;
  }

  setBusy(false);

  if (result.ok) {
    lastOutputPath = result.outputPath;
    setStatus('완료되었습니다.');
    openFolderBtn.disabled = false;
    timeLine.textContent = '';
  } else {
    setStatus('실패');
    appendLog(result.error || '알 수 없는 오류');
    if (lastOutputPath || saveFolderInput.value) openFolderBtn.disabled = false;
  }
});

cancelBtn.addEventListener('click', async () => {
  await window.api.cancelDownload();
});

openFolderBtn.addEventListener('click', async () => {
  const target = lastOutputPath || saveFolderInput.value;
  if (target) await window.api.openFolder(target);
});
