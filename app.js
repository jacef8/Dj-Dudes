'use strict';

/* ==========================================================================
   DJ Dudes — two decks, two queues, a crossfader and automix.

   Audio graph (per deck):
     <audio> → low shelf → mid peak → high shelf → volume → crossfade gain → master
   The crossfade gains are automated on the audio thread, so fades stay smooth
   even if the window is minimised.
   ========================================================================== */

const AUDIO_EXT = /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus|webm|wma|aiff?|alac)$/i;

const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function fmtTime(s) {
  if (!Number.isFinite(s)) return '--:--';
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function setStatus(msg) {
  $('#status').textContent = msg;
}

/* ---------- audio context ---------- */

const ctx = new (window.AudioContext || window.webkitAudioContext)();
const master = ctx.createGain();
master.connect(ctx.destination);

function resumeAudio() {
  if (ctx.state !== 'running') ctx.resume();
}

/* ---------- mixer state ---------- */

const state = {
  xfade: 0.5,      // 0 = full A, 1 = full B
  fade: null,      // { from, target, start, dur } while an automated fade runs
  fadeSec: 8,      // how long a fade takes
  startBefore: 10, // automix: seconds before the end of a song to start fading
  curve: 'power',
  automix: false,
  share: true,
  repeatAll: false, // finished songs go back to the end of their queue
  live: null,      // 'A' | 'B' — the deck automix considers "on air"
};

/** Gains for deck A and B at crossfader position x. */
function curveGains(x, curve = state.curve) {
  switch (curve) {
    case 'linear':
      return [1 - x, x];
    case 'cut':
      return [Math.min(1, (1 - x) / 0.15), Math.min(1, x / 0.15)];
    default: // equal power: total loudness stays constant through the fade
      return [Math.cos(x * Math.PI / 2), Math.sin(x * Math.PI / 2)];
  }
}

/* ---------- tracks ---------- */

let nextTrackId = 1;

/**
 * A song. It has a `file` (picked or dropped this session, or restored from a
 * browser-saved playlist) and/or a `path` on disk (desktop app only).
 */
function makeTrack({ file = null, path = '', youtubeId = '', name = '', duration = NaN }) {
  const fileName = youtubeId ? 'YouTube' : file ? file.name : path.split(/[\\/]/).pop();
  const track = {
    id: nextTrackId++,
    file,
    path,
    youtubeId,
    fileName,
    name: name || fileName.replace(/\.[^.]+$/, ''),
    duration,
    peaks: null,
  };
  if (file && !Number.isFinite(duration)) probeDuration(track);
  return track;
}

/** A queue entry for a YouTube song; the real title is looked up in the background. */
function makeYouTubeTrack(id, name = '') {
  const track = makeTrack({ youtubeId: id, name: name || 'YouTube song' });
  if (!name) {
    fetchYouTubeTitle(id).then(title => {
      track.name = title;
      renderQueues();
      for (const d of Object.values(decks)) if (d.track === track) d.ui.title.textContent = title;
    }).catch(() => { /* keep the placeholder */ });
  }
  return track;
}

/** The song's audio data, read from disk if needed. */
async function trackBlob(track) {
  if (track.file) return track.file;
  if (!window.native) throw new Error('file is not available');
  return new Blob([await window.native.readFile(track.path)]);
}

function probeDuration(track) {
  const probe = new Audio();
  const url = URL.createObjectURL(track.file);
  const done = () => URL.revokeObjectURL(url);
  probe.preload = 'metadata';
  probe.onloadedmetadata = () => {
    track.duration = probe.duration;
    done();
    renderQueues();
  };
  probe.onerror = done;
  probe.src = url;
}

// Decode one file at a time so a big folder drop doesn't eat all memory.
let decodeChain = Promise.resolve();

function computePeaks(track, blob, buckets = 1200) {
  if (track.peaks) return Promise.resolve(track.peaks);
  decodeChain = decodeChain.then(async () => {
    if (track.peaks) return track.peaks;
    try {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const l = buf.getChannelData(0);
      const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
      const step = Math.max(1, Math.floor(l.length / buckets));
      const peaks = new Float32Array(buckets);
      let max = 0;
      for (let i = 0; i < buckets; i++) {
        let p = 0;
        const end = Math.min(l.length, (i + 1) * step);
        for (let j = i * step; j < end; j += 4) {
          const v = Math.max(Math.abs(l[j]), Math.abs(r[j]));
          if (v > p) p = v;
        }
        peaks[i] = p;
        if (p > max) max = p;
      }
      if (max > 0) for (let i = 0; i < buckets; i++) peaks[i] /= max;
      track.peaks = peaks;
    } catch (err) {
      console.warn('Could not draw waveform for', track.name, err);
    }
    return track.peaks;
  });
  return decodeChain;
}

/* ---------- decks ---------- */

class Deck {
  constructor(id) {
    this.id = id;
    this.queue = [];
    this.track = null;
    this.url = null;
    this.cuePoint = 0;
    this.meterLevel = 0;
    this.history = [];      // songs this deck played before, for BACK
    this.ready = false;     // audio source attached
    this.playWhenReady = false;

    this.loop = false;
    this.rate = 1;          // pitch slider
    this.volume = 1;        // channel fader

    // Audio chain (files). YouTube songs play in YouTube's own player instead.
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.preservesPitch = false; // pitch slider behaves like a turntable
    this.el = this.audio;   // whichever is in use: this.audio or this.yt
    const src = ctx.createMediaElementSource(this.audio);
    this.low = this.makeFilter('lowshelf', 250);
    this.mid = this.makeFilter('peaking', 1000);
    this.mid.Q.value = 0.8;
    this.high = this.makeFilter('highshelf', 4000);
    this.vol = ctx.createGain();
    this.xf = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.meterBuf = new Float32Array(this.analyser.fftSize);
    src.connect(this.low).connect(this.mid).connect(this.high).connect(this.vol).connect(this.xf).connect(master);
    this.xf.connect(this.analyser);
    // Visualizer listens before the crossfader, so you can see a deck you can't hear yet.
    this.vizAnalyser = ctx.createAnalyser();
    this.vizAnalyser.fftSize = 512;
    this.vizAnalyser.smoothingTimeConstant = 0.75;
    this.vizBuf = new Uint8Array(this.vizAnalyser.frequencyBinCount);
    this.vizBars = new Float32Array(48);
    this.vol.connect(this.vizAnalyser);

    this.buildDeckUI($(`.deck[data-deck="${id}"]`));
    this.buildQueueUI($(`.queue[data-deck="${id}"]`));

    this.yt = new YouTubeMedia($('.yt-host', this.root));
    this.bindMedia(this.audio);
    this.bindMedia(this.yt);
  }

  bindMedia(media) {
    const active = () => media === this.el;
    media.addEventListener('play', () => active() && this.renderState());
    media.addEventListener('pause', () => active() && this.renderState());
    media.addEventListener('ended', () => {
      if (!active()) return;
      this.renderState();
      automixTick();
    });
    media.addEventListener('error', () => {
      if (!active() || !this.track) return;
      this.fail(media === this.yt ? this.yt.errorMessage : 'unsupported file?');
    });
  }

  /** A song couldn't be played: skip it without ever cutting the music that's on. */
  fail(why) {
    const track = this.track;
    setStatus(`Deck ${this.id}: can't play "${track ? track.name : 'that song'}" (${why}) — skipping.`);
    this.unload();
    // Keep it in the queue, marked, so it doesn't just vanish.
    if (track) {
      track.error = why;
      this.queue.push(track);
      renderQueues();
    }
    if (!this.track) this.loadNext(); // line up the next song instead of sitting empty
    // If we were fading over to this deck, swing straight back to the one still playing.
    if (state.fade && state.fade.target === this.side && this.other.isPlaying) {
      state.live = this.other.id;
      fadeTo(this.other.side, 0.3);
    }
    automixTick();
  }

  get isYouTube() { return this.el === this.yt; }

  /** Stop and clear both players. */
  resetMedia() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.yt.stop();
    this.el = this.audio;
    this.root.classList.remove('is-yt');
  }

  makeFilter(type, freq) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.gain.value = 0;
    return f;
  }

  get other() { return this.id === 'A' ? decks.B : decks.A; }
  get side() { return this.id === 'A' ? 0 : 1; }
  get isPlaying() { return !!this.track && !this.el.paused && !this.el.ended; }
  /** Nothing usable loaded: empty, or the loaded song already played to the end. */
  get isSpent() { return !this.track || this.el.ended; }
  /** Seconds of real time left, accounting for pitch. */
  get remaining() {
    const d = this.el.duration;
    if (!Number.isFinite(d)) return NaN;
    return (d - this.el.currentTime) / (this.el.playbackRate || 1);
  }
  /** Is this deck actually coming out of the speakers right now? */
  get isAudible() {
    return this.isPlaying && curveGains(state.xfade)[this.side] > 0.05 && this.vol.gain.value > 0.01;
  }

  /* ----- transport ----- */

  /** Remember the outgoing song so BACK can return to it. */
  retire(track) {
    if (!track) return;
    this.history.push(track);
    if (this.history.length > 100) this.history.shift();
  }

  load(track, { back = false } = {}) {
    track.error = null; // loading by hand retries a song that failed before
    if (!back && this.track && this.track !== track) {
      // With "repeat queues" on, the song being replaced goes to the back of the line.
      if (state.repeatAll) this.queue.push(this.track);
      this.retire(this.track);
    }
    this.resetMedia();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.ready = false;
    this.playWhenReady = false;
    this.track = track;
    this.cuePoint = 0;
    this.ui.title.textContent = track.name;
    this.ui.sub.textContent = 'Loading…';
    this.renderState();
    renderQueues();

    if (track.youtubeId) {
      this.loadYouTube(track);
      return;
    }

    const attach = blob => {
      if (this.track !== track) return; // something else got loaded meanwhile
      this.url = URL.createObjectURL(blob);
      this.audio.src = this.url;
      this.audio.load();
      this.audio.loop = this.loop;
      this.audio.defaultPlaybackRate = this.audio.playbackRate = this.rate;
      this.ready = true;
      this.audio.addEventListener('loadedmetadata', () => {
        if (this.track !== track) return;
        track.duration = this.audio.duration;
        this.ui.sub.textContent = `${fmtTime(this.audio.duration)} · ${track.fileName}`;
      }, { once: true });
      if (this.playWhenReady) this.start();
      computePeaks(track, blob).then(() => this.resizeCanvas());
    };
    if (track.file) {
      attach(track.file); // attach right away so play() works immediately
    } else {
      trackBlob(track).then(attach).catch(err => {
        if (this.track !== track) return;
        this.fail(`couldn't open the file: ${err.message}`);
      });
    }
  }

  loadYouTube(track) {
    this.el = this.yt;
    this.yt.loop = this.loop;
    this.root.classList.add('is-yt');
    this.ready = true; // the YouTube wrapper queues play() itself until the video is ready
    this.yt.addEventListener('loadedmetadata', () => {
      if (this.track !== track) return;
      track.duration = this.yt.duration;
      this.ui.sub.textContent = `${fmtTime(track.duration)} · YouTube`;
      renderQueues();
    }, { once: true });
    if (!youtubeSupported) {
      this.fail('YouTube songs only play in the desktop app');
      return;
    }
    this.yt.load(track.youtubeId).then(() => {
      if (this.track === track) this.ui.sub.textContent = 'YouTube';
    }).catch(err => {
      if (this.track === track) this.fail(err.message);
    });
  }

  /** YouTube songs bypass the mixer, so mirror the deck's volume onto the player. */
  syncYouTubeVolume() {
    if (!this.isYouTube) return;
    const x = state.fade ? currentFadePos()[0] : state.xfade;
    this.yt.setVolume(curveGains(x)[this.side] * this.volume * +$('#master').value);
  }

  /** Start playback now, or as soon as the song finishes loading from disk. */
  start() {
    if (!this.track) return;
    if (!this.ready) {
      this.playWhenReady = true;
      return;
    }
    this.playWhenReady = false;
    this.el.play().catch(err => {
      if (err.name !== 'AbortError') setStatus(`Deck ${this.id}: ${err.message}`);
    });
  }

  unload(requeue = false) {
    if (requeue && state.repeatAll && this.track) this.queue.push(this.track);
    if (requeue) this.retire(this.track);
    this.ready = false;
    this.playWhenReady = false;
    this.resetMedia();
    this.audio.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.track = null;
    this.ui.title.textContent = 'No track loaded';
    this.ui.sub.textContent = "Add songs to this deck's queue below";
    this.renderState();
  }

  /** Load the next song from this deck's queue (or the other one if sharing). */
  loadNext() {
    // Songs that already failed stay in the queue (marked ⚠) but are skipped.
    const take = q => {
      const i = q.findIndex(t => !t.error);
      return i < 0 ? undefined : q.splice(i, 1)[0];
    };
    let track = take(this.queue);
    if (!track && state.share) track = take(this.other.queue);
    // Repeat with only one song left: play it again.
    if (!track && state.repeatAll && this.track && this.el.ended) track = this.track;
    if (!track) return false;
    this.load(track);
    return true;
  }

  play() {
    resumeAudio();
    if (this.isSpent && !this.loadNext()) {
      setStatus(`Deck ${this.id}: queue is empty.`);
      return;
    }
    // If nothing else is playing, swing the crossfader over so you hear it.
    if (!this.other.isPlaying && curveGains(state.xfade)[this.side] < 0.5) {
      fadeTo(this.side, 0.25);
    }
    if (!this.other.isPlaying) state.live = this.id;
    this.start();
  }

  /** NEXT: skip to the next song, keep playing if we were. */
  next() {
    const wasPlaying = this.isPlaying;
    if (!this.loadNext()) {
      setStatus(`Deck ${this.id}: queue is empty.`);
      return;
    }
    if (wasPlaying) this.start();
  }

  /** BACK: restart the song, or (near its start) go to the previous one. */
  back() {
    if (!this.track) return;
    const wasPlaying = this.isPlaying;
    if (this.el.currentTime > 3 || !this.history.length) {
      this.el.currentTime = 0;
      if (!this.history.length) setStatus(`Deck ${this.id}: back to the start (no earlier song on this deck).`);
      return;
    }
    const prev = this.history.pop();
    // "Repeat queues" may have put it back in a queue already — take it out.
    for (const d of [decks.A, decks.B]) {
      const i = d.queue.indexOf(prev);
      if (i >= 0) d.queue.splice(i, 1);
    }
    this.queue.unshift(this.track); // the current song becomes "up next" again
    this.load(prev, { back: true });
    if (wasPlaying) this.start();
  }

  pause() { this.el.pause(); }

  toggle() { this.isPlaying ? this.pause() : this.play(); }

  cue() {
    if (!this.track) return;
    if (this.isPlaying) {
      this.el.pause();
      this.el.currentTime = this.cuePoint;
    } else {
      this.cuePoint = this.el.currentTime;
    }
  }

  confirmInterrupt() {
    return !this.isAudible ||
      confirm(`Deck ${this.id} is playing out loud right now. Replace the song anyway?`);
  }

  /* ----- UI ----- */

  buildDeckUI(root) {
    root.append($('#deck-tpl').content.cloneNode(true));
    this.root = root;
    this.ui = {
      title: $('.title', root),
      sub: $('.sub', root),
      wave: $('.wave', root),
      viz: $('.viz', root),
      elapsed: $('.elapsed', root),
      remain: $('.remain', root),
      pitchOut: $('.pitch-readout', root),
      play: $('.play', root),
      meter: $('.meter-fill', root),
    };
    $('.deck-letter', root).textContent = this.id;

    this.ui.play.addEventListener('click', () => this.toggle());
    $('.cue', root).addEventListener('click', () => this.cue());
    const loopBtn = $('.loop', root);
    loopBtn.addEventListener('click', () => {
      this.loop = !this.loop;
      this.audio.loop = this.yt.loop = this.loop;
      loopBtn.setAttribute('aria-pressed', String(this.loop));
      setStatus(this.loop
        ? `Deck ${this.id} will repeat this song until you turn REPEAT off or press FADE NOW.`
        : `Deck ${this.id} repeat off.`);
    });
    $('.next', root).addEventListener('click', () => {
      if (this.confirmInterrupt()) this.next();
    });
    $('.back', root).addEventListener('click', () => {
      // Restarting the song is harmless; only ask before swapping songs on air.
      if (this.el.currentTime > 3 || !this.history.length || this.confirmInterrupt()) this.back();
    });

    const bindSlider = (cls, apply) => {
      const input = $(cls, root);
      const defaultValue = input.value;
      input.addEventListener('input', () => apply(+input.value));
      input.addEventListener('dblclick', () => { input.value = defaultValue; apply(+defaultValue); });
    };
    bindSlider('.eq-high', v => this.high.gain.setTargetAtTime(v, ctx.currentTime, 0.02));
    bindSlider('.eq-mid', v => this.mid.gain.setTargetAtTime(v, ctx.currentTime, 0.02));
    bindSlider('.eq-low', v => this.low.gain.setTargetAtTime(v, ctx.currentTime, 0.02));
    bindSlider('.volume', v => {
      this.volume = v;
      this.vol.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    });
    bindSlider('.pitch', v => {
      this.rate = 1 + v / 100;
      this.audio.defaultPlaybackRate = this.audio.playbackRate = this.rate;
      this.ui.pitchOut.textContent = `${v > 0 ? '+' : v < 0 ? '' : '±'}${v.toFixed(1)}%`;
    });

    const canvas = this.ui.wave;
    canvas.addEventListener('click', e => {
      const d = this.el.duration;
      if (!Number.isFinite(d)) return;
      const rect = canvas.getBoundingClientRect();
      this.el.currentTime = clamp((e.clientX - rect.left) / rect.width, 0, 1) * d;
    });
    new ResizeObserver(() => this.resizeCanvas()).observe(canvas);
    new ResizeObserver(() => this.resizeCanvas()).observe(this.ui.viz);
    this.color = getComputedStyle(root).getPropertyValue('--c').trim();
  }

  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.ui.wave, this.ui.viz]) {
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
    }
  }

  /** Spectrum bars for file songs (YouTube songs show their video here instead). */
  drawVisualizer() {
    const c = this.ui.viz;
    const w = c.width, h = c.height;
    if (!w || !h || this.isYouTube || !c.offsetParent) return;
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);

    this.vizAnalyser.getByteFrequencyData(this.vizBuf);
    const bins = this.vizBuf;
    const n = this.vizBars.length;
    const playing = this.isPlaying;
    let bass = 0;
    for (let i = 0; i < n; i++) {
      // Log-spaced bands from ~100 Hz to ~16 kHz.
      const lo = Math.floor(2 * Math.pow(90, i / n));
      const hi = Math.max(lo + 1, Math.floor(2 * Math.pow(90, (i + 1) / n)));
      let v = 0;
      for (let b = lo; b < hi && b < bins.length; b++) v = Math.max(v, bins[b]);
      v = playing ? v / 255 : 0;
      // Rise fast, fall slowly.
      this.vizBars[i] = v > this.vizBars[i] ? v : this.vizBars[i] * 0.92;
      if (i < 4) bass += this.vizBars[i] / 4;
    }

    // Background glow that pulses with the bass.
    const glow = g.createRadialGradient(w / 2, h, 0, w / 2, h, h * 1.4);
    glow.addColorStop(0, this.color + Math.round(20 + bass * 70).toString(16).padStart(2, '0'));
    glow.addColorStop(1, 'transparent');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);

    const gap = Math.max(2, w / n * 0.25);
    const barW = w / n - gap;
    const floor = h * 0.78;
    const grad = g.createLinearGradient(0, floor, 0, 0);
    grad.addColorStop(0, this.color);
    grad.addColorStop(1, '#ffffff');
    for (let i = 0; i < n; i++) {
      const x = i * (barW + gap) + gap / 2;
      const bh = Math.max(2, this.vizBars[i] * floor * 0.95);
      g.fillStyle = grad;
      g.fillRect(x, floor - bh, barW, bh);
      // Reflection
      g.fillStyle = this.color + '33';
      g.fillRect(x, floor + 2, barW, bh * 0.25);
    }

    if (!this.track) {
      g.fillStyle = '#5a6070';
      g.font = `${Math.round(13 * (window.devicePixelRatio || 1))}px "Segoe UI", system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText('No song loaded', w / 2, h * 0.45);
    }
  }

  renderState() {
    this.root.classList.toggle('is-playing', this.isPlaying);
    this.ui.play.textContent = this.isPlaying ? '❚❚' : '▶';
  }

  drawFrame() {
    const { el, ui } = this;
    const d = el.duration;
    const t = el.currentTime;
    ui.elapsed.textContent = this.track ? fmtTime(t) : '0:00';
    ui.remain.textContent = this.track ? `-${fmtTime(this.remaining)}` : '-0:00';
    this.root.classList.toggle('is-live', this.isAudible);

    // Level meter with a little fall-off so it doesn't flicker.
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let peak = 0;
    for (let i = 0; i < this.meterBuf.length; i++) peak = Math.max(peak, Math.abs(this.meterBuf[i]));
    this.meterLevel = Math.max(peak, this.meterLevel * 0.9);
    ui.meter.style.height = `${Math.min(100, this.meterLevel * 100)}%`;

    this.drawVisualizer();

    // Waveform
    const c = ui.wave;
    const g = c.getContext('2d');
    const w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    if (!this.track || !w) return;
    const progress = Number.isFinite(d) && d > 0 ? t / d : 0;
    const playX = progress * w;
    const color = this.color;
    const peaks = this.track.peaks;
    if (peaks) {
      const mid = h / 2;
      const barW = Math.max(1, Math.floor(w / 400));
      for (let x = 0; x < w; x += barW + 1) {
        const p = peaks[Math.floor((x / w) * peaks.length)] || 0;
        const bh = Math.max(1, p * (h * 0.9));
        g.fillStyle = x < playX ? color : '#3a3f4c';
        g.fillRect(x, mid - bh / 2, barW, bh);
      }
    } else {
      g.fillStyle = '#3a3f4c';
      g.fillRect(0, h / 2 - 1, w, 2);
      g.fillStyle = color;
      g.fillRect(0, h / 2 - 1, playX, 2);
    }
    if (Number.isFinite(d) && d > 0 && this.cuePoint > 0) {
      g.fillStyle = '#ffd34d';
      g.fillRect((this.cuePoint / d) * w, 0, 2, h);
    }
    g.fillStyle = '#fff';
    g.fillRect(playX - 1, 0, 2, h);
  }

  buildQueueUI(root) {
    root.append($('#queue-tpl').content.cloneNode(true));
    this.qroot = root;
    this.qlist = $('.queue-list', root);
    $('.q-letter', root).textContent = this.id;

    const fileInput = $('.file-input', root);
    const folderInput = $('.folder-input', root);
    $('.add-files', root).addEventListener('click', () => fileInput.click());
    $('.add-folder', root).addEventListener('click', () => folderInput.click());
    $('.add-yt', root).addEventListener('click', () => showYouTubeDialog());
    const onPick = input => () => {
      const files = [...input.files].sort((a, b) =>
        (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }));
      this.addFiles(files);
      input.value = '';
    };
    fileInput.addEventListener('change', onPick(fileInput));
    folderInput.addEventListener('change', onPick(folderInput));

    $('.shuffle', root).addEventListener('click', () => {
      const q = this.queue;
      for (let i = q.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q[i], q[j]] = [q[j], q[i]];
      }
      renderQueues();
    });
    $('.clear', root).addEventListener('click', () => {
      if (this.queue.length && confirm(`Remove all ${this.queue.length} songs from Queue ${this.id}?`)) {
        this.queue.length = 0;
        renderQueues();
      }
    });

    // Drag & drop: files from the computer, or songs from either queue.
    root.addEventListener('dragover', e => {
      e.preventDefault();
      root.classList.add('drag-over');
      const li = e.target.closest('.q-item');
      this.qlist.querySelectorAll('.drop-before').forEach(n => n.classList.remove('drop-before'));
      if (li) li.classList.add('drop-before');
    });
    root.addEventListener('dragleave', e => {
      if (!root.contains(e.relatedTarget)) {
        root.classList.remove('drag-over');
        this.qlist.querySelectorAll('.drop-before').forEach(n => n.classList.remove('drop-before'));
      }
    });
    root.addEventListener('drop', async e => {
      e.preventDefault();
      root.classList.remove('drag-over');
      const before = e.target.closest('.q-item');
      this.qlist.querySelectorAll('.drop-before').forEach(n => n.classList.remove('drop-before'));
      let index = before ? this.queue.findIndex(t => t.id === +before.dataset.id) : this.queue.length;
      if (index < 0) index = this.queue.length;

      const moved = e.dataTransfer.getData('application/x-dj-track');
      if (moved) {
        const { from, id } = JSON.parse(moved);
        const src = decks[from].queue;
        const i = src.findIndex(t => t.id === id);
        if (i < 0) return;
        const [track] = src.splice(i, 1);
        if (src === this.queue && i < index) index--;
        this.queue.splice(index, 0, track);
        renderQueues();
        return;
      }
      // A link dragged from the browser's address bar or a YouTube page.
      if (!e.dataTransfer.files.length) {
        const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (text) addYouTubeLinks(text, this, index);
        return;
      }
      const files = await filesFromDrop(e.dataTransfer);
      this.addFiles(files, index);
    });
  }

  addFiles(files, index = this.queue.length) {
    const audio = files.filter(f => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/'));
    if (!audio.length) {
      if (files.length) setStatus('None of those files look like audio.');
      return;
    }
    this.queue.splice(index, 0, ...audio.map(file =>
      makeTrack({ file, path: window.native ? window.native.pathForFile(file) : '' })));
    setStatus(`Added ${audio.length} song${audio.length > 1 ? 's' : ''} to Queue ${this.id}.`);
    renderQueues();
    if (!this.track && !this.isPlaying) this.loadNext();
  }

  renderQueue() {
    const list = this.qlist;
    list.textContent = '';
    this.qroot.classList.toggle('has-items', this.queue.length > 0);
    const total = this.queue.reduce((s, t) => s + (Number.isFinite(t.duration) ? t.duration : 0), 0);
    const failed = this.queue.filter(t => t.error).length;
    $('.q-count', this.qroot).textContent = this.queue.length
      ? `${this.queue.length} song${this.queue.length > 1 ? 's' : ''} · ${fmtTime(total)}` +
        (failed ? ` · ⚠ ${failed} can't play` : '')
      : '';

    this.queue.forEach((track, i) => {
      const li = document.createElement('li');
      li.className = 'q-item' + (i === 0 ? ' up-next' : '') + (track.youtubeId ? ' is-yt' : '') +
        (track.error ? ' has-error' : '');
      li.draggable = true;
      li.dataset.id = track.id;
      li.title = `${track.youtubeId ? youtubeUrl(track.youtubeId) : track.path || track.fileName}\n` +
        (track.error ? `Can't play: ${track.error}. Double-click to try again.` : `Double-click to load on deck ${this.id}`);
      li.innerHTML = `
        <span class="q-num"></span>
        <span class="q-main"><span class="q-name"></span><span class="q-err"></span></span>
        <span class="q-dur"></span>
        <span class="q-btns">
          <button class="load" title="Load on deck ${this.id} now">Load</button>
          <button class="swap" title="Move to Queue ${this.other.id}">⇄</button>
          <button class="rm" title="Remove">✕</button>
        </span>`;
      $('.q-num', li).textContent = i + 1;
      $('.q-name', li).textContent = track.name;
      $('.q-err', li).textContent = track.error ? `⚠ Can't play: ${track.error}` : '';
      $('.q-dur', li).textContent = fmtTime(track.duration);

      const loadNow = () => {
        if (!this.confirmInterrupt()) return;
        this.queue.splice(this.queue.indexOf(track), 1);
        this.load(track);
      };
      li.addEventListener('dblclick', loadNow);
      $('.load', li).addEventListener('click', loadNow);
      $('.swap', li).addEventListener('click', () => {
        this.queue.splice(this.queue.indexOf(track), 1);
        this.other.queue.push(track);
        renderQueues();
      });
      $('.rm', li).addEventListener('click', () => {
        this.queue.splice(this.queue.indexOf(track), 1);
        renderQueues();
      });
      li.addEventListener('dragstart', e => {
        e.dataTransfer.setData('application/x-dj-track', JSON.stringify({ from: this.id, id: track.id }));
        e.dataTransfer.effectAllowed = 'move';
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      list.append(li);
    });
  }
}

/** Collect files from a drop, walking into dropped folders. */
async function filesFromDrop(dt) {
  const entries = [...dt.items]
    .map(item => item.webkitGetAsEntry && item.webkitGetAsEntry())
    .filter(Boolean);
  if (!entries.length) return [...dt.files];

  const out = [];
  const walk = async entry => {
    if (entry.isFile) {
      out.push(await new Promise((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child);
      } while (batch.length);
    }
  };
  for (const entry of entries) await walk(entry);
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

const decks = {};
decks.A = new Deck('A');
decks.B = new Deck('B');

function renderQueues() {
  decks.A.renderQueue();
  decks.B.renderQueue();
}

/* ---------- crossfader ---------- */

const xfaderInput = $('#xfader');

function setParamNow(param, value) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + 0.015); // tiny ramp avoids clicks
}

function applyXfade() {
  const [a, b] = curveGains(state.xfade);
  setParamNow(decks.A.xf.gain, a);
  setParamNow(decks.B.xf.gain, b);
  xfaderInput.value = state.xfade;
}

function currentFadePos() {
  const f = state.fade;
  const p = clamp((ctx.currentTime - f.start) / f.dur, 0, 1);
  return [f.from + (f.target - f.from) * p, p];
}

function cancelFade() {
  if (!state.fade) return;
  state.xfade = currentFadePos()[0];
  state.fade = null;
}

/** Move the crossfader by hand (or instantly). Stops any running fade. */
function setXfade(x) {
  cancelFade();
  state.xfade = clamp(x, 0, 1);
  applyXfade();
}

/** Glide the crossfader to `target` over `dur` seconds, scheduled on the audio thread. */
function fadeTo(target, dur) {
  cancelFade();
  const from = state.xfade;
  if (Math.abs(target - from) < 1e-3 || dur <= 0.05) {
    setXfade(target);
    return;
  }
  const now = ctx.currentTime;
  const start = now + 0.02;
  const n = Math.max(2, Math.round(dur * 60));
  const ca = new Float32Array(n);
  const cb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    [ca[i], cb[i]] = curveGains(from + (target - from) * (i / (n - 1)));
  }
  for (const [param, curve] of [[decks.A.xf.gain, ca], [decks.B.xf.gain, cb]]) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(curve[0], now);
    param.setValueCurveAtTime(curve, start, dur);
  }
  state.fade = { from, target, start, dur };
}

