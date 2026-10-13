// Local-calendar date helpers. Dates are 'YYYY-MM-DD' strings.

export function todayStr(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parse(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = parse(date);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

export function dayLabel(date) {
  return parse(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function clock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
