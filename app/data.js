// Loads the person's Zentavo data from their private iCloud (CloudKit JS), or sample data.
import { CONFIG } from './config.js?v=20261019g';
import { addDays, addMonths, monthStart, startOfDay } from './money.js?v=20261019g';

const CK_SCRIPT = 'https://cdn.apple-cloudkit.com/ck/2/cloudkit.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.CloudKit) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Couldn\'t reach Apple\'s CloudKit service.'));
    document.head.appendChild(s);
  });
}

export const cloudConfigured = () => !!CONFIG.apiToken;

let guardInstalled = false;
/**
 * CloudKit JS takes the first object-shaped window message after the sign-in popup opens as
 * Apple's answer, without checking who sent it. Browser extensions (password managers,
 * assistants) post messages too, so sign-in failed with UNKNOWN_ERROR in a normal window but
 * worked in a private one. Only Apple's reply (it carries ckSession or errorMessage) gets through.
 */
function guardSignInMessages() {
  if (guardInstalled) return;
  guardInstalled = true;
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && typeof d === 'object' && !Array.isArray(d) && !('ckSession' in d) && !('errorMessage' in d)) {
      e.stopImmediatePropagation();
    }
  }, true);
}

/** Plain words for what went wrong, plus the code for us. */
export function describeError(err, phase) {
  const code = err?.ckErrorCode || err?.serverErrorCode || '';
  const reason = err?.reason || err?.message || String(err || '');
  console.error(`[Zentavo] ${phase} failed`, code, reason, err);
  if (phase === 'sign-in') {
    return { text: 'Sign-in didn\'t finish. Please try again. If it keeps happening, try a private window: some browser extensions get in the way of Apple\'s sign-in window.', code };
  }
  if (code === 'ZONE_NOT_FOUND') {
    return { text: 'No Zentavo data in this iCloud yet. Open Zentavo on your iPhone with the same Apple ID, then refresh.', code };
  }
  if (code === 'AUTHENTICATION_REQUIRED' || code === 'AUTHENTICATION_FAILED') {
    return { text: 'Apple asked to sign in again. Please sign in once more.', code };
  }
  if (code === 'ACCESS_DENIED' || code === 'PERMISSION_FAILURE') {
    return { text: 'Apple didn\'t allow web access to this iCloud data. On your iPhone: Settings → your name → iCloud → turn on “Access iCloud Data on the Web”, then try again.', code };
  }
  return { text: `Couldn't load your data from iCloud. ${reason}`, code };
}

/**
 * Sets up Sign in with Apple. Resolves with the container once a user is signed in. A failed
 * attempt calls onError and keeps waiting: CloudKit shows the sign-in button again.
 */
export async function connect({ onSignedOut, onError }) {
  guardSignInMessages();
  await loadScript(CK_SCRIPT);
  window.CloudKit.configure({
    locale: 'en-us',
    containers: [{
      containerIdentifier: CONFIG.containerIdentifier,
      apiTokenAuth: {
        apiToken: CONFIG.apiToken,
        persist: true,
        signInButton: { id: 'apple-sign-in-button', theme: 'white' },
        signOutButton: { id: 'apple-sign-out-button', theme: 'black' },
      },
      environment: CONFIG.environment,
    }],
  });
  const container = window.CloudKit.getDefaultContainer();
  let user = await container.setUpAuth();
  while (!user) {
    try {
      user = await container.whenUserSignsIn();
    } catch (err) {
      onError?.(describeError(err, 'sign-in'));
    }
  }
  container.whenUserSignsOut().then(() => onSignedOut?.());
  return container;
}

