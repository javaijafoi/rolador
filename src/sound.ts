// Efeitos sonoros chiptune gerados na hora com WebAudio (sem arquivos de áudio).
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.06) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(vol, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.02);
}

export const sfx = {
  blip() {
    tone(880, 0, 0.05);
  },
  roll() {
    for (let i = 0; i < 7; i++) tone(180 + Math.random() * 500, i * 0.065, 0.045, 'square', 0.04);
  },
  land(t: string) {
    if (t === 'crit') [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.12));
    else if (t === 'fumble') [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.09, 0.14, 'sawtooth', 0.05));
    else if (t === 'good') [659, 880].forEach((f, i) => tone(f, i * 0.07, 0.1));
    else if (t === 'bad') [330, 247].forEach((f, i) => tone(f, i * 0.08, 0.12, 'triangle', 0.08));
    else tone(660, 0, 0.08);
  },
  error() {
    tone(140, 0, 0.18, 'sawtooth', 0.05);
  },
};
