<p align="center">
  <img width="120px" src="assets/img/logo2-noBG.png" alt="Amber" />
</p>

<h1 align="center">Amber</h1>

<p align="center">
  A fast, native-feeling desktop client for YouTube Music.<br />
  Built with Tauri, React and TypeScript for <b>Windows, macOS and Linux</b>.
</p>

<p align="center">
  <a href="https://github.com/Pant0x/Amber-Music-Platform/releases/latest"><img src="https://img.shields.io/github/downloads/Pant0x/Amber-Music-Platform/total?style=for-the-badge&color=ff0033&label=downloads" alt="Downloads"></a>
  <a href="https://github.com/Pant0x/Amber-Music-Platform/releases/latest"><img src="https://img.shields.io/github/package-json/v/Pant0x/Amber-Music-Platform?style=for-the-badge&color=ff3d00&label=version" alt="Version"></a>
  <a href="https://github.com/Pant0x/Amber-Music-Platform/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Pant0x/Amber-Music-Platform?style=for-the-badge&color=ff6900" alt="License"></a>
  <a href="https://github.com/Pant0x/Amber-Music-Platform/stargazers"><img src="https://img.shields.io/github/stars/Pant0x/Amber-Music-Platform?style=for-the-badge&color=ff9700&label=stars" alt="Stars"></a>
  <a href="https://aur.archlinux.org/packages/amber"><img src="https://img.shields.io/aur/version/amber?style=for-the-badge&color=ffc300&label=AUR" alt="AUR"></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/img/Screenshot01.png" />
    <source media="(prefers-color-scheme: light)" srcset="assets/img/Screenshot02.png" />
    <img src="assets/img/Screenshot01.png" alt="Amber home view" width="900" />
  </picture>
</p>

> [!IMPORTANT]
> Amber is an independent, unofficial project. It is not affiliated with, authorized by,
> sponsored by, or endorsed by YouTube or Google.

<br />

## About

Amber brings YouTube Music to the desktop as its own application, not a browser tab. There is
no official desktop client, so the goal is a fast, native-feeling one that holds up with large
libraries.

If you find it useful, **starring the repo** genuinely helps.

<br />

## Screenshots

<table>
  <tr>
    <td width="50%"><b>Synced lyrics</b></td>
    <td width="50%"><b>Artist page</b></td>
  </tr>
  <tr>
    <td><img src="assets/img/Amber-d-1.2.PNG" alt="Synced lyrics following the current line" /></td>
    <td><img src="assets/img/Amber-d4-1.2.PNG" alt="An artist page showing popular songs and releases" /></td>
  </tr>
  <tr>
    <td><sub>Click a line to seek, nudge the timing if a match is off, and see which source the words came from.</sub></td>
    <td><sub>Popular tracks and every release, filtered by albums, singles or EPs.</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td width="50%"><b>Queue</b></td>
    <td width="50%"><b>Library</b></td>
  </tr>
  <tr>
    <td><img src="assets/img/Amber-d3-1.2.PNG" alt="The queue panel open beside the home view" /></td>
    <td><img src="assets/img/Amber-l5-1.2.PNG" alt="The library songs list, with explicit badges and the now-playing meter" /></td>
  </tr>
  <tr>
    <td><sub>Separates what you added by hand from what came next on its own.</sub></td>
    <td><sub>Marks what is liked, downloaded and explicit at a glance.</sub></td>
  </tr>
</table>

<p align="center">
  <img src="assets/img/Amber-set-1.2.PNG" alt="Amber settings, showing the library and lyrics options" width="860" />
  <br />
  <sub>Settings — quality, lyrics source, translation and text size, downloads and the disk cap.</sub>
</p>

<br />

## Features

| Feature | Description |
|---|---|
| **Search** | Ctrl+Space from anywhere, across artists, songs, playlists and albums |
| **Multiple tabs** | Each tab keeps its own queue, volume and player state — start an album in one, browse in another, and the first keeps playing |
| **Offline downloads** | Save a song, a selection, or a whole album or playlist, with its own quality setting and a size cap you control |
| **Mini player** | A morphing capsule that appears when you tab away; drag it anywhere, hover to expand |
| **Synced lyrics** | Line-by-line lyrics that follow the song, unlike the official web client. Click a line to jump to it, nudge the timing if a match is off, and pick which source is tried first |
| **Lyrics translation** | A translation under each line, in any of twenty languages, with an adjustable text size |
| **Like & dislike** | Rate from the row, the player or the right-click menu — ratings sync to your YouTube Music account |
| **Batch actions** | Shift/ctrl-select rows, then queue, download, add to a playlist or remove them together |
| **Queue control** | Collapses to an artwork-only rail; end the queue at a track, generate more from it, shuffle or clear what's next |
| **Recommendations** | Personalised suggestions plus a "surprise me" shuffle — hide the carousel if you would rather open on your library |
| **Browse** | Explore, charts, moods and genres, and podcasts, with mood chips you can drill into |
| **Local files** | Folders from your own machine sit alongside your library, with a tag editor for fixing metadata |
| **Discord & Last.fm** | Rich Presence and scrobbling, each toggleable straight from the toolbar |
| **Account support** | Sign in with Google for your library and playlists, and switch between channels on the same account |
| **Playlist import/export** | Save a playlist to a file and bring it back, on this machine or another |
| **Desktop integration** | Media keys, minimise to tray, launch at login, remembered window position, rebindable shortcuts |
| **Light & dark themes** | Follows the OS by default, or pin either one — plus a reduced-motion mode |
| **Caching** | Playlists, lyrics and artwork are cached, so revisits are instant |
| **Auto-updates** | Signed updates install themselves; no manual re-download |

