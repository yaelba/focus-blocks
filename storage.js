// All persistence lives here. The UI only calls these async functions, so
// moving to a server (e.g. to sync with a phone) means replacing this file.

const PREFIX = 'focus.';
const TAGS_KEY = PREFIX + 'tags';
const dayKey = (date) => PREFIX + 'day.' + date;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// Thrown when the browser refuses a save because this site's storage is full.
export class StorageFullError extends Error {}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    if (e.name === 'QuotaExceededError') throw new StorageFullError('Browser storage is full', { cause: e });
    throw e;
  }
}

// Chrome allows roughly 5 million characters per site, shared by every app on the
// same address (all of yaelba.github.io), so everything stored there is counted.
const LIMIT_CHARS = 5_000_000;

export async function storageUsage() {
  let used = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    used += key.length + (localStorage.getItem(key)?.length ?? 0);
  }
  return { used, limit: LIMIT_CHARS };
}

function loadDay(date) {
  return read(dayKey(date), null) ?? { date, tasks: [], sessions: [] };
}

function upsert(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) list.push(item);
  else list[i] = item;
}

// --- Tags: { id, name, color } ---

export async function listTags() {
  return read(TAGS_KEY, []);
}

export async function saveTag(tag) {
  const tags = read(TAGS_KEY, []);
  upsert(tags, tag);
  write(TAGS_KEY, tags);
}

export async function deleteTag(tagId) {
  write(TAGS_KEY, read(TAGS_KEY, []).filter((t) => t.id !== tagId));
}

// --- Days: { date: 'YYYY-MM-DD', tasks: [...], sessions: [...] } ---

export async function getDay(date) {
  return loadDay(date);
}

// Task: { id, text, tagId, removed } — removed tasks stay stored for the archive. (`done` is legacy.)
export async function saveTask(date, task) {
  const day = loadDay(date);
  upsert(day.tasks, task);
  write(dayKey(date), day);
}

export async function deleteTask(date, taskId) {
  const day = loadDay(date);
  day.tasks = day.tasks.filter((t) => t.id !== taskId);
  write(dayKey(date), day);
}

export async function reorderTasks(date, taskIds) {
  const day = loadDay(date);
  const byId = new Map(day.tasks.map((t) => [t.id, t]));
  const listed = taskIds.map((id) => byId.get(id)).filter(Boolean);
  // Tasks not in taskIds (e.g. hidden finished ones) keep their place at the end.
  day.tasks = [...listed, ...day.tasks.filter((t) => !taskIds.includes(t.id))];
  write(dayKey(date), day);
}

// Session: { id, taskId, taskText, tagId, minutes, startAt, endAt, outcome: null | 'done', note }
// Saved when it starts (so a reload can resume it); deleted if it ends early or strays.
export async function saveSession(date, session) {
  const day = loadDay(date);
  upsert(day.sessions, session);
  write(dayKey(date), day);
}

export async function deleteSession(date, sessionId) {
  const day = loadDay(date);
  day.sessions = day.sessions.filter((s) => s.id !== sessionId);
  write(dayKey(date), day);
}

// Every stored day before `beforeDate` that has tasks, newest first.
export async function listPastDays(beforeDate) {
  const days = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith(PREFIX + 'day.')) continue;
    const day = read(key, null);
    if (day && day.date < beforeDate && day.tasks.length) days.push(day);
  }
  return days.sort((a, b) => b.date.localeCompare(a.date));
}
