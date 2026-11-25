# Desktop Planner

<p align="center"><a href="README.md">한국어</a> · <b>English</b></p>

A **transparent study-planner widget that lives on your Windows desktop**.
Check off fixed daily routines and each day's to-dos, and look back on your progress with charts.

<p align="center">
  <a href="https://github.com/bylhn/desktop-planner/releases/latest">
    <img src="https://img.shields.io/github/v/release/bylhn/desktop-planner?style=for-the-badge&logo=windows&logoColor=white&label=Download%20for%20Windows&color=6b5cff" alt="Download for Windows" height="44">
  </a>
</p>
<p align="center"><sub>Windows 10/11 (64-bit) · Free · No account needed · 📖 <a href="GUIDE.en.md">User guide</a></sub></p>

> The app is available in **English and Korean**. It follows your Windows language, and you can switch any time in ⚙ Settings → Language.

![Day view](docs/screenshot-day-en.png)

## Features

- **Pinned to the desktop** — no taskbar button; it always stays behind other windows, right on your desktop. It survives `Win + D`.
- **Frosted-glass look** — shows a blurred copy of your wallpaper; adjustable transparency and light/dark text.
- **Fixed routines** — a checklist that comes back every day, or only on the weekdays you pick.
- **Today's to-dos** — one-off tasks for a given day. Start with a time, like `14:00 Prepare meeting`, and they are sorted by time.
- **Completion history** — every check is recorded per day, and the mini calendar is shaded by how much you got done.
- **Dashboard** — current and longest streak, 30-day completion chart, 20-week heatmap, and per-routine completion rates. Toggle it from the bottom-right corner.
- **Sign in with Google** — one click shows your Google Calendar events (holidays included) right in the planner; pick which calendars to show (read-only, refreshed every 15 minutes).
- **iCal subscriptions** — also connect iCloud, Outlook or any calendar that offers an iCal (ICS) link.
- **Month view**, move unfinished past to-dos to today, start with Windows.

![Dashboard](docs/screenshot-dashboard-en.png)

## Install

1. Click **Download for Windows** above (or open the [latest release](https://github.com/bylhn/desktop-planner/releases/latest)) and run `DesktopPlanner-Setup-x.y.z.exe`.
2. This is a personal project without a code-signing certificate, so Windows may show a "Windows protected your PC" warning. Click **More info → Run anyway**.
3. When setup finishes, the planner appears on your desktop. Right-click its tray icon (bottom-right of the taskbar) for start-with-Windows, reset position, and quit.

> Runs on Windows 10/11 (64-bit) on its own — no other app or account required.

## How to use

| To do this | Do this |
|---|---|
| Move / resize | Click 🔒 to unlock → drag the top bar to move, drag an edge to resize → lock again |
| Add a fixed routine | Click **Edit** next to **Fixed routines** → type it, pick weekdays (none = every day) |
| Add a to-do | Type in the box at the bottom and press Enter. A leading time sorts it: `07:00 Wake up` or `7am Wake up` |
| Edit / delete | Double-click the text to edit; hover and click ✕ to delete |
| See another day | ◀ ▶ at the top, or click a date in the mini calendar |
| Dashboard | Toggle **📊 Dashboard** at the bottom-right (Esc also closes it) |
| Google Calendar | ⚙ Settings → **Sign in with Google** → choose your account and allow |
| Other calendars | ⚙ Settings → **Other calendars (iCal link)** → paste the link → **Add** |
| Change language | ⚙ Settings → **Language** → 한국어 / English |

### Signing in with Google

This personal project hasn't gone through Google's app review yet, so you'll see **"Google hasn't verified this app"**. Click **Advanced → Go to Desktop Planner** and allow. The app only **reads** your calendar and keeps events on your computer — see the [privacy policy](PRIVACY.md).

### Finding an iCal link

- **Outlook**: Settings → Calendar → Shared calendars → Publish a calendar → copy the **ICS** link
- **Apple iCloud**: in Calendar, share the calendar → turn on **Public Calendar** → copy the link (`webcal://` links work too)

> Treat a secret address like a password: anyone who has it can see your events.

## Data & privacy

Everything is stored only on your computer, in `%APPDATA%\desktop-planner\planner-data.json`.
No account is needed and your records are never uploaded. The only network access is downloading events from the calendars you connect (Google, iCal). Google sign-in tokens stay on your computer, encrypted with Windows DPAPI. → [Privacy policy](PRIVACY.md)
To back up, just copy that file.

## Run from source (developers)

Requires [Node.js](https://nodejs.org/) 18 or later.

```bash
npm install
npm start
```

Build the installer:

```bash
npm run dist
```

The installer is written to `dist/`. To redraw the icon, run `npm run icon` (needs Python + Pillow).

For Google sign-in, create a **Desktop app** OAuth client in Google Cloud (with the Calendar API enabled) and save its JSON as `google-client.json`. That file is git-ignored.

## License

[MIT](LICENSE)
