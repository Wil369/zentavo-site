// The same money math as the iPhone app (DailySpending, Paychecks, BillSplit,
// MoneyFacts.upcomingEvents), so the web shows exactly the numbers the phone does.

export const SAVINGS = 'Savings';
export const INVESTING = 'Investing';
/** Money moved, not spent: savings goals and brokerages (Fidelity, Robinhood). */
export const MOVED = new Set([SAVINGS, INVESTING]);
export const DEBT = 'Debt Payments';
const DAY = 86_400_000;

// ---------- dates ----------
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export function addMonths(d, n) {
  // Like Calendar.date(byAdding: .month): Jan 31 + 1 month = Feb 28/29.
  const x = new Date(d);
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return x;
}
export const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const monthEnd = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1); // exclusive
export const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const inMonth = (d, m) => d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth();
const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

// ---------- what an entry is ----------
export const isTemplate = (t) => t.isRecurring && !!t.recurringFrequency && !t.recurringTemplateID;
export const isGenerated = (t) => !!t.recurringTemplateID;
export const isSpending = (t) => t.type === 'expense' && !MOVED.has(t.category);
export const isMoved = (t) => t.type === 'expense' && MOVED.has(t.category);
export const isBill = (t) => isTemplate(t) || isGenerated(t) || t.category === DEBT;
// Money a weekly goal plans for ("Mom & Dad $50 a week") never counts against the day.
export const countsForDay = (t) => isSpending(t) && !isBill(t) && !isPlanned(t);
export const share = (t) => (t.fullAmount && t.fullAmount > 0 ? Math.min(Math.max(t.amount / t.fullAmount, 0), 1) : 1);
export function sharePhrase(s) {
  if (s > 0.49 && s < 0.51) return 'half';
  if (s > 0.32 && s < 0.34) return 'a third';
  if (s > 0.24 && s < 0.26) return 'a quarter';
  return `${Math.round(s * 100)}%`;
}

const SHORT = {
  'Food & Groceries': 'Food', Transportation: 'Transport', Subscriptions: 'Subs', Entertainment: 'Fun',
  'Debt Payments': 'Debt', 'Personal Care': 'Personal', 'Side Hustle': 'Hustle', Investments: 'Invest',
};
export const shortName = (c) => SHORT[c] || c;

// ---------- repeating entries ----------
function stepDate(start, freq, k) {
  if (freq === 'Weekly') return addDays(start, 7 * k);
  if (freq === 'Biweekly') return addDays(start, 14 * k);
  return addMonths(start, k);
}

export function occurrences(start, freq, through) {
  const limit = addDays(startOfDay(through), 1);
  const out = [];
  for (let k = 1; k <= 2000; k++) {
    const next = stepDate(start, freq, k);
    if (next >= limit) break;
    out.push(next);
  }
  return out;
}

function nextDueDate(debt, onOrAfter) {
  if (!debt.dueDate) return null;
  const floor = startOfDay(onOrAfter);
  if (debt.dueDate >= floor) return debt.dueDate;
  for (let m = 1; m <= 600; m++) {
    const next = addMonths(debt.dueDate, m);
    if (next >= floor) return next;
  }
  return null;
}

/** Repeating entries and debt payments due between two dates (end exclusive), in order. */
export function upcomingEvents(data, from, to) {
  const events = [];
  for (const t of data.transactions) {
    if (!isTemplate(t)) continue;
    const dates = [t.date, ...occurrences(t.date, t.recurringFrequency, to)];
    for (const date of dates) {
      if (date >= from && date < to) {
        events.push({ date, title: t.title, amount: t.amount, isIncome: t.type === 'income',
          detail: t.recurringFrequency.toLowerCase(), transaction: t });
      }
    }
  }
  for (const debt of data.debts) {
    if (debt.remainingBalance <= 0) continue;
    let cursor = from;
    for (let i = 0; i < 120; i++) {
      const date = nextDueDate(debt, cursor);
      if (!date || date >= to) break;
      events.push({ date, title: debt.name, amount: Math.min(debt.minimumPayment ?? debt.remainingBalance, debt.remainingBalance),
        isIncome: false, detail: 'debt payment', transaction: null, debt });
      cursor = addDays(startOfDay(date), 1);
    }
  }
  return events.sort((a, b) => a.date - b.date);
}

