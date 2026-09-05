# yt-music-obs-overlay
simple vibecoded overlay for yt music
simply because i want something that just works without having to do this and that

## How to Use (100% Local / Zero Downloads)

### 1. Load the Extension in your Browser
1. In your browser (Chrome, Brave, Edge, Opera), navigate to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (toggle in top-right).
3. Click **Load unpacked** (top-left) and select the `extension` folder from this repository.

---

### 2. Add Browser Source in OBS Studio
1. In OBS Studio, click **`+`** under **Sources** $\rightarrow$ select **Browser**.
2. Check **Local file** and browse to select `overlay.html` (or enter the file path):
   ```text
   file:///path/to/yt-music-obs-overlay/overlay.html
   ```
3. Set **Width**: `500`, **Height**: `250`.
4. Click **OK**.

---

### 3. Play & Customize in Real Time!
1. Open **YouTube** (`youtube.com`) or **YouTube Music** (`music.youtube.com`) and play any video or song.
2. Click the extension icon in your browser toolbar to choose any theme (**Modern Glass**, **Compact Pill**, **Spinning Vinyl**, **Cyberpunk HUD**, **Spotify Bar**, **Lo-Fi Anime**, **Retro 8-Bit Pixel**, **Ultra Minimal**) or custom accent colors.
3. **Themes change dynamically in real-time in OBS** — you never need to edit or change the link in OBS!