/** Every record in the SwiftData zone, via zone changes (needs no query indexes). */
export async function fetchAll(container, onProgress) {
  const db = container.privateCloudDatabase;
  const records = [];
  let syncToken;
  let more = true;
  let rounds = 0;
  while (more && rounds < 200) {
    rounds++;
    const request = { zoneID: { zoneName: CONFIG.zoneName } };
    if (syncToken) request.syncToken = syncToken;
    const response = await db.fetchRecordZoneChanges([request]);
    if (response.hasErrors) {
      throw response.errors[0] || new Error('iCloud refused the request.');
    }
    const zone = response.zones[0];
    for (const r of zone.records || []) if (!r.deleted) records.push(r);
    syncToken = zone.syncToken;
    more = !!zone.moreComing;
    onProgress?.(records.length);
  }
  return records;
}

// ---------- CloudKit record → plain objects ----------
// SwiftData mirrors each model as record type "CD_<Model>" with fields "CD_<property>".
function field(r, name) {
  const f = r.fields?.[`CD_${name}`];
  return f ? f : undefined;
}
function val(r, name) {
  const f = field(r, name);
  if (!f) return undefined;
  return f.value;
}
const num = (r, n, d = 0) => { const v = val(r, n); return typeof v === 'number' ? v : d; };
const numOpt = (r, n) => { const v = val(r, n); return typeof v === 'number' ? v : null; };
const str = (r, n, d = '') => { const v = val(r, n); return typeof v === 'string' ? v : d; };
const bool = (r, n) => { const v = val(r, n); return v === 1 || v === true; };
const date = (r, n) => { const v = val(r, n); return typeof v === 'number' ? new Date(v) : null; };

/** Enums may arrive as their raw string or as encoded bytes; either way, find the raw value. */
function enumVal(r, n, options) {
  const f = field(r, n);
  if (!f || f.value == null) return null;
  let text = '';
  if (typeof f.value === 'string') {
    text = f.value;
    if (f.type === 'BYTES') { try { text = atob(f.value); } catch { /* keep */ } }
  }
  const lower = text.toLowerCase();
  return options.find((o) => lower === o.toLowerCase()) ?? options.find((o) => lower.includes(o.toLowerCase())) ?? null;
}

export function mapRecords(records) {
  const byType = new Map();
  for (const r of records) {
    if (!byType.has(r.recordType)) byType.set(r.recordType, []);
    byType.get(r.recordType).push(r);
  }
  const counts = Object.fromEntries([...byType].map(([k, v]) => [k, v.length]));
  const of = (t) => byType.get(`CD_${t}`) || [];

  const transactions = of('Transaction').map((r) => {
    const type = enumVal(r, 'type', ['income', 'expense']) || 'expense';
    return {
      id: str(r, 'id', r.recordName),
      title: str(r, 'title'),
      amount: num(r, 'amount'),
      type,
      category: str(r, 'category', 'Other'),
      date: date(r, 'date') || new Date(),
      notes: str(r, 'notes'),
      isRecurring: bool(r, 'isRecurring'),
      recurringFrequency: enumVal(r, 'recurringFrequency', ['Weekly', 'Biweekly', 'Monthly']),
      recurringTemplateID: str(r, 'recurringTemplateID') || null,
      fullAmount: numOpt(r, 'fullAmount'),
    };
  }).filter((t) => t.amount > 0 || t.title);

  const settingsList = of('AppSettings').map((r) => ({
    monthlyBudgetGoal: num(r, 'monthlyBudgetGoal', 2000),
    dailyLimit: num(r, 'dailyLimit', 0),
    dailyLimitMode: str(r, 'dailyLimitMode'),
    paySchedule: str(r, 'paySchedule'),
    updatedAt: date(r, 'updatedAt') || new Date(0),
  }));
  settingsList.sort((a, b) => b.updatedAt - a.updatedAt);

  const debts = of('DebtItem').map((r) => {
    const total = num(r, 'totalAmount'), paid = num(r, 'amountPaid');
    return { name: str(r, 'name'), totalAmount: total, amountPaid: paid, remainingBalance: Math.max(total - paid, 0),
      minimumPayment: numOpt(r, 'minimumPayment'), dueDate: date(r, 'dueDate'), interestRate: numOpt(r, 'interestRate') };
  });

  const goals = of('SavingsGoal').map((r) => ({
    name: str(r, 'name'), targetAmount: num(r, 'targetAmount'), currentAmount: num(r, 'currentAmount'),
    deadline: date(r, 'deadline'), isArchived: bool(r, 'isArchived'), icon: str(r, 'icon', 'banknote.fill'),
  })).filter((g) => !g.isArchived);

  const budgets = of('CategoryBudget').map((r) => ({ category: str(r, 'category'), limit: num(r, 'limit') }));

  const habitGoals = of('HabitGoal').map((r) => ({
    name: str(r, 'name'), kind: str(r, 'kind', 'family'), targetAmount: num(r, 'targetAmount'), period: str(r, 'period', 'week'),
    category: str(r, 'category', 'Family'), matchWords: str(r, 'matchWords'), createdDate: date(r, 'createdDate') || new Date(0),
    isArchived: bool(r, 'isArchived'),
  })).filter((g) => !g.isArchived);

  const assets = of('Asset').map((r) => ({
    name: str(r, 'name'), kind: str(r, 'kind', 'Other'), value: num(r, 'value'), note: str(r, 'note'),
    updatedAt: date(r, 'updatedAt') || new Date(0),
  }));

  const snapshots = of('NetWorthSnapshot').map((r) => ({
    day: date(r, 'day') || new Date(0), assets: num(r, 'assets'), liabilities: num(r, 'liabilities'),
  }));

  return { transactions, settings: settingsList[0] || null, debts, goals, budgets, habitGoals, assets, snapshots, counts, source: 'icloud' };
}

