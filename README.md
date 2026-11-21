<p align="center">
  <img src="youtube-native-logo-simplified-highres.png" alt="" width="120">
</p>

<h1 align="center">YouTube Music Native</h1>

<p align="center">A lightweight Windows desktop client for YouTube Music.</p>

---

The YouTube Music website in a browser tab works, but it's heavy and doesn't feel like a desktop app. This is a native shell built with [Tauri](https://tauri.app/) and [Svelte](https://svelte.dev/). It has its own fast library UI, and playback still runs through YouTube Music itself, so your account, likes, playlists and recommendations all work as normal.

> **Unofficial.** This project isn't affiliated with, endorsed by or connected to Google or YouTube. You need your own YouTube Music account, and a Premium account for ad-free and background playback.

## Features

- **Your library:** Liked Songs, Albums and Artists, loaded in full and quick to browse.
- **Search** across songs, albums, artists and playlists.
- **Queue and lyrics panels**, with synced lyrics from [LRCLIB](https://lrclib.net/) where available.
- **Equalizer.**
- **Windows integration:** media keys, the Windows media overlay with artwork, and play/pause/skip buttons on the taskbar thumbnail.
- **Discord status:** optionally show "Listening to…" on your Discord profile.
- **Listening history** and play stats, stored locally.
- **Keyboard-first:** shortcuts for nearly everything (press `?` in the app to see them all), and the whole interface works without a mouse.
- **Audio-only mode** to skip loading video.
- Remembers your window size, volume and last song between restarts.

## Install

Windows 10/11 (x64) only for now.

1. Download the latest `…_x64-setup.exe` from the [Releases](https://github.com/BradExplodes/youtube-native-app/releases) page.
2. Run it. Windows SmartScreen may warn about an unknown publisher because the installer isn't code-signed. Choose **More info → Run anyway**.
3. Open the app and sign in to YouTube Music when prompted.

## Privacy

- You sign in on YouTube's own sign-in page, shown inside the app. Your password never passes through this app's code.
- Your login session is stored only in the app's local WebView2 profile on your computer.
- The app talks to YouTube/Google for music, LRCLIB for lyrics and, if you turn it on, the Discord app running on your own computer. It doesn't use analytics or telemetry, and it has no servers of its own.
- Settings, history and logs live in your local app data folder. **Settings → Open log folder** takes you there.

## Building from source

You'll need:

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/) (stable)
- The [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/): Microsoft C++ Build Tools and WebView2 (WebView2 is already installed on Windows 11)

```powershell
pnpm install
pnpm tauri dev      # run with hot reload
pnpm tauri build    # build the installer into src-tauri/target/release/bundle/nsis/
pnpm test           # run the parser tests
pnpm check          # type-check the frontend
```

### Project layout

| Path | What's there |
| --- | --- |
| `src/` | The Svelte UI: views, stores and the YouTube Music response parsers (`src/lib/ytm/`) |
| `src-tauri/src/` | The Rust side: window and player management, media controls, Discord, history, settings |
| `src-tauri/scripts/player-bridge.js` | Script injected into the hidden YouTube Music page that does the actual playback |

Real API responses captured from your own account during development go in `src/lib/ytm/__fixtures__/raw/`. That folder is git-ignored because it contains personal data.

## Contributing

Issues and pull requests are welcome. Please run `pnpm test` and `pnpm check` before opening a PR.

## Licence

[MIT](LICENSE)