// ---------- bills ----------
const EVERYDAY = new Set(['Food & Groceries', 'Transportation', 'Shopping', 'Entertainment', 'Personal Care']);

const BUDGET_WORDS = new Set(['food', 'foods', 'groceries', 'grocery', 'transportation', 'transport', 'gas', 'shopping',
  'fun', 'entertainment', 'personal', 'personal care', 'eating out', 'dining', 'restaurants', 'spending', 'misc']);
const looksLikeBudgetName = (t) => {
  const name = (t.title || '').trim().toLowerCase();
  return !name || BUDGET_WORDS.has(name) || name === t.category.toLowerCase() || name === shortName(t.category).toLowerCase();
};

export function isBudgetLike(template, transactions, now = new Date()) {
  if (!isTemplate(template) || template.type !== 'expense' || !EVERYDAY.has(template.category)) return false;
  // "Transportation $400" is a budget; "Gym $30" in the same kind of category is a real bill.
  if (!looksLikeBudgetName(template)) return false;
  const since = new Date(now.getTime() - 45 * DAY);
  return transactions.some((t) => t.type === 'expense' && t.category === template.category && !isTemplate(t)
    && !isGenerated(t) && t.date >= since && t.date <= now);
}

export function billLines(data, month) {
  const from = monthStart(month), to = monthEnd(month);
  const lines = [];
  const repeating = upcomingEvents(data, from, to).filter((e) => !e.isIncome && e.transaction);
  const groups = new Map();
  for (const e of repeating) {
    if (!groups.has(e.title)) groups.set(e.title, []);
    groups.get(e.title).push(e);
  }
  for (const [title, events] of groups) {
    const t = events[0].transaction;
    const total = events.reduce((s, e) => s + e.amount, 0);
    const s = share(t);
    const kind = `Repeats ${events[0].detail}` + (s < 0.999 ? ` · your ${sharePhrase(s)}` : '');
    if (isBudgetLike(t, data.transactions)) {
      lines.push({ title, total, times: events.length, kind, counted: false, budgetLike: true, category: t.category,
        note: `A spending budget, not a bill: what you spend on ${shortName(t.category).toLowerCase()} is already counted day by day.` });
      continue;
    }
    lines.push({ title, total, times: events.length, kind, counted: true, share: s, category: t.category,
      fullTotal: s < 0.999 ? total / s : null, firstDate: events[0].date, template: t });
  }
  // Weekly goals are set aside like bills; a repeating entry for the same thing isn't counted twice.
  for (const g of (data.habitGoals || []).filter((x) => !x.isArchived && x.targetAmount > 0)) {
    const r = habitRule(g);
    for (const line of lines) {
      if (line.counted && line.template && habitMatches(line.template, r)) {
        line.counted = false;
        line.note = `Covered by your “${g.name}” goal, so it isn't counted twice.`;
      }
    }
    lines.push({ title: g.name, total: habitSetAside(g, month), times: 1, counted: true, category: g.category, habit: true, habitKind: g.kind,
      kind: `${HABIT_KIND[g.kind] || 'Weekly'} goal · ${money0(g.targetAmount)} a ${r.weekly ? 'week' : 'month'}` });
  }
  for (const debt of data.debts) {
    if (debt.remainingBalance <= 0) continue;
    const due = nextDueDate(debt, from);
    if (!due || due >= to) continue;
    if (debt.minimumPayment && debt.minimumPayment > 0) {
      lines.push({ title: debt.name, total: Math.min(debt.minimumPayment, debt.remainingBalance), times: 1, kind: 'Debt payment', counted: true, category: DEBT, firstDate: due });
    } else {
      lines.push({ title: debt.name, total: 0, times: 1, kind: 'Debt', counted: false, note: 'No minimum payment set, so it isn\'t counted.' });
    }
  }
  // Money moved to a separate bills account every payday: its bills are counted above; whatever
  // goes in beyond them stays in that account, so it isn't in checking to spend either.
  const move = billsMoveTotal(data, month);
  if (move.total > 0) {
    const paidFromIt = lines.filter((l) => l.counted && !l.habit && !l.budgetLike && !MOVED.has(l.category)).reduce((s, l) => s + l.total, 0);
    const extra = move.total - paidFromIt;
    if (extra >= 1) {
      lines.push({ title: 'Kept in your bills account', total: extra, times: 1, counted: true, billsAccount: true, category: 'Housing',
        kind: `${money0(move.total)} moved there this month, bills ${money0(paidFromIt)}`,
        note: `You move ${money0(move.total)} to your bills account this month, and the bills here add up to ${money0(paidFromIt)}. The other ${money0(extra)} stays in that account, so it's set aside too.` });
    }
  }
  return lines.sort((a, b) => b.total - a.total);
}

