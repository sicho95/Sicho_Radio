// V4: Fix Sample Rate Resampling
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
const channelEl = el('channel');

let ws = null;
let audioCtx = null;
let captureNode = null;
let captureSource = null;
let captureStream = null;
let playbackNode = null;

function log(msg) {
  const d = new Date().toLocaleTimeString();
  logEl.innerHTML += `<div><span style="color:#9ca3af">[${d}]</span> ${msg}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
}

function setStatus(s) {
  if (s === 'connected') {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'En ligne';
  } else {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = s === 'connecting' ? 'Connexion...' : 'Déconnecté';
  }
}

async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    try {
      await audioCtx.audioWorklet.addModule('./processors.js');
      log('Audio Engine Ready (' + audioCtx.sampleRate + 'Hz)');
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
  if (!(await initAudio())) return;

  try {
    captureStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    captureSource = audioCtx.createMediaStreamSource(captureStream);
    captureNode = new AudioWorkletNode(audioCtx, 'capture-processor');

    captureNode.port.onmessage = (e) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };

    captureSource.connect(captureNode);
    // Pas de connexion destination pour éviter retour

    pttBtn.classList.add('active');
    pttBtn.textContent = 'TRANSMISSION...';
  } catch (e) {
    log('Mic Error: ' + e.message);
    stopCapture();
  }
}

function stopCapture() {
  pttBtn.classList.remove('active');
  pttBtn.textContent = 'PTT';

  if (captureNode) { captureNode.disconnect(); captureNode = null; }
  if (captureSource) { captureSource.disconnect(); captureSource = null; }
  if (captureStream) { captureStream.getTracks().forEach(t => t.stop()); captureStream = null; }
}

function connect() {
  if (ws) return;
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';
  setStatus('connecting');
  connectBtn.disabled = true;

  ws.onopen = async () => {
    setStatus('connected');
    disconnectBtn.disabled = false;
    pttBtn.disabled = false;

    const ch = channelEl.value;
    ws.send(JSON.stringify({ type: 'join', channel: parseInt(ch), role: 'v4' }));

    await startPlayback();
  };

  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'ptt') {
          remotePttEl.textContent = m.state === 'start' ? 'Quelqu\'un parle...' : '';
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
    pttBtn.disabled = true;
    ws = null;
    if (playbackNode) { playbackNode.disconnect(); playbackNode = null; }
    stopCapture();
  };
}

connectBtn.onclick = connect;
disconnectBtn.onclick = () => ws && ws.close();

// Gestions Touch/Mouse PTT robustes
const start = (e) => { e.preventDefault(); startCapture(); };
const stop = (e) => { e.preventDefault(); stopCapture(); };

pttBtn.onmousedown = start;
pttBtn.onmouseup = stop;
pttBtn.onmouseleave = stop;

pttBtn.ontouchstart = start;
pttBtn.ontouchend = stop;
pttBtn.ontouchcancel = stop;
