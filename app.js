import * as store from './storage.js';
import { todayStr, addDays, dayLabel, clock } from './dates.js';

const PALETTE = ['#3d7cc9', '#3a9a68', '#e0892f', '#d2527f', '#7b5cc8', '#25999b', '#c9a227', '#7c776d'];
// Earlier default colors, swapped for their brighter counterparts on load.
const OLD_PALETTE = ['#7d9cc0', '#8db59a', '#d3a477', '#c58ca0', '#a69bcb', '#86b4b4', '#c8b66e', '#a7a29a'];
const RECENT_DAYS = 7;
const DEFAULT_MINUTES = 10;

const state = {
  view: 'today',
  date: todayStr(),
  tags: [],
  day: null,
  recent: [],
  archive: [],
  pending: null, // { date, session } for a session without an outcome yet
  startTaskId: null,
  startMinutes: DEFAULT_MINUTES,
  newTaskTagId: null,
  newTaskText: '',
  draft: null, // start-of-day rows: [{ text, tagId }]
  focus: null, // element id to focus after the next render
};

const app = document.getElementById('app');
const uid = () => crypto.randomUUID();

// --- tiny DOM helper ---

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const tagById = (id) => state.tags.find((t) => t.id === id);
const tagColor = (id) => tagById(id)?.color ?? '#a9a59b';

// --- loading ---

async function load() {
  state.date = todayStr();
  [state.tags, state.day] = await Promise.all([store.listTags(), store.getDay(state.date)]);
  await upgradeTagColors();
  state.pending = await findPending();
  await loadViewData();
  syncTimers();
  render();
}

async function upgradeTagColors() {
  for (const tag of state.tags) {
    const i = OLD_PALETTE.indexOf(tag.color);
    if (i === -1) continue;
    tag.color = PALETTE[i];
    await store.saveTag(tag);
  }
}

// A session started late yesterday may still be waiting for its outcome.
async function findPending() {
  for (const date of [state.date, addDays(state.date, -1)]) {
    const day = date === state.date ? state.day : await store.getDay(date);
    const session = day.sessions.find((s) => !s.outcome);
    if (session) return { date, session };
  }
  return null;
}

async function reloadDay() {
  state.day = await store.getDay(state.date);
}

// --- rendering ---

function render() {
  const views = { today: renderToday, recent: renderRecent, tags: renderTags, archive: renderArchive };
  app.replaceChildren(renderHeader(), views[state.view]());
  if (state.focus) {
    document.getElementById(state.focus)?.focus();
    state.focus = null;
  }
  tick();
}

function renderHeader() {
  const tab = (view, label) =>
    h('button', { class: 'tab' + (state.view === view ? ' active' : ''), onclick: () => show(view) }, label);
  return h('header', {},
    h('div', { class: 'date' }, dayLabel(state.date)),
    h('nav', {}, tab('today', 'Today'), tab('recent', 'Recent'), tab('tags', 'Tags'), tab('archive', 'Archive')));
}

async function loadViewData() {
  if (state.view === 'recent') state.recent = await store.listRecentDays(state.date, RECENT_DAYS);
  if (state.view === 'archive') state.archive = await store.listPastDays(state.date);
}

async function show(view) {
  state.view = view;
  await loadViewData();
  render();
}

function section(title, ...body) {
  return h('section', { class: 'card' }, h('h2', {}, title), body);
}

function tagPicker(value, onPick) {
  const tag = tagById(value);
  const select = h('select', {
    class: 'tag-select',
    onchange: async (e) => {
      if (e.target.value !== '__new') return onPick(e.target.value);
      const id = await createTagPrompt();
      if (id) onPick(id);
      else e.target.value = tag ? value : '';
    },
  },
    !tag && h('option', { value: '', disabled: true }, 'Tag…'),
    state.tags.map((t) => h('option', { value: t.id }, t.name)),
    h('option', { value: '__new' }, '+ New tag…'));
  select.value = tag ? value : '';
  return h('span', { class: 'tag-pick', style: tag && `--tag:${tag.color}` },
    h('span', { class: 'dot', style: `background:${tag ? tag.color : 'transparent'}` }),
    select);
}