// Moves to a separate bills account (AppSettings.moneyMoves, JSON written by the iPhone app;
// dates are seconds since 2001-01-01, Swift's default).
const APPLE_EPOCH = 978307200;
export function billsMoves(data) {
  try {
    const raw = data.settings && data.settings.moneyMoves;
    if (!raw) return [];
    return JSON.parse(raw).map((m) => ({ amount: Number(m.amount) || 0, frequency: m.frequency || 'Monthly',
      start: new Date((APPLE_EPOCH + Number(m.start || 0)) * 1000) })).filter((m) => m.amount > 0);
  } catch { return []; }
}

export function moveDates(move, from, to) {
  const anchor = startOfDay(move.start);
  const step = (n) => {
    if (move.frequency === 'Weekly') return addDays(anchor, 7 * n);
    if (move.frequency === 'Biweekly') return addDays(anchor, 14 * n);
    const y = anchor.getFullYear(), m = anchor.getMonth() + n;
    return new Date(y, m, Math.min(anchor.getDate(), new Date(y, m + 1, 0).getDate()));
  };
  let n = 0;
  while (n > -600 && step(n) >= from) n -= 1;
  const out = [];
  for (let guard = 0; guard < 600; guard++, n++) {
    const day = step(n);
    if (day >= to) break;
    if (day >= from) out.push(day);
  }
  return out;
}

export function billsMoveTotal(data, month) {
  const from = monthStart(month), to = monthEnd(month);
  let total = 0, times = 0;
  for (const m of billsMoves(data)) {
    const count = moveDates(m, from, to).length;
    total += m.amount * count;
    times += count;
  }
  return { total, times };
}

export const billsInMonth = (data, month) => billLines(data, month).filter((l) => l.counted).reduce((s, l) => s + l.total, 0);

// ---------- this month ----------
export function monthlyFigures(data, now = new Date()) {
  const last = addMonths(monthStart(now), -1);
  const thisTx = data.transactions.filter((t) => inMonth(t.date, now));
  const lastTx = data.transactions.filter((t) => inMonth(t.date, last));
  const sum = (arr) => arr.reduce((s, t) => s + t.amount, 0);
  const expenses = sum(thisTx.filter(isSpending));
  const saved = sum(thisTx.filter(isMoved));
  const actualIncome = sum(thisTx.filter((t) => t.type === 'income'));
  const previousIncome = sum(lastTx.filter((t) => t.type === 'income'));
  const income = actualIncome > 0 ? actualIncome : previousIncome;
  const budget = data.settings?.monthlyBudgetGoal ?? 0;
  const leftToSpend = budget > 0 ? budget - expenses : income - expenses;
  return { expenses, saved, actualIncome, income, budget, leftToSpend };
}