<br />

## Download

Grab the newest installer from the **[latest release](https://github.com/Pant0x/Amber-Music-Platform/releases/latest)**
for Windows, macOS or Linux.

On Arch and derivatives, install from the AUR instead:

```bash
yay -S Amber     # or: paru -S Amber
```

<br />

## Platform support

- **Windows** — primary target; the most tested of the three.
- **macOS** — supported; the build is unsigned (see below).
- **Linux** — supported across major distros; runs on your system's WebKitGTK and GStreamer.

### Linux notes

Install the `.deb` or `.rpm`, or `Amber` from the AUR on Arch. All three run on your system's
WebKitGTK (rendering) and GStreamer (playback) rather than bundling their own.

<details>
<summary>🔇 No sound, or "YouTube player error 5"</summary>

Most distros don't install the codecs YouTube needs by default:

```bash
# Debian, Ubuntu, Mint
sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-base gstreamer1.0-plugins-good

# Fedora (gstreamer1-libav needs RPM Fusion enabled)
sudo dnf install gstreamer1-libav gstreamer1-plugins-base gstreamer1-plugins-good

# Arch — installed automatically with the AUR package
sudo pacman -S gst-libav gst-plugins-base gst-plugins-good
```

Confirm they registered:

```bash
gst-inspect-1.0 | grep -E 'avdec_aac|avdec_h264'
```

</details>

<details>
<summary>⬜ A blank grey window</summary>

A WebKitGTK rendering problem under Wayland, most often on Nvidia. Launch from a terminal
with one of:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 Amber
WEBKIT_DISABLE_COMPOSITING_MODE=1 Amber
GDK_BACKEND=x11 Amber
```

Launching from an app menu instead? Add the same variable to the `Exec` line of
`Amber.desktop` (typically `/usr/share/applications/Amber.desktop`, or
`~/.local/share/applications/Amber.desktop` for a user install):

```
Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 Amber
```

</details>

<details>
<summary>⚠️ An EGL error on launch</summary>

Preload the system Wayland client library:

```bash
LD_PRELOAD=/usr/lib/libwayland-client.so ~/Downloads/Amber*.AppImage
```

In Gear Lever, add `LD_PRELOAD=/usr/lib/libwayland-client.so` to Amber's environment variables.

</details>

#### 🪵 Anything else

Open **Settings → Library → Application log**, reproduce the problem, and attach the log to
an issue along with your desktop environment, display server (X11 or Wayland) and distro —
those three narrow down a Linux bug faster than anything else. The log also lives at
`~/.local/share/com.amber.desktop/logs/current.log`.

### macOS notes

#### "Apple is not able to verify that it is free from malware"

The macOS builds aren't signed with an Apple Developer ID, so Gatekeeper blocks them on first
launch. This isn't a malware finding — it means the binary is unsigned. Drag Amber to
Applications, then either:

- open **System Settings → Privacy & Security**, scroll to the message about Amber, and click
  **Open Anyway**, or
- clear the quarantine flag yourself:

```bash
xattr -dr com.apple.quarantine /Applications/Amber.app
```

Build from source instead if you'd rather not trust a prebuilt, unsigned binary.

#### A Keychain prompt on sign-in

Amber stores one encryption key in its own Keychain entry and encrypts your YouTube Music
session with it before writing anything to the app data directory. Choose **Always Allow** to
avoid repeated prompts — or **Deny** if you don't intend to sign in to YouTube Music.

<br />

## For developers

### Prerequisites

- Node.js LTS and npm
- [Rust and Cargo](https://rustup.rs/)
- C++ build tools (MSVC on Windows)
- Microsoft Edge WebView2 Runtime (Windows)

The Tauri CLI ships in the project's dev dependencies — no global install needed.

### Install, run, build

```bash
npm install
npm run tauri dev
npm run tauri build
```

### Architecture

The `docs/` folder documents the codebase:

- [`docs/architecture.md`](docs/architecture.md) — system overview and module map
- [`docs/frontend.md`](docs/frontend.md) — React structure, styling tokens, icon conventions
- [`docs/backend.md`](docs/backend.md) — Rust commands and the IPC surface

### Contributing

Contributions are welcome. Fork the repo, branch, test locally, and open a pull request
describing what changed and why. For larger changes, open an issue first so the approach can
be discussed.

By contributing you agree to the [Contributor License Agreement](CLA.md).

<br />

## Credits

Amber is a fork of **[amber-musicplayer](https://github.com/2latemc/amber-musicplayer)**
by [2latemc](https://github.com/2latemc), used under the Apache 2.0 licence. The original
project did the hard groundwork of getting YouTube Music working on the desktop.

If you want to support the original author, they accept donations
[on Ko-fi](https://ko-fi.com/totally2late).

<br />

## Legal

**Amber provides no downloading functionality.** It is a client for audio listening, with
theming and interface additions.

Amber interacts with YouTube and YouTube Music. Access to those services remains governed by
their own terms, policies, availability and regional restrictions.

Amber does not host or claim ownership of music, videos, artwork, metadata, or any other
content supplied by third parties. Rights in that content remain with their respective
owners.

The project is not intended to circumvent access controls, geographic restrictions,
advertising, paid service requirements, or content licensing, nor to enable unauthorised
downloading, copying, redistribution or public performance of third-party content.

YouTube and YouTube Music are trademarks of Google LLC. All other trademarks are the property
of their respective owners. References to third-party products describe compatibility and
integration only.

- [YouTube Terms of Service](https://www.youtube.com/static?template=terms)
- [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)

## Thanks to our contributors

<a href="https://github.com/Pant0x/Amber-Music-Platform/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Pant0x/Amber-Music-Platform" />
</a>