async function createTagPrompt() {
  const name = prompt('New tag name')?.trim();
  if (!name) return null;
  const tag = { id: uid(), name, color: PALETTE[state.tags.length % PALETTE.length] };
  await store.saveTag(tag);
  state.tags.push(tag);
  return tag.id;
}

// --- Today ---

function renderToday() {
  if (!state.day.tasks.length && !state.pending) return renderStartOfDay();
  return h('div', {},
    renderSessionPanel(),
    section('Tasks', renderTasks()),
    section('Completed sessions', renderSessions()));
}

function renderStartOfDay() {
  if (!state.draft) state.draft = [{ text: '', tagId: state.tags[0]?.id ?? '' }];
  const rows = state.draft;
  const filled = () => rows.filter((r) => r.text.trim());
  const ready = () => filled().length > 0 && filled().every((r) => tagById(r.tagId));

  const addRow = () => {
    rows.push({ text: '', tagId: rows.at(-1)?.tagId ?? '' });
    state.focus = `draft-${rows.length - 1}`;
    render();
  };

  const start = async () => {
    if (!ready()) return;
    for (const r of filled()) {
      await store.saveTask(state.date, { id: uid(), text: r.text.trim(), tagId: r.tagId, done: false });
    }
    state.draft = null;
    await reloadDay();
    render();
  };

  return h('section', { class: 'card start-day' },
    h('h1', {}, 'What will you work on today?'),
    h('ul', { class: 'draft' }, rows.map((r, i) =>
      h('li', { class: 'task' },
        tagPicker(r.tagId, (id) => { r.tagId = id; render(); }),
        h('input', {
          id: `draft-${i}`, class: 'text', value: r.text, placeholder: 'A task',
          oninput: (e) => {
            r.text = e.target.value;
            e.target.closest('section').querySelector('.primary').disabled = !ready();
          },
          onkeydown: (e) => { if (e.key === 'Enter') addRow(); },
        })))),
    h('div', { class: 'actions' },
      h('button', { class: 'quiet', onclick: addRow }, '+ Another task'),
      h('button', { class: 'primary', disabled: !ready(), onclick: start }, 'Start the day')));
}

function renderSessionPanel() {
  const p = state.pending;
  if (p && !p.ended && p.session.endAt > Date.now()) return renderRunning(p.session);
  if (p) return renderOutcome(p.session);
  return renderStartSession();
}

function renderStartSession() {
  const open = state.day.tasks.filter(listed);
  if (!open.length) {
    return h('section', { class: 'card session' }, h('p', { class: 'muted' }, 'All tasks done. Add one below to start another session.'));
  }
  const picked = open.find((t) => t.id === state.startTaskId);
  if (!picked) state.startTaskId = null;

  return h('section', { id: 'next-session', class: 'card session', style: picked && `--tag:${tagColor(picked.tagId)}` },
    h('div', { class: 'label' }, 'Next session'),
    h('div', { class: 'start-row' },
      picked
        ? h('span', { class: 'picked' }, picked.text)
        : h('span', { class: 'picked muted' }, 'Click a task below to pick it'),
      h('label', { class: 'minutes' },
        h('input', {
          type: 'text', inputmode: 'numeric', maxlength: 3, value: state.startMinutes,
          oninput: (e) => {
            e.target.value = e.target.value.replace(/\D/g, '');
            state.startMinutes = Number(e.target.value) || DEFAULT_MINUTES;
          },
          onkeydown: (e) => { if (e.key === 'Enter') startSession(); },
        }),
        'min'),
      h('button', { class: 'primary', disabled: !state.startTaskId, onclick: startSession }, 'Start')));
}