// ---------- paychecks ----------
const PAY = new Set(['Salary', 'Freelance', 'Side Hustle']);
export const isPay = (t) => t.type === 'income' && PAY.has(t.category);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function parseSchedule(raw) {
  const [kind, n] = (raw || '').split(':');
  const num = Number(n);
  if (kind === 'weekly' && num >= 1 && num <= 7) return { kind, weekday: num, cadence: 7, label: `Every ${WEEKDAYS[num - 1]}` };
  if (kind === 'biweekly' && num >= 1 && num <= 7) return { kind, weekday: num, cadence: 14, label: `Every other ${WEEKDAYS[num - 1]}` };
  if (kind === 'twiceMonthly') return { kind, cadence: 15, label: '15th and last day' };
  if (kind === 'monthly' && num >= 1 && num <= 31) return { kind, day: num, cadence: 30, label: `Monthly on day ${num}` };
  return { kind: 'learn', cadence: null, label: 'Learned from your paychecks' };
}

function payEntries(transactions, schedule, now) {
  const start = addDays(startOfDay(now), -120);
  const recent = transactions.filter((t) => isPay(t) && t.date >= start && t.date <= now);
  const actual = recent.filter((t) => !isTemplate(t) && !isGenerated(t));
  if (actual.length || schedule.kind !== 'learn') return { entries: actual, planned: false };
  return { entries: recent, planned: true };
}

function paydays(entries, from, through) {
  const totals = new Map();
  for (const t of entries) {
    if (t.date < from || t.date > through) continue;
    const k = startOfDay(t.date).getTime();
    totals.set(k, (totals.get(k) || 0) + t.amount);
  }
  return [...totals].map(([k, amount]) => ({ day: new Date(k), amount })).sort((a, b) => a.day - b.day);
}

function learnCadence(days) {
  const recent = days.slice(-7);
  const gaps = [];
  for (let i = 1; i < recent.length; i++) { const g = dayDiff(recent[i - 1].day, recent[i].day); if (g >= 4) gaps.push(g); }
  if (!gaps.length) return 14;
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (median <= 10) return 7;
  if (median <= 17) return gaps.every((g) => g === 14) || (median === 14 && gaps.filter((g) => g === 14).length * 2 > gaps.length) ? 14 : 15;
  return 30;
}

const cycleLength = (c) => (c === 7 ? 7 : c === 14 ? 14 : c === 15 ? 365.25 / 24 : 365.25 / 12);

function step(day, cadence, schedule) {
  const dom = day.getDate();
  const lastDay = daysInMonth(day);
  const on = (wanted, ahead) => {
    const m = addMonths(monthStart(day), ahead);
    return new Date(m.getFullYear(), m.getMonth(), Math.min(wanted, daysInMonth(m)));
  };
  if (schedule.kind === 'twiceMonthly') {
    if (dom < 15) return on(15, 0);
    if (dom < lastDay) return on(31, 0);
    return on(15, 1);
  }
  if (schedule.kind === 'monthly') return dom < Math.min(schedule.day, lastDay) ? on(schedule.day, 0) : on(schedule.day, 1);
  if (cadence === 7 || cadence === 14) return addDays(day, cadence);
  if (cadence === 15) return dom <= 15 ? addDays(day, Math.min(dom + 15, lastDay) - dom) : on(Math.max(dom - 15, 1), 1);
  return addMonths(day, 1);
}

function nextPayday(last, today, cadence, schedule) {
  if (schedule.kind === 'weekly' || schedule.kind === 'biweekly') {
    let offset = schedule.weekday - (last.day.getDay() + 1);
    if (offset > 3) offset -= 7; else if (offset < -3) offset += 7;
    const anchor = addDays(last.day, offset);
    let d = addDays(anchor, schedule.cadence);
    while (d < today) d = addDays(d, schedule.cadence);
    return d;
  }
  let d = step(last.day, cadence, schedule);
  while (d < today) d = step(d, cadence, schedule);
  return d;
}

function expectedAmount(day, cadence, days, projected) {
  if (cadence !== 7) return days.length ? days[days.length - 1].amount : null;
  const back = addDays(day, -14);
  const actual = [...days].reverse().find((p) => Math.abs(p.day - back) <= DAY * 1.5);
  if (actual) return actual.amount;
  return projected.get(back.getTime()) ?? null;
}