/** Called often: keeps the slider in sync with a running fade and finishes it. */
function updateFade() {
  if (!state.fade) return;
  const [pos, p] = currentFadePos();
  state.xfade = pos;
  xfaderInput.value = pos;
  if (p >= 1) {
    state.fade = null;
    // In automix, the deck we faded away from is finished with its song:
    // stop it and line up its next one.
    const silent = [decks.A, decks.B].find(d => curveGains(state.xfade)[d.side] < 1e-3);
    if (state.automix && silent && silent.isPlaying) {
      if (!silent.loadNext()) silent.unload(true);
    }
  }
}

/** Fade from whatever is playing over to `deck`, starting it if needed. */
function transitionTo(deck, dur = state.fadeSec) {
  resumeAudio();
  if (deck.isSpent && !deck.loadNext()) {
    setStatus(`Deck ${deck.id} has nothing to play — add songs to Queue ${deck.id}.`);
    return false;
  }
  if (!deck.isPlaying) {
    deck.start();
  }
  state.live = deck.id;
  fadeTo(deck.side, dur);
  setStatus(`Fading into deck ${deck.id}: ${deck.track.name}`);
  return true;
}

xfaderInput.addEventListener('input', () => {
  setXfade(+xfaderInput.value);
  const fav = state.xfade < 0.5 ? decks.A : decks.B;
  if (fav.isPlaying) state.live = fav.id;
});
xfaderInput.addEventListener('dblclick', () => setXfade(0.5));

