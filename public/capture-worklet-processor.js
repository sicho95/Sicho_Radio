// capture-worklet-processor.js
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.ratio = sampleRate / this.targetSampleRate;
    this.buffer = [];
    this.offset = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const float32 = input[0]; // mono

    // Downsample inline
    const newLen = Math.floor(float32.length / this.ratio);
    const pcm16 = new Int16Array(newLen);

    for (let i = 0; i < newLen; i++) {
      const nextOffset = Math.floor((i + 1) * this.ratio);
      let sum = 0;
      let count = 0;
      for (let j = this.offset; j < nextOffset && j < float32.length; j++) {
        sum += float32[j];
        count++;
      }
      this.offset = nextOffset;
      let s = count ? (sum / count) : 0;
      s = Math.max(-1, Math.min(1, s));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    this.offset -= float32.length;

    // Envoyer au main thread
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
