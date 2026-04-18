export function encodeWavMono16(buffer: AudioBuffer): Uint8Array {
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const channels = buffer.numberOfChannels;
  const bytesPerSample = 2;
  const numOutChannels = 1;
  const blockAlign = numOutChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const out = new Uint8Array(headerSize + dataSize);
  const view = new DataView(out.buffer);

  let o = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) out[o++] = s.charCodeAt(i);
  };
  writeStr("RIFF");
  view.setUint32(o, 36 + dataSize, true);
  o += 4;
  writeStr("WAVE");
  writeStr("fmt ");
  view.setUint32(o, 16, true);
  o += 4;
  view.setUint16(o, 1, true);
  o += 2;
  view.setUint16(o, numOutChannels, true);
  o += 2;
  view.setUint32(o, sampleRate, true);
  o += 4;
  view.setUint32(o, byteRate, true);
  o += 4;
  view.setUint16(o, blockAlign, true);
  o += 2;
  view.setUint16(o, 16, true);
  o += 2;
  writeStr("data");
  view.setUint32(o, dataSize, true);
  o += 4;

  for (let i = 0; i < numFrames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += buffer.getChannelData(c)[i];
    s /= Math.max(1, channels);
    s = Math.max(-1, Math.min(1, s));
    const v = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(o, v | 0, true);
    o += 2;
  }

  return out;
}