function renderRunning(s) {
  return h('section', { class: 'card session running', style: `--tag:${tagColor(s.tagId)}` },
    h('div', { class: 'label' }, 'Focusing on'),
    h('div', { class: 'session-task' }, s.taskText),
    h('div', { class: 'remaining', id: 'remaining' }, formatLeft(s.endAt - Date.now())),
    h('div', { class: 'running-foot' },
      h('span', { class: 'muted' }, `${s.minutes} min · ends ${clock(s.endAt)}`),
      h('button', { class: 'quiet', onclick: discardSession }, 'Quit midway')));
}

function renderOutcome(s) {
  const note = h('input', { class: 'note', placeholder: 'Short note (optional)', maxlength: 140 });
  return h('section', { class: 'card session ended', style: `--tag:${tagColor(s.tagId)}` },
    h('div', { class: 'label' }, 'Time’s up — how did it go?'),
    h('div', { class: 'session-task' }, s.taskText),
    note,
    h('div', { class: 'outcomes' },
      h('button', { class: 'outcome done', onclick: () => markDone(note.value.trim()) }, 'Done'),
      h('button', { class: 'outcome strayed', onclick: discardSession }, 'Strayed')));
}

function renderTasks() {
  // Finished tasks are hidden; they show up in the sessions list instead.
  const tasks = state.day.tasks.filter(listed);
  // A single click picks the task for the next session; a double-click edits its text.
  const pickable = (t) => listed(t) && !state.pending;
  const list = h('ul', { class: 'tasks' }, tasks.map((t) =>
    h('li', {
      class: 'task' + (t.done ? ' done' : '') + (pickable(t) ? ' pickable' : '') +
        (pickable(t) && t.id === state.startTaskId ? ' selected' : ''),
      'data-id': t.id,
      style: `--tag:${tagColor(t.tagId)}`,
      onclick: (e) => {
        if (!pickable(t) || e.target.closest('select, button, .handle')) return;
        if (e.target.matches('input.text') && !e.target.readOnly) return;
        pickTask(t.id);
      },
      ondragstart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
      ondragover: dragOver,
      ondragend: dragEnd,
    },
      h('span', {
        class: 'handle', title: 'Drag to reorder',
        onpointerdown: (e) => { e.target.closest('li').draggable = true; },
        onpointerup: (e) => { e.target.closest('li').draggable = false; },
      }, '⠿'),
      tagPicker(t.tagId, (id) => updateTask(t.id, { tagId: id })),
      h('input', {
        class: 'text', value: t.text, readonly: true, title: 'Double-click to edit',
        ondblclick: (e) => {
          e.target.readOnly = false;
          e.target.select();
        },
        onblur: (e) => { e.target.readOnly = true; },
        onchange: (e) => {
          const text = e.target.value.trim();
          if (!text) e.target.value = tasks.find((x) => x.id === t.id).text;
          else updateTask(t.id, { text });
        },
        onkeydown: (e) => {
          if (e.key === 'Escape') e.target.value = tasks.find((x) => x.id === t.id).text;
          if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
        },
      }),
      trashButton('Delete task', () => removeTask(t)))));

  if (!tagById(state.newTaskTagId)) {
    state.newTaskTagId = [...tasks].reverse().find((t) => tagById(t.tagId))?.tagId ?? state.tags[0]?.id ?? null;
  }
  const add = h('form', {
    class: 'task add',
    onsubmit: async (e) => {
      e.preventDefault();
      const input = e.target.elements.text;
      const text = input.value.trim();
      if (!text || !tagById(state.newTaskTagId)) return;
      await store.saveTask(state.date, { id: uid(), text, tagId: state.newTaskTagId, done: false });
      state.newTaskText = '';
      await reloadDay();
      state.focus = 'new-task';
      render();
    },
  },
    tagPicker(state.newTaskTagId, (id) => { state.newTaskTagId = id; state.focus = 'new-task'; render(); }),
    // Kept in state so re-rendering (e.g. after picking a tag) doesn't wipe it.
    h('input', {
      id: 'new-task', name: 'text', class: 'text', placeholder: 'Add a task',
      value: state.newTaskText, oninput: (e) => { state.newTaskText = e.target.value; },
    }),
    h('button', { class: 'quiet' }, 'Add'));

  return [tasks.length ? list : h('p', { class: 'muted' }, 'Nothing left. Add a task below.'), add];
}