$('#fade-a').addEventListener('click', () => transitionTo(decks.A));
$('#fade-b').addEventListener('click', () => transitionTo(decks.B));

/** The deck that isn't on air — where FADE NOW will take you. */
function nonLiveDeck() {
  const live = decks[state.live];
  if (live && live.isPlaying) return live.other;
  return state.xfade < 0.5 ? decks.B : decks.A;
}

const fadeNowBtn = $('#fade-now');
fadeNowBtn.addEventListener('click', () => transitionTo(nonLiveDeck()));

function updateFadeHint() {
  $('#fade-len-out').textContent = `${state.fadeSec}s`;
  $('#start-before-out').textContent = `${state.startBefore}s`;
  let hint = `Fade begins ${state.startBefore}s before each song ends`;
  if (state.startBefore < state.fadeSec) hint += ` (fades cut to ${state.startBefore}s)`;
  $('#start-before-hint').textContent = hint + '.';
}

const fadeLen = $('#fade-len');
fadeLen.addEventListener('input', () => {
  state.fadeSec = +fadeLen.value;
  updateFadeHint();
});

const startBefore = $('#start-before');
startBefore.addEventListener('input', () => {
  state.startBefore = +startBefore.value;
  updateFadeHint();
});

$('#curve').addEventListener('change', e => {
  state.curve = e.target.value;
  if (!state.fade) applyXfade();
});

