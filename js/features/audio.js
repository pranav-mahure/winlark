/**
 * Audio — everything is synthesized with the Web Audio API, so there are no
 * sound files to download and nothing depends on the network.
 *
 * Browsers block audio until the user interacts with the page; unlockAudio()
 * is called from the first pointer/key event and from every Start press.
 * Ambient sound has its own gain node, independent of the alarm volume.
 */
let ctx = null;
const buffers = new Map();
let amb = null; // { id, gain, nodes: [], timers: [] }

export function audioSupported() {
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
}

export function unlockAudio() {
  if (!audioSupported()) return false;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  } catch (err) {
    console.warn('[audio] could not start audio', err);
    return false;
  }
}

function ready() { return unlockAudio() && ctx; }

function outGain(volume) {
  const g = ctx.createGain();
  g.gain.value = Math.max(0, Math.min(1, volume / 100));
  g.connect(ctx.destination);
  return g;
}

function tone({ freq, type = 'sine', start, dur, peak = 0.5, dest, attack = 0.005 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g); g.connect(dest);
  o.start(start); o.stop(start + dur + 0.05);
}

/** Completion sounds. */
export function playAlarm(id = 'bell', volume = 80) {
  if (id === 'none' || volume <= 0 || !ready()) return;
  const dest = outGain(volume);
  const t0 = ctx.currentTime + 0.02;
  if (id === 'bell') {
    for (const off of [0, 1.1]) {
      tone({ freq: 880, start: t0 + off, dur: 2.2, peak: 0.45, dest });
      tone({ freq: 880 * 2.76, start: t0 + off, dur: 1.2, peak: 0.12, dest });
      tone({ freq: 880 * 5.4, start: t0 + off, dur: 0.5, peak: 0.05, dest });
    }
  } else if (id === 'digital') {
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 4; i++) tone({ freq: 1046, type: 'square', start: t0 + r * 0.9 + i * 0.16, dur: 0.09, peak: 0.12, dest, attack: 0.002 });
    }
  } else if (id === 'chime') {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone({ freq: f, type: 'triangle', start: t0 + i * 0.18, dur: 1.4, peak: 0.3, dest }));
  }
}

export function playTick(volume = 80) {
  if (volume <= 0 || !ready()) return;
  const dest = outGain(volume * 0.35);
  tone({ freq: 1900, type: 'sine', start: ctx.currentTime + 0.001, dur: 0.035, peak: 0.25, dest, attack: 0.001 });
}

// ---------- ambient ----------
function noiseBuffer(kind) {
  if (buffers.has(kind)) return buffers.get(kind);
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.35;
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
  } else { // pink (Paul Kellet's economy filter)
    let b0 = 0; let b1 = 0; let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
  }
  // Smooth the loop seam.
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) { const k = i / fade; d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k; }
  buffers.set(kind, buf);
  return buf;
}

function loopSource(kind, dest, filters = []) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(kind);
  src.loop = true;
  let node = src;
  for (const f of filters) {
    const bq = ctx.createBiquadFilter();
    bq.type = f.type; bq.frequency.value = f.freq; if (f.q) bq.Q.value = f.q;
    node.connect(bq); node = bq;
  }
  const g = ctx.createGain();
  g.gain.value = filters.gain ?? 1;
  node.connect(g); g.connect(dest);
  src.start();
  return { src, gain: g };
}

/** Schedules short random events (drops, crackles, cup clinks) a little ahead of time. */
function scatter(dest, { every, burst }) {
  let nextAt = ctx.currentTime + 0.1;
  const timer = setInterval(() => {
    const horizon = ctx.currentTime + 0.5;
    while (nextAt < horizon) {
      burst(nextAt, dest);
      nextAt += every();
    }
  }, 200);
  return timer;
}

function noiseBurst(at, dest, { dur, freq, type = 'highpass', peak }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer('white');
  const bq = ctx.createBiquadFilter();
  bq.type = type; bq.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bq); bq.connect(g); g.connect(dest);
  src.start(at, Math.random() * 3); src.stop(at + dur + 0.02);
}

