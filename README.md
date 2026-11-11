# Focus

A single-user focus-block timer used so far on Mac Chrome. Static files only, data in the browser's `localStorage`.
Live at https://yaelba.github.io/focus-blocks/.

## App logic

There are two concepts: **tasks** and **blocks**.

- **Task** — something to work on. You add tasks by writing them into the day's list.
  Archive shows tasks from previous days' lists.
- **Block** — a task plus a duration. You create one by picking a task from the list and assigning it a length.
  When the time is up you mark the block **Done** or **Strayed**.

Tabs:

- **Today** — the day's open tasks, the next/running block, and today's completed blocks
  with their total focus time.
- **Recent** — a per-day history of completed blocks only, as rectangles colored by tag with a daily total.
- **Archive** — every task from past days (also those wo completed blocks), with the minutes of completed blocks on it that day.
- **Tags** — create, rename, recolor and delete tags.

In the UI and the code a block is called a *session* ("Next session", "Completed sessions",
`saveSession`).

## Behavior rules

- A block is **completed** only if it ran its full length and was marked Done. Strayed
  and Quit midway blocks are not recorded at all.
- Done does not finish the task: it stays in the list, since it may need more blocks.
- Each day starts with an empty list; nothing carries over. 
  Archive includes tasks from previous days that can be copied.
- Deleting a task from Today only hides it (it still appears in that day's Archive).
  Deleting from the Archive removes it for good.
- A task added twice on the same day (same text, ignoring case and spaces) is one Archive
  entry; its minutes are summed. Archive entries are sorted by minutes, most first.
- At the end of a block: a chime and a desktop notification (permission asked on the
  first Start). While a block runs, the screen is kept awake so the Mac doesn't sleep and
  delay the alarm — only while the tab is visible.
- ← / → switch tabs, except while typing in a field.
- If a save fails, a red notice says so (and whether storage is full). On load, a notice
  warns once storage passes 80% of the ~5M-character limit, which is shared by every app
  on `yaelba.github.io`.

## Code design

| File | Role |
|---|---|
| `index.html` | Page shell; loads `style.css` and `app.js` |
| `app.js` | All UI: state, rendering, timer, sound, notifications, wake lock, keyboard |
| `storage.js` | **All persistence** — the only file that touches `localStorage` |
| `dates.js` | Date helpers (`todayStr`, `addDays`, `dayLabel`, `clock`) |
| `style.css` | Styles (light mode only; colors as variables in `:root`) |
| `icon.svg` | Tab icon |

**Storage boundary.** The UI only calls the async functions in `storage.js` (`listTags`,
`saveTag`, `getDay`, `saveTask`, `saveSession`, `listRecentDays`, `listPastDays`, …).
To sync with a phone later, replace that file with calls to a server; nothing else changes.

**Stored data.** Keys `focus.tags` and `focus.day.YYYY-MM-DD`.

```
Tag     { id, name, color }
Day     { date, tasks: [Task], sessions: [Session] }
Task    { id, text, tagId, removed? }        // removed = deleted from Today, kept for the Archive
Session { id, taskId, taskText, tagId, minutes, startAt, endAt, outcome: null | 'done', note }
```

Older data may have `task.done` (an earlier version ticked tasks on Done; such tasks stay
hidden) and `session.endedEarly` (filtered out as not completed).

**Timer.** A block is saved when it starts, with its end time. The countdown is computed
from that timestamp, so a reload resumes it. One `setTimeout` fires the alarm (it counts
as the end even if it fires a few ms early); a 1-second interval only updates the display.

**Rendering.** A small `h()` helper builds DOM nodes; most changes re-render the whole
view. Picking a task updates the DOM in place so double-click-to-edit still works.

No framework, no build step, no dependencies.

## Run and deploy

Run locally (ES modules don't load from `file://`):

    python3 -m http.server 8765

Local data is separate from the live site's (different address, different `localStorage`).

Deploy: push to `main`; GitHub Pages serves the repo root. It's live in about a minute,
then press **Cmd+Shift+R** — Pages lets browsers cache files for 10 minutes.

## Decisions

- **Static site on GitHub Pages, data in `localStorage`** — one user, one device, no
  server or login needed; losing data is acceptable.
- **Persistence behind `storage.js`** — keeps the door open for phone sync via a server.
- **Only completed blocks are recorded** — keeps Recent an honest record of real focus.
- **Tasks are soft-deleted from Today** — so the Archive keeps everything you listed.
- **Screen wake lock during blocks** — a sleeping Mac delayed the chime.
- **No cache-busting yet** — Cmd+Shift+R after deploys is acceptable for now.

## Possible future changes

**Back up data to a file on the Mac (File System Access API).** Today everything lives
only in `localStorage`, which is lost if site data is cleared. Chrome and Edge (desktop
only — not Safari, Firefox or phones) let a page write to one file the user picks:

- Set up once: click "Choose backup file", pick e.g. `focus-data.json` (in iCloud Drive
  or Dropbox it also syncs across Macs), then choose "Allow on every visit" when Chrome
  asks again on a later visit. After that the app saves to it on every change, no prompts.
- Reconnect (one or two clicks, no data lost — the file is the safe copy) if: site data
  or permissions are cleared (the link to the file is stored in browser storage), the
  file is moved/renamed, "Allow this time" was picked, Chrome auto-revokes permissions
  for a long-unused site (unconfirmed whether this applies to files), or on a new
  computer/profile. The app should show a "Reconnect backup file" notice, not fail silently.
- Implementation: `storage.js` writes to the file as well as (or instead of)
  `localStorage`; add connect / reconnect / load-from-file controls.
- Smaller alternative: manual Export / Import buttons (download a file, load it back).
