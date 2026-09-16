// Sound for the overview cinematic, synthesized with Web Audio so it needs no
// asset. To use a recorded "wow~" instead, put the file under public/ and set
// WOW_FILE to its path (e.g. "/overview/wow.mp3").

const WOW_FILE: string | null = null;

export type OverviewSound = {
  keyClick: (delaySeconds?: number) => void;
  whoosh: () => void;
  sparkle: () => void;
  wow: () => void;
  setMuted: (muted: boolean) => void;
  close: () => void;
};

export function createOverviewSound(): OverviewSound {
  const AudioCtor = typeof window === "undefined" ? undefined : window.AudioContext;
  const context = AudioCtor ? new AudioCtor() : null;
  const master = context?.createGain() ?? null;
  if (context && master) { master.gain.value = 0.55; master.connect(context.destination); }
  let muted = false;
  const wowFile = WOW_FILE && typeof Audio !== "undefined" ? new Audio(WOW_FILE) : null;

  const ready = () => {
    if (!context || !master || muted) return null;
    if (context.state === "suspended") void context.resume();
    return { context, master, now: context.currentTime };
  };

  const noise = (context: AudioContext, seconds: number) => {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    return source;
  };

  // One short noise burst reused for every key click.
  const clickBuffer = context ? (() => {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.04), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = (Math.random() * 2 - 1) * Math.exp(-index / (context.sampleRate * 0.006));
    return buffer;
  })() : null;

  return {
    keyClick(delaySeconds = 0) {
      const audio = ready(); if (!audio || !clickBuffer) return;
      const { context, master, now } = audio;
      const at = now + delaySeconds;
      const source = context.createBufferSource();
      source.buffer = clickBuffer;
      source.playbackRate.value = 0.8 + Math.random() * 0.5;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass"; filter.Q.value = 1.4;
      filter.frequency.value = 1_800 + Math.random() * 1_600;
      const gain = context.createGain();
      gain.gain.value = 0.35 + Math.random() * 0.25;
      source.connect(filter).connect(gain).connect(master);
      source.start(at);
    },
    whoosh() {
      const audio = ready(); if (!audio) return;
      const { context, master, now } = audio;
      const source = noise(context, 1.2);
      const filter = context.createBiquadFilter();
      filter.type = "bandpass"; filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(300, now);
      filter.frequency.exponentialRampToValueAtTime(4_000, now + 0.9);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.5, now + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
      source.connect(filter).connect(gain).connect(master);
      source.start(now); source.stop(now + 1.2);
    },
    sparkle() {
      const audio = ready(); if (!audio) return;
      const { context, master, now } = audio;
      [1318.5, 1760, 2093, 2637].forEach((frequency, index) => {
        const osc = context.createOscillator();
        osc.type = "triangle"; osc.frequency.value = frequency;
        const gain = context.createGain();
        const at = now + index * 0.07;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.18, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        osc.connect(gain).connect(master);
        osc.start(at); osc.stop(at + 0.55);
      });
    },
    wow() {
      if (muted) return;
      if (wowFile) { wowFile.currentTime = 0; void wowFile.play().catch(() => undefined); return; }
      const audio = ready(); if (!audio) return;
      const { context, master, now } = audio;
      // A voiced "w-a-u" glide: a buzzy source through two formant filters
      // that move from "oo" to "ah" and back, with a rising-falling pitch.
      const duration = 1.15;
      const voice = context.createOscillator();
      voice.type = "sawtooth";
      voice.frequency.setValueAtTime(170, now);
      voice.frequency.linearRampToValueAtTime(250, now + 0.45);
      voice.frequency.linearRampToValueAtTime(190, now + duration);
      const vibrato = context.createOscillator();
      const vibratoDepth = context.createGain();
      vibrato.frequency.value = 5.5; vibratoDepth.gain.value = 4;
      vibrato.connect(vibratoDepth).connect(voice.frequency);
      const output = context.createGain();
      output.gain.setValueAtTime(0.0001, now);
      output.gain.exponentialRampToValueAtTime(0.5, now + 0.12);
      output.gain.setValueAtTime(0.5, now + duration - 0.35);
      output.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      for (const [low, high, end, q] of [[320, 780, 360, 6], [800, 1180, 700, 8]] as const) {
        const formant = context.createBiquadFilter();
        formant.type = "bandpass"; formant.Q.value = q;
        formant.frequency.setValueAtTime(low, now);
        formant.frequency.linearRampToValueAtTime(high, now + 0.4);
        formant.frequency.linearRampToValueAtTime(end, now + duration);
        voice.connect(formant).connect(output);
      }
      output.connect(master);
      voice.start(now); vibrato.start(now);
      voice.stop(now + duration + 0.05); vibrato.stop(now + duration + 0.05);
    },
    setMuted(next) {
      muted = next;
      if (next) wowFile?.pause();
    },
    close() {
      wowFile?.pause();
      void context?.close().catch(() => undefined);
    },
  };
}
