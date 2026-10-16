'use strict';

/* ==========================================================================
   YouTube songs.

   Songs from YouTube / YouTube Music play through YouTube's official embedded
   player (the IFrame Player API). YouTubeMedia wraps that player so it looks
   like an <audio> element to the rest of the app: play(), pause(), paused,
   ended, currentTime, duration, loop and the same events. Its audio can't go
   through the Web Audio mixer, so fades are done with the player's volume.
   ========================================================================== */

/** Can this page play YouTube at all? (Not when opened straight from a file.) */
const youtubeSupported = location.protocol === 'http:' || location.protocol === 'https:';

/**
 * Pull a video or playlist id out of a YouTube / YouTube Music link.
 * Returns { id } for a song, { list } for a playlist/album, or null.
 */
function parseYouTubeLink(text) {
  let u;
  try {
    u = new URL(String(text).trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
    if (m) id = m[2];
  } else {
    return null;
  }
  if (id && /^[\w-]{11}$/.test(id)) return { id };
  const list = u.searchParams.get('list');
  if (list && /^[\w-]+$/.test(list)) return { list };
  return null;
}

const youtubeUrl = id => `https://www.youtube.com/watch?v=${id}`;

/** Song title from YouTube's public oEmbed service ("Artist - Song" when it can). */
async function fetchYouTubeTitle(id) {
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeUrl(id))}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const info = await res.json();
  const artist = (info.author_name || '').replace(/ - Topic$/, '');
  // YouTube Music "Topic" uploads are titled just with the song name.
  if (/ - Topic$/.test(info.author_name || '') && artist && !info.title.includes(artist)) {
    return `${artist} - ${info.title}`;
  }
  return info.title;
}

let ytApiPromise = null;

/** Load YouTube's player script once (needs internet). */
function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  ytApiPromise ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (previous) previous();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      ytApiPromise = null;
      script.remove();
      reject(new Error("couldn't reach YouTube — is the internet connected?"));
    };
    document.head.append(script);
  });
  return ytApiPromise;
}

/** Create a YouTube player inside `host` and resolve once it's ready. */
function createYouTubePlayer(host, handlers = {}) {
  return loadYouTubeApi().then(YT => new Promise((resolve, reject) => {
    const div = document.createElement('div');
    host.append(div);
    const timer = setTimeout(() => reject(new Error('YouTube player took too long to start')), 20000);
    // eslint-disable-next-line no-new
    new YT.Player(div, {
      width: '100%',
      height: '100%',
      playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: e => { clearTimeout(timer); resolve(e.target); },
        onStateChange: e => handlers.onState && handlers.onState(e.data),
        onError: e => handlers.onError && handlers.onError(e.data),
      },
    });
  }));
}

const YT_ERRORS = {
  2: "that link doesn't point to a valid video",
  5: "YouTube's player couldn't play it",
  100: 'the video was removed or is private',
  101: "the owner doesn't allow it to play outside YouTube",
  150: "the owner doesn't allow it to play outside YouTube",
  153: 'YouTube rejected the player (start DJ Dudes with "Start DJ Dudes.bat")',
};

class YouTubeMedia {
  constructor(host) {
    this.host = host;
    this.player = null;
    this.playerPromise = null;
    this.listeners = {};
    this.videoId = null;
    this.ready = false;       // video cued in the player
    this.wantPlay = false;    // play() was called before it was ready
    this.pendingSeek = null;
    this.metaSent = false;
    this.lastVolume = -1;
    this.errorCode = null;
    this._paused = true;
    this._ended = false;
    this.loop = false;
    this.playbackRate = 1;    // YouTube can't do fine pitch changes
  }

  /* --- the bits of the <audio> element interface the app uses --- */

  addEventListener(type, fn, opts) {
    (this.listeners[type] ||= []).push({ fn, once: !!(opts && opts.once) });
  }

  emit(type) {
    const list = this.listeners[type];
    if (!list) return;
    this.listeners[type] = list.filter(l => !l.once);
    for (const l of list) l.fn();
  }

  get paused() { return this._paused; }
  get ended() { return this._ended; }

  get duration() {
    const d = this.ready && this.player ? this.player.getDuration() : 0;
    return d > 0 ? d : NaN;
  }

  get currentTime() {
    if (this._ended) return this.duration || 0;
    return this.ready && this.player ? this.player.getCurrentTime() || 0 : (this.pendingSeek || 0);
  }

