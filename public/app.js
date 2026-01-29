// V8: Config Channels from JSON
const BACKEND = "https://mobile-avivah-sicho-96db3843.koyeb.app";
const WS_URL = BACKEND.replace(/^http/, 'ws') + '/ws';

const el = (id) => document.getElementById(id);
const logEl = el('log');
const statusText = el('statusText');
const statusDot = el('statusDot');
const remotePttEl = el('remotePtt');
const pttBtn = el('ptt');
const connectBtn = el('connect');
const disconnectBtn = el('disconnect');
const channelSelect = el('channelSelect');
const freqDisplay = el('freqDisplay');
const lockHint = el('lockHint');

let ws = null;
let audioCtx = null;
let captureNode = null;
let captureSource = null;
let captureStream = null;
let playbackNode = null;

let holdTimer = null;
let isLocked = false; 
let isTransmitting = false; 
const LOCK_DELAY_MS = 10000; 

// Channels Data
let channels = [];

function log(msg) {
  const d = new Date().toLocaleTimeString();
  logEl.innerHTML += `<div><span style="color:#9ca3af">[${d}]</span> ${msg}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
}

// LOAD CONFIG
async function loadConfig() {
  try {
    const r = await fetch('./channels.json');
    if (!r.ok) throw new Error('Config load failed');
    channels = await r.json();

    channelSelect.innerHTML = '';
    channels.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = ch.name;
      opt.dataset.freq = ch.freq;
      channelSelect.appendChild(opt);
    });

    channelSelect.disabled = false;
    updateFreq();
  } catch (e) {
    log('Erreur Config: ' + e.message);
    // Fallback
    channelSelect.innerHTML = '<option value="1">Canal 1 (Fallback)</option>';
    channelSelect.disabled = false;
  }
}

function updateFreq() {
  const opt = channelSelect.selectedOptions[0];
  if (opt && opt.dataset.freq) {
    freqDisplay.textContent = opt.dataset.freq;
  } else {
    freqDisplay.textContent = '---';
  }
}

channelSelect.addEventListener('change', updateFreq);

// INIT
loadConfig();

function setStatus(s) {
  if (s === 'connected') {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'En ligne';
  } else {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = s === 'connecting' ? 'Connexion...' : 'Hors ligne';
  }
}

async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    try {
      await audioCtx.audioWorklet.addModule('./processors.js');
      log('Audio Ready (' + audioCtx.sampleRate + 'Hz)');
    } catch (e) {
      log('Audio Init Fail: ' + e.message);
      return false;
    }
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  return true;
}

async function startPlayback() {
  if (!(await initAudio())) return;
  if (playbackNode) return;

  try {
    playbackNode = new AudioWorkletNode(audioCtx, 'playback-processor');
    playbackNode.connect(audioCtx.destination);
  } catch(e) { log('Playback Error: ' + e); }
}

async function startCapture() {
  if (ws?.readyState !== WebSocket.OPEN) return;
  if (isTransmitting) return;

  if (!(await initAudio())) return;

  try {
    if (!captureStream) {
      captureStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    }

    if (!captureNode) {
        captureSource = audioCtx.createMediaStreamSource(captureStream);
        captureNode = new AudioWorkletNode(audioCtx, 'capture-processor');
        captureNode.port.onmessage = (e) => {
          if (ws && ws.readyState === WebSocket.OPEN && isTransmitting) {
            ws.send(e.data);
          }
        };
        captureSource.connect(captureNode);
    }

    isTransmitting = true;
    ws.send(JSON.stringify({ type: 'ptt', state: 'start' }));

    pttBtn.classList.add('active');
    pttBtn.textContent = isLocked ? 'VERROUILLÉ (FULL DUPLEX)' : 'TRANSMISSION...';
  } catch (e) {
    log('Mic Error: ' + e.message);
    stopCapture(true); 
  }
}

function stopCapture(force = false) {
  if (isLocked && !force) return;

  isTransmitting = false; 
  pttBtn.classList.remove('active');
  pttBtn.classList.remove('locked');
  pttBtn.textContent = 'PTT';

  if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ptt', state: 'stop' }));
  }

  isLocked = false;
  lockHint.classList.remove('show');
}

function connect() {
  if (ws) return;
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';
  setStatus('connecting');
  connectBtn.disabled = true;
  channelSelect.disabled = true; // Lock chan selection

  ws.onopen = async () => {
    setStatus('connected');
    disconnectBtn.disabled = false;
    pttBtn.disabled = false;

    const ch = channelSelect.value;
    ws.send(JSON.stringify({ type: 'join', channel: parseInt(ch), role: 'v8' }));

    await startPlayback();
  };

  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'ptt') {
          remotePttEl.textContent = m.state === 'start' ? 'Réception en cours...' : '';
        }
      } catch {}
    } else {
      if (playbackNode) playbackNode.port.postMessage(e.data);
    }
  };

  ws.onclose = () => {
    setStatus('disconnected');
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    channelSelect.disabled = false;
    pttBtn.disabled = true;
    ws = null;
    isLocked = false;
    stopCapture(true);
  };
}

// HANDLERS
connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', () => ws && ws.close());
pttBtn.addEventListener('contextmenu', e => e.preventDefault());

const handlePress = (e) => {
  if (e.cancelable) e.preventDefault();
  if (isLocked) {
    stopCapture(true); 
    return;
  }
  startCapture();

  lockHint.textContent = `Maintiens ${LOCK_DELAY_MS/1000}s pour verrouiller`;
  lockHint.classList.add('show');

  holdTimer = setTimeout(() => {
    isLocked = true;
    pttBtn.classList.add('locked');
    pttBtn.textContent = 'VERROUILLÉ (Cliquer pour arrêter)';
    lockHint.textContent = 'Mode Full Duplex activé';
    if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
  }, LOCK_DELAY_MS);
};

const handleRelease = (e) => {
  if (e.cancelable) e.preventDefault();
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (isLocked) return; 
  stopCapture(); 
  lockHint.classList.remove('show');
};

pttBtn.addEventListener('touchstart', handlePress, { passive: false });
pttBtn.addEventListener('touchend', handleRelease);
pttBtn.addEventListener('touchcancel', handleRelease);
pttBtn.addEventListener('mousedown', (e) => {
  if (e.button === 0) handlePress(e);
});
pttBtn.addEventListener('mouseup', handleRelease);
pttBtn.addEventListener('mouseleave', handleRelease);