export function pace(data, now = new Date()) {
  const schedule = parseSchedule(data.settings?.paySchedule);
  const today = startOfDay(now);
  const { entries, planned } = payEntries(data.transactions, schedule, now);
  const days = paydays(entries, new Date(0), now);
  if (!days.length) return null;
  const last = days[days.length - 1], first = days[0];
  const cadence = schedule.cadence ?? learnCadence(days);
  const length = cycleLength(cadence);
  if (dayDiff(last.day, today) > 2 * length + 7) return null;

  let perDay, counted;
  const paidToday = sameDay(last.day, today);
  const windowStart = addDays(today, paidToday ? -27 : -28);
  const windowEnd = addDays(today, paidToday ? 1 : 0);
  if ((cadence === 7 || cadence === 14) && first.day <= windowStart) {
    const inWindow = days.filter((p) => p.day >= windowStart && p.day < windowEnd);
    perDay = inWindow.reduce((s, p) => s + p.amount, 0) / 28;
    counted = inWindow.length;
  } else {
    const recent = days.slice(-(cadence <= 14 ? 4 : 3));
    perDay = recent.reduce((s, p) => s + p.amount, 0) / (recent.length * length);
    counted = recent.length;
  }
  const next = nextPayday(last, today, cadence, schedule);
  const nextAmount = expectedAmount(next, cadence, days, new Map()) ?? last.amount;
  const usual = cadence === 7 ? 4 : cadence === 14 || cadence === 15 ? 2 : 1;
  const cadenceName = cadence === 7 ? 'every week' : cadence === 14 ? 'every two weeks' : cadence === 15 ? 'twice a month' : 'every month';
  return { perDay, cadence, counted, last, next, nextAmount, isEarly: days.length < 2, planned, schedule, usual, cadenceName,
    history: days, scheduleName: schedule.kind !== 'learn' ? schedule.label : `${cadenceName[0].toUpperCase()}${cadenceName.slice(1)} (learned)` };
}

export function projectedPaydays(p, until) {
  const projected = new Map();
  const out = [];
  let d = p.next;
  for (let i = 0; d < until && i < 80; i++) {
    const amount = expectedAmount(d, p.cadence, p.history, projected) ?? p.last.amount;
    projected.set(d.getTime(), amount);
    out.push({ day: d, amount });
    d = step(d, p.cadence, p.schedule);
  }
  return out;
}

export function monthOutlook(data, p, month, now = new Date()) {
  const from = monthStart(month), to = monthEnd(month);
  const { entries } = payEntries(data.transactions, p.schedule, now);
  const received = paydays(entries, from, new Date(Math.min(now, to)));
  const upcoming = to > now ? projectedPaydays(p, to).filter((x) => x.day >= from) : [];
  const receivedTotal = received.reduce((s, x) => s + x.amount, 0);
  const expected = receivedTotal + upcoming.reduce((s, x) => s + x.amount, 0);
  return { received: receivedTotal, receivedCount: received.length, receivedDays: received, upcoming, expected,
    paydayCount: received.length + upcoming.length, extra: received.length + upcoming.length > p.usual };
}

export function nextExtraPaydayMonth(p, now = new Date()) {
  if (p.cadence !== 7 && p.cadence !== 14) return null;
  const start = monthStart(now);
  const future = projectedPaydays(p, addMonths(start, 13));
  for (let k = 1; k <= 12; k++) {
    const m = addMonths(start, k);
    const inM = future.filter((x) => inMonth(x.day, m));
    if (inM.length > p.usual) return { month: m, count: inM.length, total: inM.reduce((s, x) => s + x.amount, 0) };
  }
  return null;
}

// ---------- daily limit ----------
const roundLimit = (raw) => (raw >= 10 ? Math.floor(raw) : Math.floor(raw * 100) / 100);

export function limitMode(settings) {
  if (settings?.dailyLimit > 0) return 'custom';
  return settings?.dailyLimitMode === 'paychecks' ? 'paychecks' : 'budget';
}

