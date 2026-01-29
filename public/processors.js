// processors.js (V5 identique V4)
const TARGET_SAMPLE_RATE = 16000;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.remainder = 0; }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const inputData = input[0];
    const ratio = sampleRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.ceil((inputData.length - this.remainder) / ratio);
    const outputData = new Int16Array(outputLength);
    let outputIndex = 0;
    let inputIndex = this.remainder;
    while (inputIndex < inputData.length) {
      const center = Math.floor(inputIndex);
      let val = inputData[center];
      const s = Math.max(-1, Math.min(1, val));
      outputData[outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      inputIndex += ratio;
    }
    this.remainder = inputIndex - inputData.length;
    if (outputIndex > 0) {
      const buf = (outputIndex === outputLength) ? outputData.buffer : outputData.slice(0, outputIndex).buffer;
      this.port.postMessage(buf, [buf]);
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = TARGET_SAMPLE_RATE * 2; 
    this.buffer = new Float32Array(this.bufferSize);
    this.writePtr = 0;
    this.readPtr = 0;
    this.available = 0;
    this.minStart = TARGET_SAMPLE_RATE * 0.10; 
    this.isPlaying = false;
    this._readHead = 0;
    this.port.onmessage = (e) => {
      const int16 = new Int16Array(e.data);
      this.pushData(int16);
    };
  }
  pushData(int16Data) {
    for (let i = 0; i < int16Data.length; i++) {
      this.buffer[this.writePtr] = int16Data[i] / 32768.0;
      this.writePtr = (this.writePtr + 1) % this.bufferSize;
      this.available++;
      if (this.available > this.bufferSize) {
        this.readPtr = (this.readPtr + 1) % this.bufferSize;
        this.available = this.bufferSize;
      }
    }
  }
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const outputCh = output[0];
    const outputLen = outputCh.length;
    if (!this.isPlaying) {
      if (this.available >= this.minStart) {
        this.isPlaying = true; 
        this._readHead = this.readPtr; 
      } else {
        outputCh.fill(0);
        return true;
      }
    }
    const step = TARGET_SAMPLE_RATE / sampleRate;
    for (let i = 0; i < outputLen; i++) {
      if (this.available < 1) {
        outputCh[i] = 0;
        this.isPlaying = false;
        this.available = 0; 
        continue;
      }
      const idx = Math.floor(this._readHead);
      const frac = this._readHead - idx;
      const p1 = this.buffer[idx % this.bufferSize];
      const p2 = this.buffer[(idx + 1) % this.bufferSize];
      outputCh[i] = p1 + frac * (p2 - p1);
      this._readHead += step;
      while (this._readHead >= this.bufferSize) {
        this._readHead -= this.bufferSize;
      }
    }
    const dist = (this._readHead - this.readPtr);
    let advance = dist;
    if (advance < 0) advance += this.bufferSize;
    const consumed = Math.floor(advance);
    if (consumed > 0) {
      this.readPtr = (this.readPtr + consumed) % this.bufferSize;
      this.available -= consumed;
    }
    if (this.available < 0) { this.available = 0; this.isPlaying = false; }
    return true;
  }
}
registerProcessor('playback-processor', PlaybackProcessor);