$('#share').addEventListener('change', e => { state.share = e.target.checked; });
$('#repeat-all').addEventListener('change', e => { state.repeatAll = e.target.checked; });

$('#master').addEventListener('input', e => setParamNow(master.gain, +e.target.value));

/* ---------- automix ---------- */

const automixBtn = $('#automix');

function setAutomix(on, msg) {
  state.automix = on;
  automixBtn.setAttribute('aria-pressed', String(on));
  $('b', automixBtn).textContent = on ? 'ON' : 'OFF';
  if (msg) setStatus(msg);
  if (on) automixTick();
}

automixBtn.addEventListener('click', () => {
  resumeAudio();
  if (state.automix) {
    setAutomix(false, 'Automix off — you have the controls.');
    return;
  }
  const hasMusic = [decks.A, decks.B].some(d => !d.isSpent || d.queue.length);
  if (!hasMusic) {
    setStatus('Add some songs to Queue A or Queue B first.');
    return;
  }
  // Pick up whatever is already playing as the live deck.
  const playing = [decks.A, decks.B].filter(d => d.isPlaying);
  if (playing.length === 2) {
    state.live = curveGains(state.xfade)[0] >= curveGains(state.xfade)[1] ? 'A' : 'B';
  } else if (playing.length === 1) {
    state.live = playing[0].id;
  }
  setAutomix(true, 'Automix on.');
});