// ---------- sample data (for visitors, and before iCloud is connected) ----------
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function sampleData(now = new Date()) {
  const rand = seeded(42);
  const tx = [];
  let id = 0;
  const add = (o) => tx.push({ id: `s${id++}`, notes: '', isRecurring: false, recurringFrequency: null,
    recurringTemplateID: null, fullAmount: null, ...o });
  const today = startOfDay(now);
  const start = addMonths(monthStart(today), -2);

  // Two jobs, each every two weeks, landing on alternate Wednesdays.
  let wed = new Date(start);
  while (wed.getDay() !== 3) wed = addDays(wed, 1);
  for (let i = 0; wed <= now; i++, wed = addDays(wed, 7)) {
    add({ title: 'Paycheck', amount: i % 2 ? 1186.42 : 604.18 + Math.round(rand() * 6000) / 100, type: 'income', category: 'Salary', date: new Date(wed.getTime() + 13 * 3600e3) });
  }
  // Bills (templates dated at their first occurrence; past copies generated).
  const bill = (title, amount, category, day, full) => {
    const first = new Date(start.getFullYear(), start.getMonth(), day, 9);
    const t = { title, amount, type: 'expense', category, date: first, isRecurring: true, recurringFrequency: 'Monthly', fullAmount: full ?? null };
    add(t);
    const tid = tx[tx.length - 1].id;
    for (let k = 1; k <= 3; k++) {
      const d = addMonths(first, k);
      if (d > now) break;
      add({ title, amount, type: 'expense', category, date: d, recurringTemplateID: tid, fullAmount: full ?? null });
    }
  };
  bill('Rent', 950, 'Housing', 1);
  bill('Electric', 46.2, 'Housing', 24, 92.4);
  bill('Internet', 37.5, 'Housing', 25, 75);
  bill('Phone', 54.83, 'Subscriptions', 26, 109.65);
  bill('Streaming', 15.49, 'Subscriptions', 12);
  bill('Gym', 29.99, 'Personal Care', 5);

  // Everyday spending.
  const places = [
    ['Uber', 'Transportation', 9, 18], ['Trader Joe\'s', 'Food & Groceries', 24, 68], ['Starbucks', 'Food & Groceries', 5, 9],
    ['Chipotle', 'Food & Groceries', 11, 16], ['Target', 'Shopping', 18, 95], ['Shell', 'Transportation', 32, 48],
    ['AMC Theatres', 'Entertainment', 14, 28], ['CVS', 'Personal Care', 8, 26], ['Amazon', 'Shopping', 12, 60],
  ];
  for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
    const n = rand() < 0.22 ? 0 : 1 + Math.floor(rand() * 2.4);
    for (let i = 0; i < n; i++) {
      const [title, category, lo, hi] = places[Math.floor(rand() * places.length)];
      const amount = Math.round((lo + rand() * (hi - lo)) * 100) / 100;
      add({ title, amount, type: 'expense', category, date: new Date(d.getTime() + (8 + Math.floor(rand() * 13)) * 3600e3) });
    }
  }
  add({ title: 'Savings: Emergency fund', amount: 150, type: 'expense', category: 'Savings', date: addDays(monthStart(today), 2) });

  // Money sent home by Zelle most weeks, with the memo in the note.
  let sunday = addDays(start, -start.getDay());
  for (let w = 0; sunday <= today; w++, sunday = addDays(sunday, 7)) {
    if (w % 5 === 3) continue; // a missed week
    const day = addDays(sunday, 1 + (w % 3));
    if (day > now) break;
    add({ title: 'Zelle to Marie J.', amount: w % 4 === 1 ? 40 : 50 + (w % 3) * 10, type: 'expense', category: 'Family', date: new Date(day.getTime() + 9 * 3600e3), notes: w % 2 ? 'For Dad' : 'For Mom' });
  }

  const ago = (days) => addDays(today, -days);
  const snapshots = [];
  for (let k = 16; k >= 0; k--) {
    const drift = (16 - k) * 145 + Math.round(Math.sin(k) * 120);
    snapshots.push({ day: ago(k * 7), assets: 14_870 + drift, liabilities: 1_800 - (16 - k) * 40 });
  }

  return {
    transactions: tx,
    settings: { monthlyBudgetGoal: 2600, dailyLimit: 0, dailyLimitMode: 'paychecks', paySchedule: 'weekly:4', updatedAt: now },
    debts: [{ name: 'Credit card', totalAmount: 1800, amountPaid: 640, remainingBalance: 1160, minimumPayment: 45, dueDate: new Date(today.getFullYear(), today.getMonth(), 16), interestRate: 24.9 }],
    goals: [
      { name: 'Trip home', targetAmount: 1200, currentAmount: 410, deadline: addMonths(today, 5), icon: 'heart.fill' },
      { name: 'Emergency fund', targetAmount: 3000, currentAmount: 1240, deadline: addMonths(today, 10), icon: 'umbrella.fill' },
      { name: 'Home down payment', targetAmount: 20000, currentAmount: 2100, deadline: addMonths(today, 48), icon: 'house.fill' },
      { name: 'New laptop', targetAmount: 1200, currentAmount: 260, deadline: null, icon: 'laptopcomputer' },
    ],
    habitGoals: [{ name: 'Mom & Dad', kind: 'family', targetAmount: 50, period: 'week', category: 'Family', matchWords: 'Mom, Dad', createdDate: start, isArchived: false }],
    assets: [
      { name: 'Checking', kind: 'Checking & cash', value: 2140, updatedAt: ago(2) },
      { name: 'Emergency savings', kind: 'Savings', value: 1240, updatedAt: ago(9) },
      { name: 'Roth IRA', kind: 'Retirement', value: 3850, updatedAt: ago(20) },
      { name: 'Brokerage', kind: 'Investments', value: 1460, updatedAt: ago(20) },
      { name: '2016 Toyota Corolla', kind: 'Vehicles', value: 8500, updatedAt: ago(60) },
    ],
    snapshots,
    budgets: [],
    counts: {},
    source: 'sample',
  };
}