export function dailyLimit(data, month = new Date(), now = new Date()) {
  const settings = data.settings;
  const days = daysInMonth(month);
  const mode = limitMode(settings);
  if (mode === 'custom') return { amount: settings.dailyLimit, mode, days, explanation: 'Set by you. Bills and savings don\'t count against it.' };
  const bills = billsInMonth(data, month);
  const budget = settings?.monthlyBudgetGoal ?? 0;
  if (mode === 'paychecks' || budget <= 0) {
    const asOf = new Date(Math.min(now, monthEnd(month) - 1));
    const p = pace(data, asOf);
    if (p) {
      // This month's real pay (landed + still to come), like the iPhone: weekly pay brings 4
      // paychecks most months and 5 in some, so an average month would overstate October.
      const outlook = monthOutlook(data, p, month, asOf);
      const paydays = outlook ? outlook.paydayCount : 0;
      const takeHome = paydays > 0 ? outlook.expected : p.perDay * days;
      const when = paydays > 0 ? `this month (${paydays} paydays)` : 'in a typical month';
      return { amount: roundLimit(Math.max((takeHome - bills) / days, 0)), mode, days, bills, base: takeHome, pace: p, paydays,
        explanation: `From your paychecks: about ${money0(takeHome)} take-home ${when}, minus ${money0(bills)} in bills, over ${days} days.` };
    }
  }
  const base = budget > 0 ? budget : monthlyFigures(data, now).income;
  const amount = base > 0 ? roundLimit(Math.max((base - bills) / days, 0)) : 0;
  const waiting = mode === 'paychecks' ? 'No paychecks logged yet, so this uses your budget. ' : '';
  return { amount, mode, days, bills, base, waiting: !!waiting,
    explanation: `${waiting}Your ${money0(base)} ${budget > 0 ? 'budget' : 'income'}, minus ${money0(bills)} in bills, over ${days} days.` };
}

export function spentByDay(transactions, month) {
  const totals = new Map();
  for (const t of transactions) {
    if (!countsForDay(t) || !inMonth(t.date, month)) continue;
    const k = startOfDay(t.date).getTime();
    totals.set(k, (totals.get(k) || 0) + t.amount);
  }
  return totals;
}

export function dayStatus(spent, limit) {
  if (!(limit > 0)) return 'none';
  if (spent > limit + 0.004) return 'over';
  if (spent >= limit * 0.85) return 'close';
  return 'under';
}

// ---------- formatting ----------
const fmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmt0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const money = (v) => fmt2.format(v || 0);
export const money0 = (v) => fmt0.format(Math.round(v || 0));
export const moneySmart = (v) => (Math.abs(v - Math.round(v)) < 0.005 ? money0(v) : money(v));

// ---------- weekly goals ----------
// Same rules as the iPhone: an entry counts when it's in the goal's category, or its name or
// note mentions one of the goal's words (a Zelle memo like "Pou papam" lands in the note).
export const HABIT_KIND = { family: 'Family support', giving: 'Giving', saving: 'Save regularly', investing: 'Invest', custom: 'Weekly' };
let RULES = [];
const habitWords = (s) => (s || '').split(/[,;]/).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2);

export function habitRule(g) {
  return { category: g.category, words: habitWords(g.matchWords), weekly: g.period !== 'month', target: g.targetAmount, start: g.createdDate || new Date(0) };
}

export function useHabits(data) {
  RULES = (data.habitGoals || []).filter((g) => !g.isArchived && g.targetAmount > 0).map(habitRule);
}

export function habitMatches(t, r) {
  if (t.type !== 'expense') return false;
  if (r.category && r.category !== 'Other' && t.category === r.category) return true;
  if (!r.words.length) return false;
  const hay = `${t.title} ${t.notes || ''}`.toLowerCase();
  return r.words.some((w) => hay.includes(w));
}

export const isPlanned = (t) => RULES.some((r) => habitMatches(t, r));