/**
 * The automix brain. Runs a few times a second (and whenever a song ends):
 *  1. keep the idle deck loaded with the next song,
 *  2. when the live song gets within "automix starts" seconds of its end,
 *     start the other deck and crossfade into it (taking "fade duration",
 *     or less if the song is about to run out),
 *  3. if everything has stopped, start whatever is loaded.
 */
function automixTick() {
  if (!state.automix) return;
  const all = [decks.A, decks.B];

  for (const d of all) {
    if (!d.isPlaying && d.isSpent) d.loadNext();
  }

  let live = decks[state.live];
  if (!live || !live.isPlaying) {
    const playing = all.find(d => d.isPlaying);
    if (playing) {
      live = playing;
      state.live = live.id;
    } else {
      const ready = [live && live.other, decks.A, decks.B].find(d => d && !d.isSpent);
      if (!ready) {
        setAutomix(false, 'Automix finished — both queues are empty.');
        return;
      }
      setXfade(ready.side);
      state.live = ready.id;
      ready.start();
      setStatus(`Automix: playing deck ${ready.id}: ${ready.track.name}`);
      return;
    }
  }

  if (state.fade || live.el.loop) return; // a repeating song never "ends"
  const next = live.other;
  const rem = live.remaining;
  if (Number.isFinite(rem) && rem <= state.startBefore && !next.isPlaying && !next.isSpent) {
    transitionTo(next, clamp(rem, 0.5, state.fadeSec));
  }
}

