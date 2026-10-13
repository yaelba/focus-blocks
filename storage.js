// All persistence lives here. The UI only calls these async functions, so
// moving to a server (e.g. to sync with a phone) means replacing this file.

import { addDays } from './dates.js';

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

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
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

// Task: { id, text, tagId, done }
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

// The `count` days before `beforeDate`, newest first (empty days included).
export async function listRecentDays(beforeDate, count) {
  const days = [];
  for (let i = 1; i <= count; i++) days.push(loadDay(addDays(beforeDate, -i)));
  return days;
}
