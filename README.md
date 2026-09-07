# yt-music-obs-overlay
simple vibecoded overlay for yt music

## How to Use

### 1. Load the Extension in your Browser
1. In your browser (Chrome, Brave, Edge, Opera), navigate to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (toggle in top-right).
3. If you previously loaded the extension, click the 🔄 **Reload** icon on the extension card. Otherwise, click **Load unpacked** (top-left) and select the `extension` folder from this repository.

---

### 2. Test & Customize in `setup.html`
1. Open `setup.html` in your browser:
   ```text
   file:///path/to/file/yt-music-obs-overlay/setup.html
   ```
2. The page includes:
   - **Live Song Detection & Diagnostics**: Shows real-time connection status and song details as soon as you play music.
   - **Live Theme Preview**: Switch between Modern Glass, Compact Pill, Spinning Vinyl, Cyberpunk HUD, Spotify Bar, Lo-Fi Anime, Retro Pixel, and Ultra Minimal.
   - **Test Buttons**: Test song and Up Next queue with a single click.

---

### 3. Add Browser Source in OBS Studio
1. In OBS Studio, click **`+`** under **Sources** $\rightarrow$ select **Browser**.
2. Check **Local file** and browse to select `overlay.html` (or enter the file path):
   ```text
   file:///path/to/file/yt-music-obs-overlay/overlay.html
   ```
3. Set **Width**: `500`, **Height**: `350`.
4. Click **OK**.

---

### 4. Play & Enjoy!
1. Open **YouTube Music** (`music.youtube.com`) or **YouTube** (`youtube.com`) and play any video or song.
2. A green status indicator (`🟢 OBS: Theme`) appears at the bottom-right of the YouTube tab.
3. Song title, artist, album artwork, and playback progress stream live into OBS Studio!