// Removed tasks are kept (hidden) so the archive still shows them.
// `done` comes from older versions of the app, which ticked a task on Done.
const listed = (t) => !t.done && !t.removed;

// Only sessions that ran their full length and were marked done are kept.
// (The outcome check also filters out data saved by older versions of the app.)
const completed = (sessions) =>
  sessions.filter((s) => s.outcome === 'done' && !s.endedEarly).sort((a, b) => a.startAt - b.startAt);

function renderSessions() {
  const sessions = completed(state.day.sessions);
  if (!sessions.length) return h('p', { class: 'muted' }, 'No completed sessions yet.');
  return h('ul', { class: 'sessions' }, sessions.map((s) =>
    h('li', { style: `--tag:${tagColor(s.tagId)}` },
      h('span', { class: 'time' }, clock(s.startAt)),
      h('span', { class: 'bar', style: `background:${tagColor(s.tagId)}` }),
      h('span', { class: 'stext' }, s.taskText, s.note && h('span', { class: 'note-text' }, ` — ${s.note}`)),
      h('span', { class: 'mins' }, `${s.minutes} min`))));
}

// --- Today actions ---

const TRASH_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5"/></svg>';

function trashButton(title, onclick) {
  const btn = h('button', { class: 'icon remove', title, 'aria-label': title, onclick });
  btn.innerHTML = TRASH_SVG;
  return btn;
}

// Updates in place (no full render) so a double-click still reaches the same input.
function pickTask(id) {
  state.startTaskId = id;
  for (const li of document.querySelectorAll('.tasks .task')) li.classList.toggle('selected', li.dataset.id === id);
  document.getElementById('next-session')?.replaceWith(renderStartSession());
}

async function updateTask(id, patch, rerender = true) {
  const tasks = state.day.tasks;
  const i = tasks.findIndex((t) => t.id === id);
  tasks[i] = { ...tasks[i], ...patch };
  await store.saveTask(state.date, tasks[i]);
  if (rerender) render();
}

// Drag reordering: rows move live in the DOM; the order is saved on drop.
function dragOver(e) {
  const li = e.currentTarget;
  const dragging = li.parentElement.querySelector('.dragging');
  if (!dragging) return;
  e.preventDefault();
  if (dragging === li) return;
  const r = li.getBoundingClientRect();
  li.parentElement.insertBefore(dragging, e.clientY < r.top + r.height / 2 ? li : li.nextSibling);
}

async function dragEnd(e) {
  const li = e.currentTarget;
  li.draggable = false;
  li.classList.remove('dragging');
  const ids = [...li.parentElement.children].map((x) => x.dataset.id);
  await store.reorderTasks(state.date, ids);
  await reloadDay();
  render();
}

async function removeTask(task) {
  if (!confirm(`Delete “${task.text}”?`)) return;
  await store.saveTask(state.date, { ...task, removed: true });
  await reloadDay();
  render();
}

async function startSession() {
  const task = state.day.tasks.find((t) => t.id === state.startTaskId);
  if (!task) return;
  unlockAudio();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();

  const minutes = Math.max(1, Math.round(state.startMinutes));
  const startAt = Date.now();
  const session = {
    id: uid(), taskId: task.id, taskText: task.text, tagId: task.tagId,
    minutes, startAt, endAt: startAt + minutes * 60_000, outcome: null, note: '',
  };
  await store.saveSession(state.date, session);
  await reloadDay();
  state.pending = { date: state.date, session };
  syncTimers();
  render();
}

