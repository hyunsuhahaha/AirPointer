// Sound for the overview cinematic, synthesized with Web Audio so it needs no
// asset. To use a recorded "wow~" instead, put the file under public/ and set
// WOW_FILE to its path (e.g. "/overview/wow.mp3").

const WOW_FILE: string | null = null;

// A value that moves over time: [seconds from start, value] pairs.
type Path = [number, number][];
type Voice = { pitch: Path; formants: { q: number; path: Path }[]; gain: Path; vibrato?: number };

function follow(param: AudioParam, path: Path, start: number) {
  param.setValueAtTime(path[0][1], start + path[0][0]);
  for (const [at, value] of path.slice(1)) param.linearRampToValueAtTime(value, start + at);
}

// A cartoon voice: a buzzy source through formant filters whose centre
// frequencies trace the vowels, so "wow" and "yoohoo" read as words.
function speak(context: AudioContext, output: AudioNode, start: number, voice: Voice) {
  const end = start + voice.gain[voice.gain.length - 1][0] + 0.05;
  const source = context.createOscillator();
  source.type = "sawtooth";
  follow(source.frequency, voice.pitch, start);
  const vibrato = context.createOscillator();
  const vibratoDepth = context.createGain();
  vibrato.frequency.value = 5.5; vibratoDepth.gain.value = voice.vibrato ?? 4;
  vibrato.connect(vibratoDepth).connect(source.frequency);
  const level = context.createGain();
  level.gain.setValueAtTime(0.0001, start);
  for (const [at, value] of voice.gain) level.gain.linearRampToValueAtTime(value, start + at);
  for (const formant of voice.formants) {
    const filter = context.createBiquadFilter();
    filter.type = "bandpass"; filter.Q.value = formant.q;
    follow(filter.frequency, formant.path, start);
    source.connect(filter).connect(level);
  }
  level.connect(output);
  source.start(start); vibrato.start(start);
  source.stop(end); vibrato.stop(end);
}

export type OverviewSound = {
  keyClick: (delaySeconds?: number) => void;
  whoosh: () => void;
  ding: () => void;
  pop: () => void;
  swish: () => void;
  click: () => void;
  boing: () => void;
  shutter: () => void;
  yoohoo: () => void;
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
    swish() {
      const audio = ready(); if (!audio) return;
      const { context, master, now } = audio;
      const source = noise(context, 0.3);
      const filter = context.createBiquadFilter();
      filter.type = "bandpass"; filter.Q.value = 2;
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(5_000, now + 0.16);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.55, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      source.connect(filter).connect(gain).connect(master);
      source.start(now); source.stop(now + 0.3);
    },
    click() {
      const audio = ready(); if (!audio) return;
      const { context, master, now } = audio;
      const osc = context.createOscillator();
      osc.type = "square"; osc.frequency.value = 2_200;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      osc.connect(gain).connect(master);
      osc.start(now); osc.stop(now + 0.04);
    },
    shutter() {
      const audio = ready(); if (!audio) return;
      const { context, master, now } = audio;
      // A camera click: two short filtered noise snaps.
      for (const offset of [0, 0.07]) {
        const source = noise(context, 0.06);
        const filter = context.createBiquadFilter();
        filter.type = "highpass"; filter.frequency.value = 1_800;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.6, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.05);
        source.connect(filter).connect(gain).connect(master);
        source.start(now + offset); source.stop(now + offset + 0.06);
      }
    },
    boing() {
      const audio = ready(); if (!audio) return;
      const { context, master, now } = audio;
      // A spring: a falling pitch with a fast wobble.
      const osc = context.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.7);
      const wobble = context.createOscillator();
      const depth = context.createGain();
      wobble.frequency.value = 18; depth.gain.value = 40;
      wobble.connect(depth).connect(osc.frequency);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
      osc.connect(gain).connect(master);
      osc.start(now); wobble.start(now);
      osc.stop(now + 0.8); wobble.stop(now + 0.8);
    },
    pop() {
      const audio = ready(); if (!audio) return;
      const { context, master, now } = audio;
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(980, now + 0.09);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.45, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      osc.connect(gain).connect(master);
      osc.start(now); osc.stop(now + 0.18);
    },
    ding() {
      const audio = ready(); if (!audio) return;
      const { context, master, now } = audio;
      // "띠-링": two bell strikes, the second higher and left ringing.
      for (const [offset, frequency, decay] of [[0, 1318.5, 0.35], [0.11, 1760, 1.6]] as const) {
        const at = now + offset;
        for (const [ratio, level] of [[1, 0.32], [2.76, 0.08], [5.4, 0.03]] as const) {
          const osc = context.createOscillator();
          osc.type = "sine"; osc.frequency.value = frequency * ratio;
          const gain = context.createGain();
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(level, at + 0.004);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + decay / ratio);
          osc.connect(gain).connect(master);
          osc.start(at); osc.stop(at + decay / ratio + 0.02);
        }
      }
    },
    yoohoo() {
      const audio = ready(); if (!audio) return;
      const { context, master, now } = audio;
      // "yu" gliding up, a breathy "h", then a high bouncing "hoo~".
      speak(context, master, now, {
        pitch: [[0, 330], [0.3, 420]],
        formants: [{ q: 7, path: [[0, 280], [0.3, 330]] }, { q: 9, path: [[0, 2300], [0.16, 950], [0.3, 870]] }],
        gain: [[0.03, 0.5], [0.26, 0.45], [0.33, 0.0001]],
        vibrato: 3,
      });
      const breath = noise(context, 0.12);
      const breathFilter = context.createBiquadFilter();
      breathFilter.type = "bandpass"; breathFilter.frequency.value = 1_300; breathFilter.Q.value = 0.8;
      const breathGain = context.createGain();
      breathGain.gain.setValueAtTime(0.0001, now + 0.33);
      breathGain.gain.linearRampToValueAtTime(0.25, now + 0.37);
      breathGain.gain.linearRampToValueAtTime(0.0001, now + 0.44);
      breath.connect(breathFilter).connect(breathGain).connect(master);
      breath.start(now + 0.33); breath.stop(now + 0.45);
      speak(context, master, now + 0.4, {
        pitch: [[0, 520], [0.22, 760], [0.75, 640]],
        formants: [{ q: 7, path: [[0, 330], [0.75, 300]] }, { q: 9, path: [[0, 900], [0.75, 820]] }],
        gain: [[0.03, 0.55], [0.45, 0.5], [0.8, 0.0001]],
        vibrato: 9,
      });
    },
    wow() {
      if (muted) return;
      if (wowFile) { wowFile.currentTime = 0; void wowFile.play().catch(() => undefined); return; }
      const audio = ready(); if (!audio) return;
      // "w-a-u": vowels move from "oo" to "ah" and back, pitch rises and falls.
      speak(audio.context, audio.master, audio.now, {
        pitch: [[0, 170], [0.45, 250], [1.15, 190]],
        formants: [{ q: 6, path: [[0, 320], [0.4, 780], [1.15, 360]] }, { q: 8, path: [[0, 800], [0.4, 1180], [1.15, 700]] }],
        gain: [[0.12, 0.5], [0.8, 0.5], [1.15, 0.0001]],
      });
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