/* ---------- loops ---------- */

// Logic loop: setInterval keeps running when the window is in the background.
setInterval(() => {
  updateFade();
  automixTick();
}, 100);

// Drawing loop.
function frame() {
  updateFade();
  fadeNowBtn.classList.toggle('fading', !!state.fade);
  $('#fade-now-dir').textContent = state.fade ? '…' : `→ ${nonLiveDeck().id}`;
  decks.A.drawFrame();
  decks.B.drawFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- playlists ---------- */

/**
 * Desktop app: playlists are .m3u8 files (Documents/DJ Dudes/Playlists) that
 * point at your music where it already lives on disk.
 */
const desktopStore = {
  async where() {
    return `Saved as .m3u8 playlist files in ${await window.native.playlistDir()}. They point at your music files, so don't move or rename those.`;
  },
  list: () => window.native.listPlaylists(),
  async load(name) {
    const items = await window.native.readPlaylist(name);
    const found = items.filter(i => i.exists);
    return {
      tracks: found.map(i => {
        const yt = /^https?:/i.test(i.path) && parseYouTubeLink(i.path);
        if (yt && yt.id) return makeYouTubeTrack(yt.id, i.title);
        return makeTrack({ path: i.path, name: i.title, duration: i.duration });
      }),
      missing: items.length - found.length,
    };
  },
  async save(name, tracks) {
    const usable = tracks.filter(t => t.path || t.youtubeId);
    await window.native.savePlaylist(name, usable.map(t => ({
      path: t.youtubeId ? youtubeUrl(t.youtubeId) : t.path,
      title: t.name,
      duration: t.duration,
    })));
    return tracks.length - usable.length;
  },
  remove: name => window.native.deletePlaylist(name),
};

/**
 * Plain browser: a web page can't reopen files by their location, so a copy of
 * each song is stored with the playlist in the browser's own storage.
 */
const browserStore = {
  db: null,
  open() {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('dj-dudes', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('playlists', { keyPath: 'name' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('playlists', mode);
      const req = fn(tx.objectStore('playlists'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  },
  async where() {
    return 'Saved inside this browser, with a copy of each song. (The desktop app saves normal .m3u8 playlist files instead.)';
  },
  async list() {
    const all = await this.run('readonly', s => s.getAll());
    return all.map(p => ({ name: p.name, count: p.tracks.length, savedAt: p.savedAt }));
  },
  async load(name) {
    const p = await this.run('readonly', s => s.get(name));
    return {
      tracks: p.tracks.map(t => (t.youtubeId
        ? makeYouTubeTrack(t.youtubeId, t.name)
        : makeTrack({ file: t.file, name: t.name, duration: t.duration }))),
      missing: 0,
    };
  },
  async save(name, tracks) {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    const usable = tracks.filter(t => t.file || t.youtubeId);
    await this.run('readwrite', s => s.put({
      name,
      savedAt: Date.now(),
      tracks: usable.map(t => (t.youtubeId
        ? { name: t.name, duration: t.duration, youtubeId: t.youtubeId }
        : { name: t.name, duration: t.duration, file: t.file })),
    }));
    return tracks.length - usable.length;
  },
  remove(name) { return this.run('readwrite', s => s.delete(name)); },
};

const playlists = window.native ? desktopStore : browserStore;
const plDialog = $('#playlists');
const plName = $('#pl-name');

/** What a deck is lined up to play: the loaded song (unless finished) and its queue. */
function setFor(deck) {
  return [...(deck.isSpent ? [] : [deck.track]), ...deck.queue];
}

async function renderPlaylists() {
  const list = $('#pl-list');
  let items;
  try {
    items = await playlists.list();
  } catch (err) {
    list.innerHTML = '<li class="pl-empty"></li>';
    $('.pl-empty', list).textContent = `Couldn't read playlists: ${err.message}`;
    return;
  }
  list.textContent = '';
  if (!items.length) {
    list.innerHTML = '<li class="pl-empty">No saved playlists yet.</li>';
    return;
  }
  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const p of items) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="pl-name"></span>
      <span class="pl-meta"></span>
      <button class="to-a" title="Add these songs to the end of Queue A">Add to A</button>
      <button class="to-b" title="Add these songs to the end of Queue B">Add to B</button>
      <button class="del" title="Delete this playlist (your music files are not touched)">✕</button>`;
    $('.pl-name', li).textContent = p.name;
    $('.pl-meta', li).textContent = `${p.count} song${p.count === 1 ? '' : 's'}`;
    $('.to-a', li).addEventListener('click', () => openPlaylist(p.name, decks.A));
    $('.to-b', li).addEventListener('click', () => openPlaylist(p.name, decks.B));
    $('.del', li).addEventListener('click', async () => {
      if (!confirm(`Delete the playlist "${p.name}"? Your music files are not touched.`)) return;
      await playlists.remove(p.name);
      renderPlaylists();
    });
    list.append(li);
  }
}

async function openPlaylist(name, deck) {
  try {
    const { tracks, missing } = await playlists.load(name);
    deck.queue.push(...tracks);
    if (!deck.track && !deck.isPlaying) deck.loadNext();
    renderQueues();
    let msg = `Added "${name}" (${tracks.length} songs) to Queue ${deck.id}.`;
    if (missing) msg += ` ${missing} song${missing === 1 ? " wasn't" : "s weren't"} found — moved or deleted?`;
    setStatus(msg);
    plDialog.close();
  } catch (err) {
    setStatus(`Couldn't open "${name}": ${err.message}`);
  }
}

async function savePlaylist(deck) {
  const name = plName.value.trim();
  if (!name) {
    plName.focus();
    plName.placeholder = 'Type a name first';
    return;
  }
  const tracks = setFor(deck);
  if (!tracks.length) {
    setStatus(`Queue ${deck.id} is empty — nothing to save.`);
    return;
  }
  const existing = await playlists.list();
  if (existing.some(p => p.name.toLowerCase() === name.toLowerCase()) &&
      !confirm(`A playlist called "${name}" already exists. Replace it?`)) return;
  try {
    const skipped = await playlists.save(name, tracks);
    let msg = `Saved "${name}" (${tracks.length - skipped} songs from deck ${deck.id}).`;
    if (skipped) msg += ` ${skipped} couldn't be saved.`;
    setStatus(msg);
    plName.value = '';
    renderPlaylists();
  } catch (err) {
    setStatus(`Couldn't save "${name}": ${err.message}`);
  }
}

function showPlaylists(focusSave = false) {
  playlists.where().then(text => { $('#pl-where').textContent = text; });
  $('#pl-open-folder').hidden = !window.native;
  renderPlaylists();
  plDialog.showModal();
  if (focusSave) plName.focus();
}

$('#pl-save-form').addEventListener('submit', e => {
  e.preventDefault();
  savePlaylist(decks[e.submitter && e.submitter.value === 'B' ? 'B' : 'A']);
});
$('#playlists-btn').addEventListener('click', () => showPlaylists());
$('#pl-open-folder').addEventListener('click', () => window.native.openPlaylistFolder());
for (const deck of [decks.A, decks.B]) {
  $('.save-pl', deck.qroot).addEventListener('click', () => showPlaylists(true));
}

/* ---------- phone remote (desktop app only) ---------- */

/** Snapshot of what's going on, sent to connected phones. */
function remoteState() {
  const deck = d => ({
    name: d.track ? d.track.name : '',
    playing: d.isPlaying,
    audible: d.isAudible,
    elapsed: d.track ? d.el.currentTime : 0,
    duration: Number.isFinite(d.el.duration) ? d.el.duration : (d.track ? d.track.duration : 0),
    rate: d.el.playbackRate,
    loop: d.el.loop,
    upNext: d.queue.slice(0, 3).map(t => t.name),
    queued: d.queue.length,
  });
  return {
    A: deck(decks.A),
    B: deck(decks.B),
    xfade: state.xfade,
    fading: !!state.fade,
    next: nonLiveDeck().id,
    automix: state.automix,
    startBefore: state.startBefore,
    fadeSec: state.fadeSec,
    master: +$('#master').value,
    status: $('#status').textContent,
  };
}

const remoteApi = window.native && window.native.remote;

if (remoteApi) {
  setInterval(() => remoteApi.sendState(remoteState()), 400);

  remoteApi.onCommand(({ action, deck, value }) => {
    resumeAudio();
    const d = decks[deck];
    switch (action) {
      case 'fadeNow': transitionTo(nonLiveDeck()); break;
      case 'toggle': d && d.toggle(); break;
      case 'next': d && d.next(); break;
      case 'back': d && d.back(); break;
      case 'automix': automixBtn.click(); break;
      case 'master':
        if (Number.isFinite(value)) {
          const v = clamp(value, 0, 1.5);
          $('#master').value = v;
          setParamNow(master.gain, v);
        }
        break;
    }
    remoteApi.sendState(remoteState()); // let the phone see the result right away
  });
}

const remoteDialog = $('#remote');

function renderRemoteInfo(info) {
  $('#remote-on').checked = info.enabled;
  $('#remote-body').hidden = !info.running;
  $('#remote-qr').innerHTML = info.qrSvg; // generated locally by the app
  const urls = $('#remote-urls');
  urls.textContent = '';
  for (const u of info.urls) {
    const div = document.createElement('div');
    div.textContent = u;
    urls.append(div);
  }
  if (info.running && !info.urls.length) {
    urls.textContent = "This PC doesn't seem to be on a network. Connect it to Wi-Fi or Ethernet.";
  }
  $('#remote-phones').textContent = info.phones
    ? `✅ ${info.phones} phone${info.phones > 1 ? 's' : ''} connected`
    : info.running ? 'Waiting for a phone to connect…' : '';
  $('#remote-btn-label').textContent = info.phones ? `Remote (${info.phones})` : 'Remote';
  $('#remote-btn').classList.toggle('has-phones', info.phones > 0);
}

async function refreshRemote() {
  if (remoteApi) renderRemoteInfo(await remoteApi.info());
}

$('#remote-btn').addEventListener('click', () => {
  $('#remote-desktop').hidden = !remoteApi;
  $('#remote-browser-note').hidden = !!remoteApi;
  refreshRemote();
  remoteDialog.showModal();
});
$('#remote-on').addEventListener('change', async e => {
  const err = $('#remote-error');
  err.hidden = true;
  try {
    renderRemoteInfo(await remoteApi.setEnabled(e.target.checked));
  } catch (ex) {
    err.textContent = `Couldn't start the phone remote: ${ex.message}`;
    err.hidden = false;
    e.target.checked = false;
  }
});
$('#remote-reset').addEventListener('click', async () => {
  if (confirm('Make a new link? Phones using the current one will be disconnected and need to scan again.')) {
    renderRemoteInfo(await remoteApi.reset());
  }
});
if (remoteApi) {
  refreshRemote();
  setInterval(refreshRemote, 3000); // keeps the "phones connected" count fresh
}

/* ---------- adding YouTube songs ---------- */

const ytDialog = $('#yt-dialog');
const ytLinks = $('#yt-links');
const ytProgress = $('#yt-progress');
const ytPreview = $('#yt-preview');

/**
 * Add every YouTube / YouTube Music link found in `text` to a deck's queue.
 * Playlist and album links are expanded into their songs.
 */
async function addYouTubeLinks(text, deck, index = deck.queue.length) {
  if (!youtubeSupported) {
    setStatus('YouTube songs only play in the desktop app — start DJ Dudes with "Start DJ Dudes.bat".');
    return 0;
  }
  const links = String(text).split(/\s+/).map(parseYouTubeLink).filter(Boolean);
  if (!links.length) {
    setStatus("That doesn't look like a YouTube or YouTube Music link.");
    return 0;
  }
  const tracks = [];
  let failed = 0;
  const openedHere = !ytDialog.open;
  for (const link of links) {
    if (link.id) {
      tracks.push(makeYouTubeTrack(link.id));
      continue;
    }
    // Playlist: YouTube's player lists its songs for us (it has to be on screen).
    setStatus('Reading the YouTube playlist…');
    ytProgress.textContent = 'Reading the playlist…';
    ytPreview.hidden = false;
    if (!ytDialog.open) ytDialog.showModal();
    try {
      const ids = await expandYouTubePlaylist(link.list, ytPreview);
      tracks.push(...ids.map(id => makeYouTubeTrack(id)));
    } catch (err) {
      failed++;
      setStatus(`Couldn't read that playlist: ${err.message}`);
    } finally {
      ytPreview.hidden = true;
      ytProgress.textContent = '';
    }
  }
  if (openedHere && ytDialog.open) ytDialog.close();
  if (!tracks.length) return 0;
  deck.queue.splice(Math.min(index, deck.queue.length), 0, ...tracks);
  let onDeck = false;
  if (!deck.track && !deck.isPlaying) onDeck = deck.loadNext() && tracks.includes(deck.track);
  renderQueues();
  let msg = `Added ${tracks.length} YouTube song${tracks.length > 1 ? 's' : ''} to Queue ${deck.id}.`;
  if (onDeck) msg += ` The first one is loaded on deck ${deck.id}.`;
  if (failed) msg += ` ${failed} playlist${failed > 1 ? 's' : ''} couldn't be read.`;
  setStatus(msg);
  return tracks.length;
}

function showYouTubeDialog(prefill = '') {
  $('#yt-unsupported').hidden = youtubeSupported;
  $('#yt-form').hidden = !youtubeSupported;
  ytLinks.value = prefill;
  ytProgress.textContent = '';
  ytPreview.hidden = true;
  ytDialog.showModal();
  ytLinks.focus();
}

$('#yt-form').addEventListener('submit', async e => {
  e.preventDefault();
  const deck = decks[e.submitter && e.submitter.value === 'B' ? 'B' : 'A'];
  const buttons = [...e.target.querySelectorAll('button')];
  buttons.forEach(b => { b.disabled = true; });
  const added = await addYouTubeLinks(ytLinks.value, deck);
  buttons.forEach(b => { b.disabled = false; });
  if (added) {
    ytLinks.value = '';
    ytDialog.close();
  } else {
    ytProgress.textContent = $('#status').textContent;
  }
});


// Ctrl+V with a YouTube link copied: open the add window with it filled in.
document.addEventListener('paste', e => {
  if (e.target.matches('input, textarea') || document.querySelector('dialog[open]')) return;
  const text = e.clipboardData.getData('text');
  if (text && parseYouTubeLink(text.trim().split(/\s+/)[0])) {
    e.preventDefault();
    showYouTubeDialog(text.trim());
  }
});

// YouTube songs bypass the mixer: keep their player volume following the faders.
setInterval(() => {
  decks.A.syncYouTubeVolume();
  decks.B.syncYouTubeVolume();
}, 50);

/* ---------- screens (visualizer / YouTube video) ---------- */

function setScreens(on) {
  document.body.classList.toggle('no-screens', !on);
  $('#screens-btn').setAttribute('aria-pressed', String(on));
  $('#screens-btn-label').textContent = on ? 'Screens: On' : 'Screens: Off';
  try { localStorage.setItem('dj-screens', on ? '1' : '0'); } catch { /* not important */ }
}
$('#screens-btn').addEventListener('click', () => {
  const on = document.body.classList.contains('no-screens');
  setScreens(on);
  const yt = [decks.A, decks.B].filter(d => d.isYouTube).map(d => d.id);
  if (on) {
    setStatus('Screens on.');
  } else if (yt.length) {
    setStatus(`Screens off. Deck ${yt.join(' and ')} keeps its video while it plays YouTube (YouTube requires it), ` +
      'so the rest of the screens hide once that song is done.');
  } else {
    setStatus('Screens off: more room for the queues.');
  }
});
try { setScreens(localStorage.getItem('dj-screens') !== '0'); } catch { setScreens(true); }

/* ---------- keyboard ---------- */

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.matches('select, textarea, input:not([type="range"])')) return;
  if (document.querySelector('dialog[open]')) return;
  const onRange = t.matches('input[type="range"]');

  const actions = {
    z: () => decks.A.toggle(),
    m: () => decks.B.toggle(),
    x: () => transitionTo(decks.A),
    n: () => transitionTo(decks.B),
    a: () => automixBtn.click(),
    q: () => decks.A.back(),
    w: () => decks.A.next(),
    o: () => decks.B.back(),
    p: () => decks.B.next(),
    ' ': () => transitionTo(nonLiveDeck()),
    arrowleft: () => !onRange && setXfade(state.xfade - 0.05),
    arrowright: () => !onRange && setXfade(state.xfade + 0.05),
  };
  const fn = actions[e.key.toLowerCase()];
  if (!fn) return;
  if (onRange && e.key.startsWith('Arrow')) return;
  e.preventDefault();
  if (t instanceof HTMLButtonElement) t.blur();
  fn();
});

$('#help-btn').addEventListener('click', () => $('#help').showModal());

// Stop a stray drop outside the queues from navigating away (and losing the set).
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

// Browsers start audio suspended until the first click/keypress.
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, resumeAudio, { once: true }));

applyXfade();
updateFadeHint();
renderQueues();

// Exposed for debugging from the dev tools console.
window.dj = { decks, state, ctx, fadeTo, transitionTo, setXfade };