// Stopping early or straying: the session isn't recorded and its task stays open.
async function discardSession() {
  const { date, session } = state.pending;
  await store.deleteSession(date, session.id);
  state.startTaskId = session.taskId;
  state.pending = null;
  await reloadDay();
  syncTimers();
  render();
}


async function markDone(note) {
  const { date, session } = state.pending;
  await store.saveSession(date, { ...session, outcome: 'done', note });
  state.pending = null;
  await reloadDay();
  syncTimers();
  render();
}

// --- Timer: the end timestamp is the source of truth ---

let alarmTimeout = null;
let tickInterval = null;
let alertedId = null;

function syncTimers() {
  clearTimeout(alarmTimeout);
  clearInterval(tickInterval);
  const s = state.pending?.session;
  const left = s ? s.endAt - Date.now() : 0;
  if (left > 0) {
    // A single timeout fires reliably in a background tab; the interval only drives the display.
    alarmTimeout = setTimeout(() => onTimeUp(s), left);
    tickInterval = setInterval(tick, 1000);
  }
  keepAwake(left > 0);
}

function tick() {
  const s = state.pending?.session;
  if (!s) {
    document.title = 'Focus';
    return;
  }
  const left = s.endAt - Date.now();
  if (state.pending.ended || left <= 0) {
    document.title = 'Time’s up · Focus';
    if (document.getElementById('remaining')) onTimeUp(s);
    return;
  }
  const text = formatLeft(left);
  document.title = `${text} · ${s.taskText}`;
  const el = document.getElementById('remaining');
  if (el) el.textContent = text;
}

function onTimeUp(s) {
  // The alarm may fire a few ms before endAt; it still counts as the end.
  if (state.pending?.session.id === s.id) state.pending.ended = true;
  clearInterval(tickInterval);
  keepAwake(false);
  if (alertedId !== s.id) {
    alertedId = s.id;
    chime();
    notify(s);
  }
  render();
}

function formatLeft(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function notify(s) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification('Time’s up', { body: s.taskText, requireInteraction: true });
  n.onclick = () => { window.focus(); n.close(); };
}

// --- Screen wake lock: keeps the display (and so the Mac) awake while a session runs ---
// Chrome drops the lock whenever the tab is hidden, so it's re-requested when the tab shows again.

let wakeLock = null; // the WakeLockSentinel, or a promise for it while requesting

async function keepAwake(on) {
  if (!('wakeLock' in navigator)) return;
  if (on && !wakeLock && document.visibilityState === 'visible') {
    wakeLock = navigator.wakeLock.request('screen');
    try {
      wakeLock = await wakeLock;
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      if (!isRunning()) keepAwake(false); // the session ended while we were waiting
    } catch {
      wakeLock = null;
    }
  } else if (!on && wakeLock) {
    const lock = await Promise.resolve(wakeLock).catch(() => null);
    wakeLock = null;
    lock?.release?.();
  }
}

function isRunning() {
  const p = state.pending;
  return Boolean(p && !p.ended && p.session.endAt > Date.now());
}

document.addEventListener('visibilitychange', () => keepAwake(isRunning()));

// --- Sound (Web Audio, no files) ---

let audio = null;

function unlockAudio() {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume();
}

function chime() {
  unlockAudio();
  const t0 = audio.currentTime + 0.05;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const t = t0 + i * 0.28;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 1.7);
  });
}

// After a reload, audio may only start once the page has seen a user gesture.
document.addEventListener('pointerdown', unlockAudio, { once: true });

// --- Recent ---