const AMBIENT_BUILDERS = {
  white(dest) { return { nodes: [loopSource('white', dest, [{ type: 'lowpass', freq: 9000 }])] }; },
  brown(dest) { return { nodes: [loopSource('brown', dest, [{ type: 'lowpass', freq: 1200 }])] }; },
  rain(dest) {
    const bed = loopSource('pink', dest, [{ type: 'highpass', freq: 500 }, { type: 'lowpass', freq: 7000 }]);
    const timer = scatter(dest, {
      every: () => 0.015 + Math.random() * 0.07,
      burst: (at, d) => noiseBurst(at, d, { dur: 0.02 + Math.random() * 0.03, freq: 2500 + Math.random() * 4000, peak: 0.04 + Math.random() * 0.08 }),
    });
    return { nodes: [bed], timers: [timer] };
  },
  cafe(dest) {
    const murmur = loopSource('brown', dest, [{ type: 'bandpass', freq: 450, q: 0.6 }, { type: 'lowpass', freq: 1800 }]);
    murmur.gain.gain.value = 1.6;
    const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.23; lfoGain.gain.value = 0.35;
    lfo.connect(lfoGain); lfoGain.connect(murmur.gain.gain); lfo.start();
    const chatter = loopSource('pink', dest, [{ type: 'bandpass', freq: 1100, q: 1.2 }]);
    chatter.gain.gain.value = 0.35;
    const timer = scatter(dest, {
      every: () => 1.2 + Math.random() * 4,
      burst: (at, d) => tone({ freq: 2200 + Math.random() * 1800, type: 'sine', start: at, dur: 0.25 + Math.random() * 0.3, peak: 0.03 + Math.random() * 0.04, dest: d, attack: 0.002 }),
    });
    return { nodes: [murmur, chatter, { src: lfo }], timers: [timer] };
  },
  fire(dest) {
    const rumble = loopSource('brown', dest, [{ type: 'lowpass', freq: 600 }]);
    rumble.gain.gain.value = 1.2;
    const hiss = loopSource('pink', dest, [{ type: 'highpass', freq: 3000 }]);
    hiss.gain.gain.value = 0.12;
    const timer = scatter(dest, {
      every: () => 0.03 + Math.random() * 0.35,
      burst: (at, d) => noiseBurst(at, d, { dur: 0.004 + Math.random() * 0.02, freq: 1200 + Math.random() * 3000, peak: 0.1 + Math.random() * 0.35 }),
    });
    return { nodes: [rumble, hiss], timers: [timer] };
  },
  waves(dest) {
    const surf = loopSource('pink', dest, [{ type: 'lowpass', freq: 1400 }]);
    surf.gain.gain.value = 0.55;
    const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.085; lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain); lfoGain.connect(surf.gain.gain); lfo.start();
    const deep = loopSource('brown', dest, [{ type: 'lowpass', freq: 300 }]);
    deep.gain.gain.value = 0.7;
    return { nodes: [surf, deep, { src: lfo }] };
  },
};

export function startAmbient(id, volume = 45) {
  if (amb?.id === id) { setAmbientVolume(volume); return true; }
  stopAmbient();
  if (!id || id === 'none' || !AMBIENT_BUILDERS[id] || !ready()) return false;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume / 100 * 0.8), ctx.currentTime + 1.2);
  gain.connect(ctx.destination);
  const built = AMBIENT_BUILDERS[id](gain);
  amb = { id, gain, nodes: built.nodes || [], timers: built.timers || [] };
  return true;
}

export function setAmbientVolume(volume) {
  if (!amb || !ctx) return;
  amb.gain.gain.setTargetAtTime(Math.max(0.0001, volume / 100 * 0.8), ctx.currentTime, 0.1);
}

export function stopAmbient() {
  if (!amb) return;
  const a = amb; amb = null;
  for (const t of a.timers) clearInterval(t);
  try {
    a.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
    setTimeout(() => {
      for (const n of a.nodes) { try { n.src?.stop(); } catch { /* already stopped */ } }
      a.gain.disconnect();
    }, 700);
  } catch { /* context closed */ }
}

export function ambientPlaying() { return amb?.id || null; }