  set currentTime(t) {
    this._ended = false;
    if (this.ready && this.player) this.player.seekTo(Math.max(0, t), true);
    else this.pendingSeek = t;
  }

  play() {
    this._ended = false;
    if (this._paused) {
      this._paused = false;
      this.emit('play');
    }
    if (!this.ready) {
      this.wantPlay = true;
    } else {
      this.player.playVideo();
    }
    return Promise.resolve();
  }

  pause() {
    this.wantPlay = false;
    if (this.ready && this.player) this.player.pauseVideo();
    if (!this._paused) {
      this._paused = true;
      this.emit('pause');
    }
  }

  /* --- YouTube-specific --- */

  ensurePlayer() {
    this.playerPromise ??= createYouTubePlayer(this.host, {
      onState: s => this.onState(s),
      onError: code => this.onError(code),
    }).then(p => (this.player = p)).catch(err => {
      this.playerPromise = null;
      throw err;
    });
    return this.playerPromise;
  }

  async load(videoId) {
    this.videoId = videoId;
    this.ready = false;
    this.wantPlay = false;
    this.pendingSeek = null;
    this.metaSent = false;
    this.errorCode = null;
    this._paused = true;
    this._ended = false;
    const player = await this.ensurePlayer();
    if (this.videoId !== videoId) return; // something else was loaded meanwhile
    this.lastVolume = -1;
    player.cueVideoById(videoId);
    this.ready = true;
    if (this.pendingSeek) player.seekTo(this.pendingSeek, true);
    if (this.wantPlay) {
      this.wantPlay = false;
      player.playVideo();
    }
  }

  stop() {
    this.videoId = null;
    this.ready = false;
    this.wantPlay = false;
    this._paused = true;
    this._ended = false;
    if (this.player) this.player.stopVideo();
  }

  /** 0..1 — called many times a second while fading. */
  setVolume(v) {
    if (!this.ready || !this.player) return;
    const vol = Math.round(Math.min(1, Math.max(0, v)) * 100);
    if (vol === this.lastVolume) return;
    this.lastVolume = vol;
    this.player.setVolume(vol);
    if (vol > 0 && this.player.isMuted()) this.player.unMute();
  }

  onState(s) {
    if (!this.videoId) return;
    const YTState = window.YT.PlayerState;
    if (!this.metaSent && this.duration > 0) {
      this.metaSent = true;
      this.emit('loadedmetadata');
    }
    if (s === YTState.PLAYING && this._paused) {
      // Started from inside the player itself.
      this._paused = false;
      this.emit('play');
    } else if (s === YTState.PAUSED && !this._paused) {
      this._paused = true;
      this.emit('pause');
    } else if (s === YTState.ENDED) {
      if (this.loop) {
        this.player.seekTo(0, true);
        this.player.playVideo();
        return;
      }
      this._ended = true;
      this._paused = true;
      this.emit('pause');
      this.emit('ended');
    }
  }

  onError(code) {
    if (!this.videoId) return;
    this.errorCode = code;
    this._paused = true;
    this.emit('error');
  }

  get errorMessage() {
    return YT_ERRORS[this.errorCode] || `YouTube error ${this.errorCode}`;
  }
}

const PLAYLIST_UNREADABLE =
  "YouTube wouldn't list its songs (it may be private, empty, or an automatic list such as Liked Music or a channel's uploads)";

/**
 * Turn a playlist/album link into its video ids, using a temporary player
 * shown in `host` (YouTube requires its player to be visible).
 */
async function expandYouTubePlaylist(listId, host) {
  let onCued;
  let onFail;
  const cued = new Promise((resolve, reject) => { onCued = resolve; onFail = reject; });
  const player = await createYouTubePlayer(host, {
    onState: s => { if (s === window.YT.PlayerState.CUED) onCued(); },
    onError: code => onFail(new Error(YT_ERRORS[code] || `YouTube error ${code}`)),
  });
  try {
    player.cuePlaylist({ listType: 'playlist', list: listId });
    await Promise.race([
      cued,
      new Promise((_, reject) => setTimeout(() => reject(new Error(PLAYLIST_UNREADABLE)), 15000)),
    ]);
    // The list sometimes fills in a moment after the first cue.
    for (let i = 0; i < 20 && !(player.getPlaylist() || []).length; i++) {
      await new Promise(r => setTimeout(r, 250));
    }
    const ids = player.getPlaylist() || [];
    if (!ids.length) throw new Error(PLAYLIST_UNREADABLE);
    return ids;
  } finally {
    player.destroy();
  }
}