function renderRecent() {
  return h('section', { class: 'card recent' },
    h('p', { class: 'muted' }, 'Completed sessions from the last few days.'),
    h('ul', { class: 'days' }, state.recent.map((day) => {
      const done = completed(day.sessions);
      return h('li', {},
        h('span', { class: 'day-label' }, dayLabel(day.date)),
        h('span', { class: 'blocks' },
          done.length
            ? done.map((s) => h('span', {
                class: 'chunk',
                style: `background:${tagColor(s.tagId)};width:${Math.max(10, s.minutes * 3)}px`,
                title: `${clock(s.startAt)} · ${s.taskText} · ${s.minutes} min`,
              }))
            : h('span', { class: 'muted' }, '—')));
    })));
}

// --- Archive: past days' tasks as plain text, for copy-pasting ---

// One entry per distinct task text in a day (re-added tasks count once), with
// the minutes of completed sessions on any of its copies.
function archiveEntries(day) {
  const groups = new Map();
  for (const t of day.tasks) {
    const key = t.text.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { text: t.text, tagId: t.tagId, ids: [], minutes: 0 });
    groups.get(key).ids.push(t.id);
  }
  const groupOf = new Map([...groups.values()].flatMap((g) => g.ids.map((id) => [id, g])));
  for (const s of completed(day.sessions)) {
    const g = groupOf.get(s.taskId);
    if (g) g.minutes += s.minutes;
  }
  return [...groups.values()];
}

function renderArchive() {
  if (!state.archive.length) {
    return h('section', { class: 'card' }, h('p', { class: 'muted' }, 'No tasks from earlier days yet.'));
  }
  return h('section', { class: 'card archive' },
    state.archive.map((day) =>
      h('div', { class: 'archive-day' },
        h('h2', {}, dayLabel(day.date)),
        h('ul', {}, archiveEntries(day).map((e) =>
          h('li', {},
            h('span', { class: 'dot', style: `background:${tagColor(e.tagId)}` }),
            h('span', { class: 'archive-text' }, e.text),
            h('span', { class: 'mins' + (e.minutes ? '' : ' none') }, `${e.minutes} min`),
            trashButton('Delete from archive', () => removeArchivedTask(day.date, e))))))));
}

// Removes the task (all its copies); completed sessions keep their own copy of its text.
async function removeArchivedTask(date, entry) {
  if (!confirm(`Delete “${entry.text}” from the archive?`)) return;
  for (const id of entry.ids) await store.deleteTask(date, id);
  state.archive = await store.listPastDays(state.date);
  render();
}

// --- Tags ---

function renderTags() {
  const updateTag = async (id, patch) => {
    const i = state.tags.findIndex((t) => t.id === id);
    state.tags[i] = { ...state.tags[i], ...patch };
    await store.saveTag(state.tags[i]);
  };
  return h('section', { class: 'card tags-view' },
    state.tags.length
      ? h('ul', { class: 'tags' }, state.tags.map((t) =>
          h('li', {},
            h('input', { type: 'color', value: t.color, title: 'Color', onchange: (e) => updateTag(t.id, { color: e.target.value }) }),
            h('input', {
              class: 'text', value: t.name,
              onchange: (e) => {
                const name = e.target.value.trim();
                if (name) updateTag(t.id, { name });
                else e.target.value = state.tags.find((x) => x.id === t.id).name;
              },
              onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
            }),
            h('button', { class: 'icon', title: 'Delete', onclick: () => removeTag(t) }, '×'))))
      : h('p', { class: 'muted' }, 'No tags yet.'),
    h('button', { class: 'quiet', onclick: async () => { if (await createTagPrompt()) render(); } }, '+ New tag'));
}

async function removeTag(tag) {
  if (!confirm(`Delete tag “${tag.name}”? Tasks and sessions using it will turn gray.`)) return;
  await store.deleteTag(tag.id);
  state.tags = state.tags.filter((t) => t.id !== tag.id);
  render();
}

// --- day rollover ---

function checkDate() {
  if (todayStr() !== state.date) {
    state.draft = null;
    load();
  }
}
document.addEventListener('visibilitychange', checkDate);
setInterval(checkDate, 60_000);

load();
