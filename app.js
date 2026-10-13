import * as store from './storage.js';
import { todayStr, addDays, dayLabel, clock } from './dates.js';

const PALETTE = ['#7d9cc0', '#8db59a', '#d3a477', '#c58ca0', '#a69bcb', '#86b4b4', '#c8b66e', '#a7a29a'];
const OUTCOMES = { done: 'Done', partial: 'Partial', derailed: 'Derailed' };
const RECENT_DAYS = 7;
const DEFAULT_MINUTES = 10;

const state = {
  view: 'today',
  date: todayStr(),
  tags: [],
  day: null,
  recent: [],
  pending: null, // { date, session } for a session without an outcome yet
  startTaskId: null,
  startMinutes: DEFAULT_MINUTES,
  newTaskTagId: null,
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
const tagColor = (id) => tagById(id)?.color ?? '#c9c6bf';

// --- loading ---

async function load() {
  state.date = todayStr();
  [state.tags, state.day] = await Promise.all([store.listTags(), store.getDay(state.date)]);
  state.pending = await findPending();
  if (state.view === 'recent') state.recent = await store.listRecentDays(state.date, RECENT_DAYS);
  syncTimers();
  render();
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
  const views = { today: renderToday, recent: renderRecent, tags: renderTags };
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
    h('nav', {}, tab('today', 'Today'), tab('recent', 'Recent'), tab('tags', 'Tags')));
}

async function show(view) {
  state.view = view;
  if (view === 'recent') state.recent = await store.listRecentDays(state.date, RECENT_DAYS);
  render();
}

function section(title, ...body) {
  return h('section', { class: 'block' }, h('h2', {}, title), body);
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
  return h('span', { class: 'tag-pick' },
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
    section('Sessions', renderSessions()));
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
  if (p && p.session.endAt > Date.now()) return renderRunning(p.session);
  if (p) return renderOutcome(p.session);
  return renderStartSession();
}

function renderStartSession() {
  const open = state.day.tasks.filter((t) => !t.done);
  if (!open.length) {
    return h('section', { class: 'card session' }, h('p', { class: 'muted' }, 'All tasks done. Add one below to start another session.'));
  }
  if (!open.some((t) => t.id === state.startTaskId)) state.startTaskId = null;

  return h('section', { class: 'card session' },
    h('div', { class: 'label' }, 'Next session — pick a task'),
    h('ul', { class: 'pick-list' }, open.map((t) =>
      h('li', {},
        h('button', {
          class: 'pick' + (t.id === state.startTaskId ? ' selected' : ''),
          onclick: () => { state.startTaskId = t.id; render(); },
        },
          h('span', { class: 'dot', style: `background:${tagColor(t.tagId)}` }),
          t.text)))),
    h('div', { class: 'start-row' },
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
      h('button', { class: 'quiet', onclick: endNow }, 'End now')));
}

function renderOutcome(s) {
  const note = h('input', { class: 'note', placeholder: 'Short note (optional)', maxlength: 140 });
  return h('section', { class: 'card session ended', style: `--tag:${tagColor(s.tagId)}` },
    h('div', { class: 'label' }, 'Session over — how did it go?'),
    h('div', { class: 'session-task' }, s.taskText),
    note,
    h('div', { class: 'outcomes' }, Object.entries(OUTCOMES).map(([key, label]) =>
      h('button', { class: `outcome ${key}`, onclick: () => saveOutcome(key, note.value.trim()) }, label))));
}

function renderTasks() {
  const tasks = state.day.tasks;
  const list = h('ul', { class: 'tasks' }, tasks.map((t) =>
    h('li', {
      class: 'task' + (t.done ? ' done' : ''), 'data-id': t.id,
      ondragstart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
      ondragover: dragOver,
      ondragend: dragEnd,
    },
      h('span', {
        class: 'handle', title: 'Drag to reorder',
        onpointerdown: (e) => { e.target.closest('li').draggable = true; },
        onpointerup: (e) => { e.target.closest('li').draggable = false; },
      }, '⠿'),
      h('input', { type: 'checkbox', checked: t.done, title: 'Done', onchange: (e) => updateTask(t.id, { done: e.target.checked }) }),
      tagPicker(t.tagId, (id) => updateTask(t.id, { tagId: id })),
      h('input', {
        class: 'text', value: t.text,
        onchange: (e) => {
          const text = e.target.value.trim();
          if (!text) e.target.value = tasks.find((x) => x.id === t.id).text;
          else updateTask(t.id, { text }, false);
        },
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      }),
      h('button', { class: 'icon remove', title: 'Remove task', onclick: () => removeTask(t) }, '×'))));

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
      await reloadDay();
      state.focus = 'new-task';
      render();
    },
  },
    tagPicker(state.newTaskTagId, (id) => { state.newTaskTagId = id; render(); }),
    h('input', { id: 'new-task', name: 'text', class: 'text', placeholder: 'Add a task' }),
    h('button', { class: 'quiet' }, 'Add'));

  return [list, add];
}

