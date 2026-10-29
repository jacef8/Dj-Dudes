# DJ Dudes

Two-deck DJ software for your PC. You queue up songs on **side A** and **side B** and fade between them with the crossfader. You can do the fades yourself, or turn on **Automix** to have it fade each song into the next for you.

## Run it

### Portable: one file in Google Drive (recommended)
Put **`DJ Dudes.exe`** in your Google Drive (or on a USB stick) and double-click it on any Windows PC. There's nothing to install and no Node.js needed. It takes a few seconds to open, because it unpacks itself each time.

- Playlists and phone-remote settings are saved in a **`DJ Dudes Data`** folder next to the .exe, so they follow it to every PC. The first time it runs, it copies over any playlists saved by the older setup (`Documents\DJ Dudes\Playlists`).
- Playlists point at your songs by their location. Songs stored in Google Drive work on every PC with the same Drive letter.
- Windows may say "Windows protected your PC" because the file isn't signed. Click **More info → Run anyway**.
- To build a new `DJ Dudes.exe` from this code: `npm install`, then `npm run dist` (output goes to `dist/`).

### Option 1: just open it (no install)
Double-click `index.html` to open it in **Chrome** or **Edge**.

### Option 2: desktop app (recommended)
**Easy way (Windows):** double-click **`Start DJ Dudes.bat`** once. The first time, it checks for [Node.js](https://nodejs.org) (if it's missing, it opens the download page) and downloads what the app needs, which takes a minute or two and needs internet. It also puts a **DJ Dudes icon on your Desktop and in the Start menu**. From then on, use that icon. It opens the app straight away, even offline, with no black window.

If you move the DJ-Dudes folder, the icon will stop working. Run `Start DJ Dudes.bat` once from the new place to fix it.

**Google Drive / OneDrive:** DJ Dudes doesn't run from inside a synced folder, because setup creates thousands of files the sync app would try to upload. If you double-click `Start DJ Dudes.bat` from Google Drive or OneDrive, it copies the app to `C:\Users\<you>\Projects\DJ-Dudes`, sets it up there, and points the icons at that copy. The synced copy stays as a backup. Running the launcher from the synced copy again later updates the PC copy from it.

**Or by hand:** install [Node.js](https://nodejs.org) (LTS), then in this folder:

```
npm install
npm start
```

This opens DJ Dudes in its own window. Automix keeps working when the window is minimised.

To build a Windows installer and a portable `.exe` (output goes to `dist/`; the first run downloads the build tools):

```
npm run dist
```

## How to use it

1. **Use the Main Queue** (the green one in the middle) for your set list. Drop songs, folders, YouTube links or a saved playlist into it, and the decks take turns playing them **in that order**: song 1 on A, song 2 on B, song 3 on A, and so on. Queue A and Queue B still work too, and a song placed there plays on that deck before the Main Queue's next song. On a Main Queue song, **→A** / **→B** moves it to that deck's queue, and a double-click loads it on the deck that isn't live.
2. **Add songs.** Click **+ Songs** or **+ Folder** on Queue A or Queue B, or drag files or folders from Explorer straight onto a queue. MP3, WAV, FLAC, OGG, M4A/AAC and Opus all work. You can also drop a playlist file (`.m3u` / `.m3u8`, from DJ Dudes or other music apps) onto any queue to add everything in it. Drop songs **straight onto a deck** to load them there now: the first one loads (DJ Dudes asks first if that deck is playing out loud), any others go to the front of that deck's queue, and **BACK** brings back the song that was replaced.
3. **Arrange the queues.** Drag songs to reorder them, or drag them across to the other queue. On each song, **⇄** moves it to the other side, **✕** removes it, and **Load** (or a double-click) puts it on the deck right away.
4. **Fade when you choose.** Press ▶ on a deck. When you're ready for the other side, hit the big **FADE NOW** button (or `Space`). It starts the other deck and glides the crossfader over for you, taking **Fade duration** seconds. **Fade to A** / **Fade to B** do the same toward a particular side. You can also drag the crossfader yourself.
   - **FADE OUT** (or `F`) fades the whole mix down to silence over the fade duration and stops, without starting the next song (handy for announcements or the end of the night). Press it again (**FADE IN**) to bring the same song back up, or press ▶ on a deck to carry on at normal volume. Also on the phone remote.
5. **Or let it mix.** Turn on **AUTOMIX**. It plays A, then fades into B, then into the next song on A, and so on.
   - **Automix starts** sets how many seconds before the end of each song the fade begins (1–60s).
   - **Fade duration** sets how long the fade takes (1–30s). If the fade starts closer to the end than the fade duration, the fade is shortened so it finishes when the song does.
   - **How a fade works:** the next song starts playing at the *beginning* of the fade. During the fade both songs play at once, the old one getting quieter and the new one louder. When the fade finishes, the old deck stops and loads its next song.
   - With **Repeat queues** ticked, songs that finish go back to the end of their queue, so the set loops forever.
   - If **Share queues** is ticked and one side runs out, the deck takes its next song from the other side's queue. That means you can put a whole playlist in Queue A and the decks will still alternate.

### YouTube & YouTube Music songs (desktop app)
Click **+ YouTube** on a queue and paste links: songs, playlists or albums, one per line. In YouTube Music, use **⋮ → Share → Copy link**. You can also drag a link onto a queue, or just press **Ctrl+V** anywhere in DJ Dudes with a link copied.

- A deck playing a YouTube song shows the **video in its screen**. Fades, FADE NOW, automix, BACK/NEXT, REPEAT, playlists and the phone remote all work. Crossfades are done by turning YouTube's player volume up and down.
- **Needs the internet** while it plays, and may show **ads** (YouTube's rules).
- **Some songs can't be played outside YouTube** (the record label blocks it). DJ Dudes skips those automatically, and if it was fading into one, it swings straight back so the music never stops.
- **EQ and pitch don't work on YouTube songs**, because YouTube doesn't let other apps change its sound. They're greyed out.
- Private or automatic playlists (like *Liked Music*) can't be read. Make a normal playlist in YouTube Music, set it to **Public** or **Unlisted**, and share that.
- **Remove songs that can't play** (under *More options*, on by default): a song YouTube permanently blocks is taken out of the queue, and out of the saved DJ Dudes playlist it came from, instead of staying with a ⚠. Songs that fail because the internet dropped are never removed. Your YouTube Music playlists are never changed.
- **Check & clean** (Playlists window): tests every YouTube song in a saved playlist on this PC, lists the blocked ones and, if you say yes, removes them from that playlist.
- **Check which songs can play:** with *Check which songs can play first* ticked (the default), DJ Dudes tries each song in YouTube's player before adding it, taking about 2 seconds a song. The result shows at the top, for example "14 of 20 can play", and blocked songs are added marked ⚠ and skipped, so you find out before the gig. The answer can differ between PCs and networks, so check on the PC you'll DJ with.
- Only works in the desktop app, not when `index.html` is opened directly.

### Visualizer screens
Drag the **bar between the decks and the queues** to resize: up for bigger queues (all the way up hides the screens), down for bigger screens, and double-click it to reset. Each deck has a screen above its waveform: animated bars that move with the music, or the video for a YouTube song. The bars show a deck even before you fade it in, so you can see the next song is ready. **📺 Screens** (top right) hides them to give the queues more room. A deck playing YouTube always keeps its video visible, because YouTube requires it.

### Playlists
Click **📁 Playlists** (top right) or **Save** on a queue.
- **Save Queue A / B** saves the song on that deck plus everything in its queue, in order.
- **Add to A / Add to B** puts a saved playlist's songs at the end of that queue.
- **Import playlist file…** adds an `.m3u` / `.m3u8` file (from DJ Dudes or another music app) to your saved playlists.
- **Desktop app:** playlists are saved as normal `.m3u8` files in `Documents\DJ Dudes\Playlists`. They point at your music where it already is, so if you move or rename a song, it gets skipped and you're told how many were missing. You can also drop `.m3u`/`.m3u8` playlists exported from other music software into that folder and they'll show up.
- **Opening `index.html` in a browser:** a web page can't reopen files from where they sit on your PC, so a copy of each song is saved inside the browser with the playlist. This takes up disk space, and clearing the browser's site data deletes these playlists.

### Phone remote (desktop app)
Walk away from the PC and keep an eye on the set from your phone. There's nothing to install on the phone, and no internet is needed. The phone just has to be on the **same Wi-Fi** as the PC.

1. Click **📱 Remote** (top right) and tick **Let my phone control DJ Dudes**.
2. Scan the QR code with your phone's camera and open the link.
3. The first time, Windows may ask whether DJ Dudes can use the network. Choose **Private networks**.

On the phone you see both decks: what's playing, time left, what's up next, which deck is live, and where the crossfader is. You can:
- press **FADE NOW**,
- play / pause, **BACK** and **NEXT** on each deck (it asks first before skipping a deck that's playing out loud),
- turn **automix** on or off,
- set the **master volume**.

The link contains a secret key, so other people on the Wi-Fi can't take over. **New link** makes a fresh key and disconnects every phone. The setting is remembered, so next time you only need to re-open the bookmarked link. If the phone's screen goes to sleep, the page reconnects when you wake it.

### Guest song requests (desktop app)
Let people at a dance ask for songs from their phones, only from a list you choose, and only played when you say so.

1. Click **🙋 Requests** (top) to show the Requests panel, then **Settings**.
2. Choose the saved playlist guests may pick from (make a "Requests OK" playlist if you like) and tick **Let guests request songs**.
3. Show guests the QR code. They need to be on the same Wi-Fi as the PC, or your phone's hotspot.

Guests see what's playing and what's coming up, can search the allowed songs, and tap **Request** (with their name if they want). Each phone can make **1 request every 10 minutes**, and songs that are already waiting, coming up or just played are turned down with a friendly message. Requests wait in the **Requests panel** until you click **✓** (approve) or **✕** (decline). Approved songs go near the top of the Main Queue, in the order you approved them, marked "🙋 requested by …". Click **Hide** or the 🙋 button to put the panel away; the button shows how many requests are waiting. Guests have their own link and key, and can't control anything else.

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
| Waveform | The strip under the screen. Click to jump to that spot in the song |

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
| `F` | Fade out / fade back in |
| `Q` / `W` | Back / next on deck A |
| `O` / `P` | Back / next on deck B |

## How it works
Everything runs locally with the browser's Web Audio API (`app.js`). Each deck's chain is: audio element → 3-band EQ → volume → crossfade gain → master. Crossfades are scheduled on the audio thread, so they stay smooth even when the app is in the background.
