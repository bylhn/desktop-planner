# Desktop Planner

<p align="center"><a href="README.md">한국어</a> · <b>English</b></p>

A **transparent study-planner widget that lives on your Windows desktop**.
Check off fixed daily routines and each day's to-dos, and look back on your progress with charts.

<p align="center">
  <a href="https://github.com/bylhn/desktop-planner/releases/latest">
    <img src="https://img.shields.io/github/v/release/bylhn/desktop-planner?style=for-the-badge&logo=windows&logoColor=white&label=Download%20for%20Windows&color=6b5cff" alt="Download for Windows" height="44">
  </a>
</p>
<p align="center"><sub>Windows 10/11 (64-bit) · Free · No account needed · 📖 <a href="GUIDE.en.md">User guide</a> · 🌐 <a href="https://bylhn.github.io/desktop-planner/">Website</a></sub></p>
<p align="center">▶ <a href="https://bylhn.github.io/desktop-planner/#try"><b>Try it in your browser — no install</b></a></p>
<p align="center"><sub>The demo lets you check off to-dos and routines, add, edit and delete (and undo) calendar events, preview 🔔 reminders and open the dashboard.</sub></p>

> The app is available in **English and Korean**. It follows your Windows language, and you can switch any time in ⚙ Settings → Language.

![Day view](docs/screenshot-day-en.png)

## Features

- **Pinned to the desktop** — no taskbar button; it always stays behind other windows, right on your desktop. Press **⊞ Windows key + D** (Show desktop) to hide other windows and see just the planner.
- **Frosted-glass look** — shows a blurred copy of your wallpaper; adjustable transparency and light/dark text.
- **Fixed routines** — a checklist that comes back every day, or only on the weekdays you pick.
- **Today's to-dos** — one-off tasks for a given day. Start with a time, like `14:00 Prepare meeting`, and they are sorted by time.
- **Completion history** — every check is recorded per day, and the mini calendar is shaded by how much you got done.
- **Dashboard** — current and longest streak, 30-day completion chart, 20-week heatmap, and per-routine completion rates. Toggle it from the bottom-right corner.
- **Sign in with Google** — one click shows your Google Calendar events (holidays included) right in the planner; pick which calendars to show (refreshed every 15 minutes while you're using the PC).
- **Add events from the Month view** — click a date and type `14:00 Meeting` (one hour), `14:00-15:30 Study` or `Mom's birthday` (all day); it goes straight to Google Calendar and your phone. Events you add on your phone show up in the planner too.
- **Drag to add multi-day events** — press on a date and drag to another to pick a range. Without a time it becomes one all-day event spanning the days; with a time (`09:00 Gym`) the same event is added on each day.
- **Edit and delete events** — click an event's title to change its date, time or title in place, or ✕ to delete it (with a few seconds to undo). Your phone updates too.
- **🔔 Reminders you pick** — hover an event or to-do that has a time and click 🔔: a silent Windows notification shows 5 minutes before it starts (or 10 / 30 — your choice). Only the items you ring; clicking the notification opens that day.
- **Automatic backups** — a dated copy every day (last 30 days); a damaged data file is restored automatically on start. The tray icon always stays.
- **iCal subscriptions** — also connect iCloud, Outlook or any calendar that offers an iCal (ICS) link.
- **Month view** — click a date once to open a scrollable panel with that day's events; the **To-dos ▾** button next to the date shows its to-dos. Click the date again or any empty spot to close it; double-click to jump to that day.
- Move unfinished past to-dos to today, start with Windows.

![Dashboard](docs/screenshot-dashboard-en.png)

## Install

1. **[Click here to download the installer](https://github.com/bylhn/desktop-planner/releases/latest/download/DesktopPlanner-Setup.exe)** (always the latest version) and run `DesktopPlanner-Setup.exe`.
2. This is a personal project without a code-signing certificate, so Windows may show a "Windows protected your PC" warning. Click **More info → Run anyway**.
3. When setup finishes, the planner appears on your desktop. Right-click its purple tray icon (next to the clock) for start-with-Windows, reset position, and quit. Can't see it? Click the **^** next to the clock.

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

## Good to know

- **Free and open source (MIT)** — add features yourself, or suggest them in [issues](https://github.com/bylhn/desktop-planner/issues) or a PR.
- **Your own changes vs. updates** — edits made directly to the installed app's files are replaced by updates. To keep your own changes, fork the repository, build it yourself, and merge new versions in. Updates may change the app's structure, so features you added yourself aren't guaranteed to keep working.
- **Your records are safe** — your data and backups live separately in `%APPDATA%\desktop-planner` and are never touched by updates.
- **Your choice on updates** — in ⚙ Settings → **Automatic updates → Off (notify only)** the app only tells you about new versions; nothing downloads or installs unless you click.

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