// Done and ran its full length.
const succeeded = (s) => s.outcome === 'done' && !s.endedEarly;

function renderSessions() {
  const sessions = state.day.sessions.filter((s) => s.outcome).sort((a, b) => a.startAt - b.startAt);
  if (!sessions.length) return h('p', { class: 'muted' }, 'No sessions yet.');
  const good = sessions.filter(succeeded);
  const troubled = sessions.filter((s) => !succeeded(s));
  const row = (s) =>
    h('li', {},
      h('span', { class: 'time' }, clock(s.startAt)),
      h('span', { class: 'bar', style: `background:${tagColor(s.tagId)}` }),
      h('span', { class: 'stext' }, s.taskText, s.note && h('span', { class: 'note-text' }, ` — ${s.note}`)),
      s.endedEarly && h('span', { class: 'early' }, 'ended early'),
      h('span', { class: 'mins' }, formatDuration(s.endAt - s.startAt)),
      h('span', { class: `badge ${s.outcome}` }, OUTCOMES[s.outcome]));
  return [
    good.length ? h('ul', { class: 'sessions' }, good.map(row)) : h('p', { class: 'muted' }, 'None completed yet.'),
    troubled.length > 0 && [h('h2', {}, 'Cut short or not done'), h('ul', { class: 'sessions troubled' }, troubled.map(row))],
  ];
}

function formatDuration(ms) {
  const min = Math.round(ms / 60_000);
  return min < 1 ? '<1 min' : `${min} min`;
}

// --- Today actions ---

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
  await store.deleteTask(state.date, task.id);
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

// Ends the session early (no chime): endAt becomes the actual end time.
async function endNow() {
  const { date, session } = state.pending;
  const ended = { ...session, endAt: Date.now(), endedEarly: true };
  await store.saveSession(date, ended);
  state.pending = { date, session: ended };
  alertedId = ended.id;
  syncTimers();
  if (date === state.date) await reloadDay();
  render();
}

async function saveOutcome(outcome, note) {
  const { date, session } = state.pending;
  await store.saveSession(date, { ...session, outcome, note });
  if (outcome === 'done') {
    const task = (await store.getDay(date)).tasks.find((t) => t.id === session.taskId);
    if (task) await store.saveTask(date, { ...task, done: true });
  }
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
  if (!s) return;
  const left = s.endAt - Date.now();
  if (left > 0) {
    // A single timeout fires reliably in a background tab; the interval only drives the display.
    alarmTimeout = setTimeout(() => onTimeUp(s), left);
    tickInterval = setInterval(tick, 1000);
  }
}

function tick() {
  const s = state.pending?.session;
  if (!s) {
    document.title = 'Focus';
    return;
  }
  const left = s.endAt - Date.now();
  if (left <= 0) {
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
  clearInterval(tickInterval);
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
      const done = day.sessions.filter((s) => s.outcome === 'done').sort((a, b) => a.startAt - b.startAt);
      return h('li', {},
        h('span', { class: 'day-label' }, dayLabel(day.date)),
        h('span', { class: 'blocks' },
          done.length
            ? done.map((s) => h('span', {
                class: 'chunk',
                style: `background:${tagColor(s.tagId)};width:${Math.max(10, ((s.endAt - s.startAt) / 60_000) * 3)}px`,
                title: `${clock(s.startAt)} · ${s.taskText} · ${formatDuration(s.endAt - s.startAt)}`,
              }))
            : h('span', { class: 'muted' }, '—')));
    })));
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
