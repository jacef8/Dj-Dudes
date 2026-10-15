# DJ Dudes

Two-deck DJ software for your PC. You queue up songs on **side A** and **side B** and fade between them with the crossfader. You can do the fades yourself, or turn on **Automix** to have it fade each song into the next for you.

## Run it

### Option 1: just open it (no install)
Double-click `index.html` to open it in **Chrome** or **Edge**.

### Option 2: desktop app (recommended)
You need [Node.js](https://nodejs.org) (LTS) installed. Then, in this folder:

```
npm install
npm start
```

This opens DJ Dudes in its own window. Automix keeps working when the window is minimised.

To build a Windows installer and a portable `.exe` (output goes to `dist/`):

```
npm run dist
```

## How to use it

1. **Add songs.** Click **+ Songs** or **+ Folder** on Queue A or Queue B, or drag files or folders from Explorer straight onto a queue. MP3, WAV, FLAC, OGG, M4A/AAC and Opus all work.
2. **Arrange the queues.** Drag songs to reorder them, or drag them across to the other queue. On each song, **⇄** moves it to the other side, **✕** removes it, and **Load** (or a double-click) puts it on the deck right away.
3. **Fade when you choose.** Press ▶ on a deck. When you're ready for the other side, hit the big **FADE NOW** button (or `Space`). It starts the other deck and glides the crossfader over for you, taking **Fade duration** seconds. **Fade to A** / **Fade to B** do the same toward a particular side. You can also drag the crossfader yourself.
4. **Or let it mix.** Turn on **AUTOMIX**. It plays A, then fades into B, then into the next song on A, and so on.
   - **Automix starts** sets how many seconds before the end of each song the fade begins (1–60s).
   - **Fade duration** sets how long the fade takes (1–30s). If the fade starts closer to the end than the fade duration, the fade is shortened so it finishes when the song does.
   - **How a fade works:** the next song starts playing at the *beginning* of the fade. During the fade both songs play at once, the old one getting quieter and the new one louder. When the fade finishes, the old deck stops and loads its next song.
   - With **Repeat queues** ticked, songs that finish go back to the end of their queue, so the set loops forever.
   - If **Share queues** is ticked and one side runs out, the deck takes its next song from the other side's queue. That means you can put a whole playlist in Queue A and the decks will still alternate.

### Playlists
Click **📁 Playlists** (top right) or **Save** on a queue.
- **Save Queue A / B** saves the song on that deck plus everything in its queue, in order.
- **Add to A / Add to B** puts a saved playlist's songs at the end of that queue.
- **Desktop app:** playlists are saved as normal `.m3u8` files in `Documents\DJ Dudes\Playlists`. They point at your music where it already is, so if you move or rename a song, it gets skipped and you're told how many were missing. You can also drop `.m3u`/`.m3u8` playlists exported from other music software into that folder and they'll show up.
- **Opening `index.html` in a browser:** a web page can't reopen files from where they sit on your PC, so a copy of each song is saved inside the browser with the playlist. This takes up disk space, and clearing the browser's site data deletes these playlists.

### Deck controls
| Control | What it does |
|---|---|
| ▶ / ❚❚ | Play / pause |
| CUE | When paused, sets the cue point (yellow line). When playing, jumps back to the cue point and stops |
| ⏮ BACK | In the first 3 seconds of a song, goes back to the previous song on this deck. After that, restarts the current song |
| NEXT ⏭ | Skips to the next song in this deck's queue (keeps playing if it was) |
| REPEAT ⟲ | Loops the current song. Automix stays on this deck until you turn it off or press FADE NOW |
| HI / MID / LOW | 3-band EQ (pull LOW down to kill the bass during a transition) |
| PITCH | ±8% speed |
| VOL | Deck volume (channel fader) |
| Waveform | Click to jump to that spot in the song |

Double-click any slider to reset it.

### Crossfade curves
- **Smooth (equal power)**: keeps the volume steady through the fade. Best for most music.
- **Linear**: a straight blend, with a small dip in the middle.
- **Fast cut**: both songs stay at full volume until near the end of the fader.

### Keyboard shortcuts
| Key | Action |
|---|---|
| `Z` / `M` | Play / pause deck A / B |
| `X` / `N` | Fade to A / B |
| `Space` | FADE NOW (fade to the deck that isn't live) |
| `←` / `→` | Nudge the crossfader |
| `A` | Toggle automix |
| `Q` / `W` | Back / next on deck A |
| `O` / `P` | Back / next on deck B |

## How it works
Everything runs locally with the browser's Web Audio API (`app.js`). Each deck's chain is: audio element → 3-band EQ → volume → crossfade gain → master. Crossfades are scheduled on the audio thread, so they stay smooth even when the app is in the background.
