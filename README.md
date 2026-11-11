# Focus

A single-user focus-block timer for Mac Chrome. Static files only, data in `localStorage`.
Live at https://yaelba.github.io/focus-blocks/.

## App logic

There are two concepts: **tasks** and **blocks**.

- **Task** — something to work on, with one tag. You add tasks by writing them into the
  day's list (the start-of-day screen, then the "Add a task" row on Today).
- **Block** — a task plus a duration. You create one by picking a task from the list
  (click it) and giving it a length (10 minutes by default, editable), then pressing Start.
  When the time is up you mark the block **Done** or **Strayed**.

Where they show up:

- **Today** — the day's open tasks, the next/running block, and today's completed blocks
  with their total focus time.
- **Recent** — only completed blocks, for the last 7 days, as rectangles colored by tag
  with a daily total.
- **Archive** — every task from past days (one entry per distinct task per day), with
  the minutes of completed blocks on it that day.
- **Tags** — create, rename, recolor and delete tags.

In the UI and the code a block is called a *session* ("Next session", "Completed sessions",
`saveSession`).

## Behavior rules

- A block is **completed** only if it ran its full length and was marked Done. Strayed
  and Quit midway blocks are not recorded at all, and the task is re-selected for another try.
- Done does not finish the task: it stays in the list, since it may need more blocks.
- Each day starts with an empty list; nothing carries over. Past tasks are copied from
  the Archive.
- Deleting a task from Today only hides it (it still appears in that day's Archive).
  Deleting from the Archive removes it for good.
- A task added twice on the same day (same text, ignoring case and spaces) is one Archive
  entry; its minutes are summed. Archive entries are sorted by minutes, most first.
- At the end of a block: a chime and a desktop notification (permission asked on the
  first Start). While a block runs, the screen is kept awake so the Mac doesn't sleep and
  delay the alarm — only while the tab is visible.
- ← / → switch tabs, except while typing in a field.

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