function habitPeriod(weekly, date) {
  if (!weekly) return { start: monthStart(date), end: monthEnd(date) };
  const start = addDays(startOfDay(date), -date.getDay()); // weeks start Sunday, like the iPhone
  return { start, end: addDays(start, 7) };
}

export function habitProgress(g, transactions, now = new Date()) {
  const r = habitRule(g);
  const sumIn = (p) => transactions.filter((t) => t.date >= p.start && t.date < p.end && habitMatches(t, r)).reduce((s, t) => s + t.amount, 0);
  const met = (v) => r.target > 0 && v + 0.004 >= r.target;
  const current = habitPeriod(r.weekly, now);
  const done = sumIn(current);
  const firstMatch = transactions.filter((t) => habitMatches(t, r)).reduce((m, t) => (t.date < m ? t.date : m), r.start);
  const history = [];
  let streak = 0, counting = true, cursor = current.start;
  for (let i = 0; i < 104; i++) {
    const prev = habitPeriod(r.weekly, new Date(cursor - 1000));
    if (prev.end <= firstMatch) break;
    const v = sumIn(prev);
    if (history.length < 8) history.push({ start: prev.start, amount: v, met: met(v) });
    if (counting) { if (met(v)) streak++; else counting = false; }
    cursor = prev.start;
    if (!counting && history.length >= 8) break;
  }
  if (met(done)) streak++;
  const daysLeft = Math.max(dayDiff(now, current.end), 1);
  const word = r.weekly ? 'week' : 'month';
  const status = met(done)
    ? (done > r.target + 0.004 ? `Done, ${money0(done - r.target)} extra` : `Done for this ${word}`)
    : `${money0(r.target - done)} to go · ${daysLeft === 1 ? 'last day' : `${daysLeft} days left`}`;
  return { done, target: r.target, met: met(done), streak, history: history.reverse(), word, status, weekly: r.weekly,
    matches: transactions.filter((t) => habitMatches(t, r)).sort((a, b) => b.date - a.date) };
}

export function habitSetAside(g, month) {
  return g.period === 'month' ? g.targetAmount : (g.targetAmount * daysInMonth(month)) / 7;
}

// ---------- net worth ----------
export function netWorth(data) {
  const assets = (data.assets || []).reduce((s, a) => s + a.value, 0);
  const liabilities = data.debts.reduce((s, x) => s + Math.max(x.remainingBalance, 0), 0);
  return { assets, liabilities, net: assets - liabilities };
}

export function netWorthHistory(data) {
  const byDay = new Map();
  for (const s of data.snapshots || []) byDay.set(startOfDay(s.day).getTime(), s);
  return [...byDay.values()].sort((a, b) => a.day - b.day).map((s) => ({ day: s.day, net: s.assets - s.liabilities, assets: s.assets, liabilities: s.liabilities }));
}

// ---------- savings goals ----------
/** Short term: due within a year. Long term: further out. Someday: no date. */
export function goalHorizon(g, now = new Date()) {
  if (!g.deadline) return 'someday';
  return g.deadline <= addMonths(now, 12) ? 'short' : 'long';
}

export function goalPerWeek(g, now = new Date()) {
  if (!g.deadline || g.deadline <= now) return null;
  const left = Math.max(g.targetAmount - g.currentAmount, 0);
  const weeks = Math.max((g.deadline - now) / (7 * DAY), 1);
  return left / weeks;
}

