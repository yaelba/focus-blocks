# Focus

A single-user focus-block timer. Static files only, with data in `localStorage`.

- `storage.js` handles all persistence (async API). Replace it to sync through a server.
- `app.js` contains the UI. `dates.js` has the date helpers. `style.css` has the styles.

Run locally (ES modules don't load from `file://`):

    python3 -m http.server 8765

Deploy: push to GitHub, then Settings → Pages → deploy from the `main` branch, root folder.
