// GitHub Pages => chemins relatifs + backend externe (Koyeb)
// Audio: PCM16 mono @ 16000 Hz (streaming temps réel via WebAudio)

const BACKEND = "https://mobile-avivah-sicho-96db3843.koyeb.app";
const WS_URL = BACKEND.replace(/^http/, 'ws') + '/ws';

const TARGET_SR = 16000;

const el = (id) => document.getElementById(id);
const logEl = el('log');
const statusEl = el('status');
const remotePttEl = el('remotePtt');
const wsUrlEl = el('wsUrl');
const backendUrlEl = el('backendUrl');
const backendStatusEl = el('backendStatus');

const channelEl = el('channel');
const connectBtn = el('connect');
const disconnectBtn = el('disconnect');
const pttBtn = el('ptt');

backendUrlEl.textContent = BACKEND;
wsUrlEl.textContent = WS_URL;

let ws = null;

// Audio capture
let mediaStream = null;
let audioCtx = null;
let micSource = null;
let processor = null;
let sending = false;

// Audio playback queue (remote)
let playCtx = null;
let nextPlayTime = 0;
let remoteTalking = false;

function log(...args) {
  logEl.textContent += args.join(' ') + '
';
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(s) {
  statusEl.textContent = s;
}

function wsSendJson(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

async function refreshBackendStatus() {
  try {
    const r = await fetch(BACKEND + '/api/status', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    backendStatusEl.textContent = j.status || 'ok';
  } catch {
    try {
      const r2 = await fetch(BACKEND + '/', { cache: 'no-store' });
      const j2 = await r2.json();
      backendStatusEl.textContent = j2.status || 'ok';
    } catch {
      backendStatusEl.textContent = 'unreachable';
    }
  }
}

async function ensurePlayContext() {
  if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (playCtx.state !== 'running') await playCtx.resume();
  return playCtx;
}

async function ensureCaptureContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== 'running') await audioCtx.resume();
  return audioCtx;
}

function downsampleToInt16(float32, inSampleRate, outSampleRate) {
  const ratio = inSampleRate / outSampleRate;
  const newLen = Math.floor(float32.length / ratio);
  const out = new Int16Array(newLen);

  let offset = 0;
  for (let i = 0; i < newLen; i++) {
    const nextOffset = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = offset; j < nextOffset && j < float32.length; j++) {
      sum += float32[j];
      count++;
    }
    offset = nextOffset;
    let s = count ? (sum / count) : 0;
    s = Math.max(-1, Math.min(1, s));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  return out;
}

async function startCaptureAndSend() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (sending) return;

  await ensureCaptureContext();

  if (!mediaStream) mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (!micSource) micSource = audioCtx.createMediaStreamSource(mediaStream);

  const bufferSize = 2048;
  processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

  processor.onaudioprocess = (e) => {
    if (!sending || !ws || ws.readyState !== WebSocket.OPEN) return;

    const input = e.inputBuffer.getChannelData(0);
    const pcm16 = downsampleToInt16(input, audioCtx.sampleRate, TARGET_SR);
    if (pcm16.length === 0) return;

    ws.send(pcm16.buffer);
  };

  micSource.connect(processor);
  processor.connect(audioCtx.destination);

  sending = true;
}

function stopCaptureAndSend() {
  sending = false;
  if (processor) {
    try { processor.disconnect(); } catch {}
    processor.onaudioprocess = null;
    processor = null;
  }
}

async function schedulePcmPlayback(arrayBuffer) {
  const ctx = await ensurePlayContext();
  const int16 = new Int16Array(arrayBuffer);
  if (int16.length === 0) return;

  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

  const audioBuffer = ctx.createBuffer(1, float32.length, TARGET_SR);
  audioBuffer.getChannelData(0).set(float32);

  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(ctx.destination);

  const startAt = Math.max(ctx.currentTime + 0.05, nextPlayTime || 0);
  src.start(startAt);
  nextPlayTime = startAt + audioBuffer.duration;
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  setStatus('connecting');
  connectBtn.disabled = true;

  ws.onopen = async () => {
    setStatus('connected');
    disconnectBtn.disabled = false;
    pttBtn.disabled = false;

    const channel = Math.max(1, Math.min(255, parseInt(channelEl.value, 10) || 1));
    wsSendJson({ type: 'join', channel, role: 'pwa' });

    await refreshBackendStatus();
    log('WS open, joined channel', channel);
  };

  ws.onmessage = (evt) => {
    if (typeof evt.data === 'string') {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'joined') log('Joined OK:', msg.channel);

        if (msg.type === 'ptt') {
          remotePttEl.textContent = msg.state || 'unknown';
          if (msg.state === 'start') {
            remoteTalking = true;
            nextPlayTime = 0;
          }
          if (msg.state === 'stop') remoteTalking = false;
        }
      } catch {}
      return;
    }

    if (remoteTalking) schedulePcmPlayback(evt.data).catch(() => {});
  };

  ws.onclose = () => {
    setStatus('disconnected');
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    pttBtn.disabled = true;
    remotePttEl.textContent = 'idle';
    remoteTalking = false;
    nextPlayTime = 0;
    log('WS closed');
  };

  ws.onerror = () => log('WS error');
}

function disconnect() {
  stopCaptureAndSend();
  if (ws) ws.close();
  ws = null;
}

async function startPtt() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  await ensurePlayContext();
  await ensureCaptureContext();

  wsSendJson({
    type: 'ptt',
    state: 'start',
    format: { encoding: 'pcm_s16le', sampleRate: TARGET_SR, channels: 1 }
  });

  await startCaptureAndSend();
  pttBtn.textContent = 'PARLE… (relâche pour stopper)';
}

function stopPtt() {
  wsSendJson({ type: 'ptt', state: 'stop' });
  stopCaptureAndSend();
  pttBtn.textContent = 'Maintiens pour parler (PTT)';
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);

pttBtn.addEventListener('contextmenu', (e) => e.preventDefault());
pttBtn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

pttBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  startPtt();
});
pttBtn.addEventListener('pointerup', (e) => {
  e.preventDefault();
  stopPtt();
});
pttBtn.addEventListener('pointercancel', stopPtt);
pttBtn.addEventListener('pointerleave', (e) => {
  if (e.buttons === 0) stopPtt();
});