// ---------- money plan ----------
/** Where this month's paychecks go, and what's left to invest (same as the iPhone). */
export function moneyPlan(data, now = new Date()) {
  const p = pace(data, now);
  let takeHome = 0, landed = 0, paydayCount = 0, landedCount = 0, fromPaychecks = false;
  if (p) {
    const o = monthOutlook(data, p, now, now);
    if (o.paydayCount > 0) {
      takeHome = o.expected; landed = o.received; paydayCount = o.paydayCount; landedCount = o.receivedCount; fromPaychecks = true;
    }
  }
  if (!fromPaychecks) { takeHome = monthlyFigures(data, now).income; landed = takeHome; }
  const lines = billLines(data, now).filter((l) => l.counted);
  // A repeating transfer to Fidelity or savings is set aside like a bill but counted once, as invested.
  const moved = (l) => !l.habit && MOVED.has(l.category);
  const bills = lines.filter((l) => !l.habit && !moved(l));
  const goals = lines.filter((l) => l.habit && l.habitKind !== 'investing');
  const savingsMoves = lines.filter((l) => moved(l) && l.category === SAVINGS);
  const investGoals = lines.filter((l) => (l.habit && l.habitKind === 'investing') || (moved(l) && l.category === INVESTING));
  const thisMonth = data.transactions.filter((t) => inMonth(t.date, now));
  const sum = (arr) => arr.reduce((s, t) => s + t.amount, 0);
  const everydaySpent = sum(thisMonth.filter((t) => countsForDay(t) && t.date <= now));
  const invested = sum(thisMonth.filter((t) => t.type === 'expense' && t.category === INVESTING));
  const saved = sum(thisMonth.filter((t) => t.type === 'expense' && t.category === SAVINGS));
  const today = startOfDay(now);
  const everyday = data.transactions.filter((t) => countsForDay(t) && t.date <= now);
  let perDay = 0, paceDays = 0;
  if (everyday.length) {
    const first = startOfDay(everyday.reduce((m, t) => (t.date < m ? t.date : m), now));
    const windowStart = first > addDays(today, -29) ? first : addDays(today, -29);
    paceDays = dayDiff(windowStart, today) + 1;
    perDay = sum(everyday.filter((t) => t.date >= windowStart)) / Math.max(paceDays, 1);
  }
  const daysLeft = daysInMonth(now) - now.getDate();
  // Everyday budgets: category limits or spending budgets entered as repeats, whichever is higher.
  const EVERYDAY_CATS = new Set(['Food & Groceries', 'Transportation', 'Shopping', 'Entertainment', 'Personal Care', 'Healthcare', 'Education', 'Other']);
  const budgetsBy = new Map();
  for (const b of data.budgets || []) if (EVERYDAY_CATS.has(b.category) && b.limit > 0) budgetsBy.set(b.category, Math.max(budgetsBy.get(b.category) || 0, b.limit));
  for (const l of billLines(data, now)) if (l.budgetLike && EVERYDAY_CATS.has(l.category)) budgetsBy.set(l.category, Math.max(budgetsBy.get(l.category) || 0, l.total));
  const everydayBudgets = [...budgetsBy].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  const everydayBudgetTotal = everydayBudgets.reduce((s, b) => s + b.amount, 0);
  const total = (arr) => arr.reduce((s, l) => s + l.total, 0);
  const billsTotal = total(bills), goalsTotal = total(goals), investTarget = total(investGoals);
  const free = takeHome - billsTotal - goalsTotal;
  const paceEveryday = everydaySpent + perDay * daysLeft;
  const projectedEveryday = Math.max(paceEveryday, everydayBudgetTotal);
  // Saved this month: what's moved already, or the planned moves when more is still to come.
  const savingsPlanned = total(savingsMoves);
  const savedInMonth = Math.max(saved, savingsPlanned);
  const canInvest = Math.max(free - projectedEveryday - savedInMonth, 0);
  return {
    takeHome, landed, paydayCount, landedCount, fromPaychecks, bills: bills.sort((a, b) => b.total - a.total), goals, investGoals, savingsMoves, savingsPlanned, savedInMonth,
    everydaySpent, perDay, paceDays, daysLeft, everydayBudgets, everydayBudgetTotal, usesBudgets: everydayBudgetTotal > paceEveryday, invested, saved, billsTotal, goalsTotal, investTarget, free, projectedEveryday,
    canInvest, leftToInvest: Math.max(canInvest - invested, 0), leftThisMonth: free - everydaySpent - invested - savedInMonth,
    used: billsTotal + goalsTotal + everydaySpent + invested + savedInMonth,
    suggestedInvest: Math.floor((canInvest * 0.85) / 50) * 50,
  };
}
