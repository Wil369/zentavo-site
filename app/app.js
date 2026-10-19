import { CONFIG } from './config.js?v=20261019n';
import { cloudConfigured, connect, describeError, fetchAll, mapRecords, sampleData } from './data.js?v=20261019n';
import * as M from './money.js?v=20261019n';

const root = document.getElementById('root');
const tipEl = document.getElementById('tip');
const state = {
  data: null,
  view: (location.hash.slice(1) || 'overview'),
  calMonth: M.monthStart(new Date()),
  txFilter: { q: '', month: 'this', type: 'all', category: 'all', sort: 'date', dir: -1 },
  syncedAt: null,
  container: null,
};

// ---------- tiny helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDay = (d, opts = { month: 'short', day: 'numeric' }) => d.toLocaleDateString('en-US', opts);
const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

const ICON = {
  overview: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  transactions: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  bills: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  paychecks: '<rect x="2" y="6" width="20" height="12" rx="3"/><circle cx="12" cy="12" r="2.5"/>',
  goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  car: '<path d="M5 16l1.5-5h11L19 16"/><rect x="3" y="16" width="18" height="3" rx="1"/>',
  cart: '<path d="M3 4h2l2 11h11l2-8H6"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
  home: '<path d="M4 11l8-6 8 6v9H4z"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M20 4v5h-5M4 20v-5h5"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  star: '<path d="M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.3 7 19l1.2-5.6L4 9.6 9.6 9z"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  networth: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18M7 15h4"/>',
  plan: '<path d="M12 3v9h9"/><path d="M20.5 15.5A9 9 0 1 1 8.5 3.7"/>',
  family: '<circle cx="8" cy="7" r="2.6"/><circle cx="16" cy="7" r="2.6"/><path d="M3.5 20v-4.5A3.5 3.5 0 0 1 7 12h2a3.5 3.5 0 0 1 3.5 3.5V20M11.5 20v-4.5A3.5 3.5 0 0 1 15 12h2a3.5 3.5 0 0 1 3.5 3.5V20"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.4-5.4 3.9-7.6.4 1.6 1.2 2.7 2.4 3.3C12 7.4 13.4 5 15.6 3c.2 3 3 5.4 3 10.1 0 4.6-2.8 7.9-6.6 7.9z"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};
const svg = (name, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${ICON[name] || ICON.dot}</svg>`;
const catIcon = (c) => ({ Housing: 'home', 'Food & Groceries': 'cart', Transportation: 'car', Subscriptions: 'repeat', Shopping: 'bag',
  Entertainment: 'star', 'Personal Care': 'heart', Healthcare: 'heart', Salary: 'coin', Savings: 'coin', Investing: 'networth', Family: 'family', Giving: 'heart', 'Debt Payments': 'card' }[c] || 'dot');

// Fixed category → series slot, so a category keeps its color everywhere (never by rank).
const CAT_SLOT = { Bills: 1, 'Food & Groceries': 2, Transportation: 3, Shopping: 4, Entertainment: 5, 'Personal Care': 6, Healthcare: 6, Other: 8, Savings: 7, Education: 8, Subscriptions: 1, Housing: 1, Family: 7, Giving: 7, Investing: 3 };
const slotColor = (c) => `var(--s${CAT_SLOT[c] || 8})`;

// ---------- tooltip ----------
document.addEventListener('mousemove', (e) => {
  const target = e.target.closest?.('[data-tip]');
  if (!target) { tipEl.classList.remove('on'); return; }
  tipEl.innerHTML = target.getAttribute('data-tip');
  tipEl.classList.add('on');
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tipEl.style.left = `${x}px`; tipEl.style.top = `${y}px`;
});
document.addEventListener('scroll', () => tipEl.classList.remove('on'), true);

// ---------- boot ----------
async function boot() {
  const wantsSample = new URLSearchParams(location.search).has('sample');
  if (!cloudConfigured() || wantsSample) {
    state.data = sampleData();
    render();
    return;
  }
  renderGate();
  let container;
  try {
    container = await connect({
      onSignedOut: () => { state.data = null; location.reload(); },
      onError: (e) => setGateError(e),
    });
  } catch (err) {
    setGateError(describeError(err, 'setup'));
    return;
  }
  state.container = container;
  try {
    await loadFromCloud();
  } catch (err) {
    renderGate();
    setGateError(describeError(err, 'load'), true);
  }
}

function setGateError(e, withRetry = false) {
  const el = document.getElementById('gate-error');
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `${esc(e.text)}${e.code ? `<span class="error-code">${esc(e.code)}</span>` : ''}${withRetry ? ' <button class="link" id="gate-retry">Try again</button>' : ''}`;
  document.getElementById('gate-retry')?.addEventListener('click', () => location.reload());
}

async function loadFromCloud() {
  root.innerHTML = `<div class="gate"><p class="loading" id="progress">Loading your Zentavo from iCloud…</p></div>`;
  const records = await fetchAll(state.container, (n) => {
    const p = document.getElementById('progress');
    if (p) p.textContent = `Loading your Zentavo from iCloud… ${n} items`;
  });
  state.data = mapRecords(records);
  state.syncedAt = new Date();
  render();
}

function renderGate(error) {
  root.innerHTML = `
    <div class="gate"><div class="gate-card">
      <div class="brand" style="justify-content:center;padding:0">${brandMark()}<span>Zentavo</span></div>
      <h1>Your money, on a big screen.</h1>
      <p>Sign in with the Apple ID you use on your iPhone. Your Zentavo data comes straight from your private iCloud.</p>
      <div class="gate-points">
        <div>${svg('check')}<span>No bank login, ever. No Zentavo account.</span></div>
        <div>${svg('check')}<span>Nothing passes through a Zentavo server. This page talks only to Apple.</span></div>
        <div>${svg('check')}<span>The same numbers as your iPhone: daily limit, paydays, bills and splits.</span></div>
      </div>
      <div id="apple-sign-in-button"></div>
      <div id="apple-sign-out-button" hidden></div>
      <p class="error" id="gate-error" role="alert" ${error ? '' : 'hidden'}>${esc(error || '')}</p>
      <p class="small muted" style="margin-top:18px">Just looking? <a href="?sample">See it with sample data</a></p>
    </div></div>`;
}

function brandMark() {
  return `<span class="brand-mark"><svg viewBox="0 0 24 24"><path d="M5 18V12M10 18V8M15 18V11M20 18V5" stroke="#0B0F14" stroke-width="3" stroke-linecap="round" fill="none"/></svg></span>`;
}

// ---------- shell ----------
const VIEWS = [
  ['overview', 'Overview'], ['plan', 'Money plan'], ['transactions', 'Transactions'], ['bills', 'Bills & splits'], ['paychecks', 'Paychecks'], ['goals', 'Goals'], ['networth', 'Net worth'],
];

function render() {
  const d = state.data;
  M.useHabits(d);
  if (!VIEWS.some(([k]) => k === state.view)) state.view = 'overview';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const title = VIEWS.find(([k]) => k === state.view)[1];
  root.innerHTML = `
    <div class="shell">
      <nav class="sidebar" aria-label="Sections">
        <div class="brand">${brandMark()}<span>Zentavo</span></div>
        ${VIEWS.map(([k, label]) => `<button class="nav-btn" data-view="${k}" ${k === state.view ? 'aria-current="page"' : ''}>${svg(k)}<span>${label}</span></button>`).join('')}
        <div class="sidebar-foot">
          <div class="privacy-pill">${svg('lock')}<span>${d.source === 'icloud' ? 'Read straight from your iCloud. Nothing stored by Zentavo.' : 'Sample data. Your real data never leaves your iCloud.'}</span></div>
          ${d.source === 'icloud' ? `<div id="apple-sign-out-button"></div>` : ''}
        </div>
      </nav>
      <main class="main">
        <div class="topbar">
          <div><div class="greeting">${greeting}</div><h1 class="page-title">${title}</h1></div>
          <div class="top-actions">
            ${d.source === 'icloud'
              ? `<span class="chip">Synced ${state.syncedAt ? fmtTime(state.syncedAt) : ''}</span><button class="btn" id="refresh">Refresh</button>`
              : `<span class="chip">Sample data</span>`}
          </div>
        </div>
        ${d.source === 'sample' ? `<div class="banner"><p><strong>You're looking at sample data.</strong> With Zentavo on your iPhone, sign in with Apple to see your own.</p>${cloudConfigured() ? '<a class="btn primary" href="./">Sign in with Apple</a>' : '<span class="chip">Sign in with Apple coming soon</span>'}</div>` : ''}
        <div id="view"></div>
      </main>
    </div>`;
  root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    history.replaceState(null, '', `#${state.view}`);
    render();
    window.scrollTo(0, 0);
  }));
  document.getElementById('refresh')?.addEventListener('click', () => loadFromCloud().catch((e) => alertBanner(e.message)));
  const view = document.getElementById('view');
  ({ overview: viewOverview, transactions: viewTransactions, bills: viewBills, paychecks: viewPaychecks, goals: viewGoals, networth: viewNetWorth, plan: viewPlan })[state.view](view, d);
}

function alertBanner(message) {
  const view = document.getElementById('view');
  view.insertAdjacentHTML('afterbegin', `<div class="banner"><p><strong>Couldn't refresh.</strong> ${esc(message)}</p></div>`);
}

// ---------- overview ----------
function viewOverview(el, d) {
  const now = new Date();
  const fig = M.monthlyFigures(d, now);
  const limit = M.dailyLimit(d, now, now);
  const today = M.startOfDay(now);
  const spentToday = M.spentByDay(d.transactions, now).get(today.getTime()) || 0;
  const status = M.dayStatus(spentToday, limit.amount);
  const daysLeft = M.daysInMonth(now) - now.getDate() + 1;
  const perDay = fig.leftToSpend / daysLeft;
  const p = M.pace(d, now);
  const outlook = p ? M.monthOutlook(d, p, now, now) : null;
  const monthName = now.toLocaleDateString('en-US', { month: 'long' });

  el.innerHTML = `
    <section class="grid kpis">
      ${M.limitMode(d.settings) === 'paychecks' ? planKpi(d, now, monthName) : `<div class="card">
        <h2>Left to spend in ${monthName}</h2>
        <div class="hero-num ${fig.leftToSpend < 0 ? 'over' : ''}">${M.money(fig.leftToSpend)}</div>
        ${fig.budget > 0 ? `<div class="bar ${fig.leftToSpend < 0 ? 'rose' : pct(fig.expenses, fig.budget) > 85 ? 'amber' : ''}"><span style="width:${pct(fig.expenses, fig.budget)}%"></span></div>
        <div class="kpi-sub"><b>${M.money0(fig.expenses)}</b> of ${M.money(fig.budget)} budget · about <b>${M.money(Math.max(perDay, 0))}</b> a day for the rest of ${monthName}</div>` : `<div class="kpi-sub">No monthly budget set</div>`}
      </div>`}
      <div class="card">
        <h2>Today</h2>
        <div class="kpi-val ${status === 'over' ? 'status-bad' : status === 'close' ? 'status-warn' : ''}">${M.money(spentToday)}</div>
        <div class="kpi-sub">${limit.amount > 0 ? `of ${M.money0(limit.amount)} daily limit · <b class="${status === 'over' ? 'status-bad' : 'status-good'}">${spentToday > limit.amount ? `${M.money(spentToday - limit.amount)} over` : `${M.money(limit.amount - spentToday)} left`}</b>` : 'No daily limit set'}</div>
        ${limit.amount > 0 ? `<div class="bar ${status === 'over' ? 'rose' : status === 'close' ? 'amber' : ''}"><span style="width:${pct(spentToday, limit.amount)}%"></span></div>` : ''}
        ${limit.amount > 0 ? weekLine(M.weekBudget(d, now), spentToday, limit.amount) : ''}
      </div>
      <div class="card">
        <h2>Next payday</h2>
        ${p ? `<div class="kpi-val">${M.sameDay(p.next, today) ? 'Today' : fmtDay(p.next, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
        <div class="kpi-sub">about <b>${M.money(p.nextAmount)}</b> · ${M.sameDay(p.next, today) ? 'lands today' : `in ${Math.round((p.next - today) / 86400000)} days`}</div>` : `<div class="kpi-val muted">—</div><div class="kpi-sub">No paychecks logged yet</div>`}
      </div>
      <div class="card">
        <h2>Take-home in ${monthName}</h2>
        ${outlook ? `<div class="kpi-val">${M.money0(outlook.received)}</div>
        <div class="kpi-sub">received · about <b>${M.money0(outlook.expected)}</b> by month end${outlook.extra ? ' · extra payday this month' : ''}</div>
        <div class="bar"><span style="width:${pct(outlook.received, outlook.expected)}%"></span></div>` : `<div class="kpi-val">${M.money0(fig.actualIncome)}</div><div class="kpi-sub">income logged this month</div>`}
      </div>
    </section>

    <section class="card" style="margin-bottom:18px">
      <h2>Next 14 days ${p ? `<span class="chip mint">Payday ${M.sameDay(p.next, today) ? 'today' : `in ${Math.round((p.next - today) / 86400000)} days`}</span>` : ''}</h2>
      ${upcomingStrip(d, p, today)}
    </section>

    ${M.limitMode(d.settings) === 'paychecks' ? planSplit(M.moneyPlan(d, now)) : ''}
    ${overviewGoals(d, now)}

    <section class="grid two">
      <div class="card">
        <h2>Day by day <span class="link small">${limit.amount > 0 ? `Limit ${M.money0(limit.amount)} a day` : ''}</span></h2>
        <div id="calendar"></div>
        <p class="small muted" style="margin-top:10px">${esc(limit.explanation || '')}</p>
      </div>
      <div class="card">
        <h2>Recent <button class="link" data-goto="transactions">See all</button></h2>
        ${txRows(d.transactions.filter((t) => t.date <= now && !M.isTemplate(t)).sort((a, b) => b.date - a.date).slice(0, 8))}
      </div>
    </section>

    <section class="grid halves">
      <div class="card flow">
        <h2>Where ${monthName}'s money goes</h2>
        ${cashFlow(d, now, p, outlook, fig)}
      </div>
      <div class="card">
        <h2>Everyday spending by category</h2>
        ${categoryBars(d, now)}
      </div>
    </section>`;
  drawCalendar(el.querySelector('#calendar'), d, limit);
  el.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.goto; history.replaceState(null, '', `#${state.view}`); render(); }));
}

const compact = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1).replace(/\.0$/, '')}K` : M.money0(v));
const both = (sign, v) => `<span class="full">${sign}${M.money0(v)}</span><span class="compact">${sign}${compact(v)}</span>`;

function upcomingStrip(d, p, today) {
  const end = M.addDays(today, 14);
  // A spending budget entered as a repeat (Transportation $400) isn't a bill: its money is
  // counted day by day, so it's shown faded and left out of the bill total.
  const events = M.upcomingEvents(d, today, end).filter((e) => !e.isIncome)
    .map((e) => ({ ...e, budget: !!e.transaction && M.isBudgetLike(e.transaction, d.transactions) }))
    .sort((a, b) => a.budget - b.budget);
  const bills = events.filter((e) => !e.budget);
  const pays = p ? M.projectedPaydays(p, end) : [];
  const cells = [];
  for (let i = 0; i < 14; i++) {
    const day = M.addDays(today, i);
    const dayEvents = events.filter((e) => M.sameDay(e.date, day));
    const pay = pays.find((x) => M.sameDay(x.day, day));
    const tags = [
      pay ? `<div class="tag pay" data-tip="<b>Payday</b><br>about ${M.money(pay.amount)}">${both('+', pay.amount)}</div>` : '',
      ...dayEvents.slice(0, 2).map((e) => `<div class="tag ${e.budget ? 'budget' : ''}" data-tip="<b>${esc(e.title)}</b><br>${M.money(e.amount)} · ${e.budget ? 'a spending budget, counted day by day' : esc(e.detail)}">${both('', e.amount)}</div>`),
      dayEvents.length > 2 ? `<div class="tag" data-tip="${esc(dayEvents.slice(2).map((e) => `${e.title} ${M.money(e.amount)}`).join('<br>'))}">+${dayEvents.length - 2} more</div>` : '',
    ].join('');
    cells.push(`<div class="strip-day ${i === 0 ? 'today' : ''}">
      <div class="strip-dow">${i === 0 ? 'Today' : day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
      <div class="strip-date">${day.getDate()}</div>${tags}</div>`);
  }
  const billTotal = bills.reduce((s, e) => s + e.amount, 0);
  return `<div class="strip">${cells.join('')}</div>
    <p class="small muted" style="margin-top:10px">${bills.length ? `${bills.length} bill${bills.length === 1 ? '' : 's'} for ${M.money(billTotal)}` : 'No bills'}${pays.length ? ` · ${pays.length} payday${pays.length === 1 ? '' : 's'} for about ${M.money0(pays.reduce((s, x) => s + x.amount, 0))}` : ''}</p>`;
}

function drawCalendar(host, d, limitInfo) {
  const month = state.calMonth;
  const now = new Date();
  const today = M.startOfDay(now);
  const limit = M.inMonth(month, now) ? limitInfo.amount : M.dailyLimit(d, month, now).amount;
  const totals = M.spentByDay(d.transactions, month);
  const first = month.getDay();
  const days = M.daysInMonth(month);
  const firstUse = d.transactions.filter(M.countsForDay).reduce((m, t) => (t.date < m ? t.date : m), now);
  let under = 0, counted = 0, sum = 0;
  const cells = [];
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((x) => cells.push(`<div class="cal-dow">${x}</div>`));
  for (let i = 0; i < first; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let day = 1; day <= days; day++) {
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    const spent = totals.get(date.getTime()) || 0;
    const future = date > today;
    const st = future || date < M.startOfDay(firstUse) ? 'none' : M.dayStatus(spent, limit);
    if (!future && date >= M.startOfDay(firstUse)) { counted++; sum += spent; if (st === 'under' || st === 'close') under++; }
    const entries = d.transactions.filter((t) => M.countsForDay(t) && M.sameDay(t.date, date));
    const tip = `<b>${fmtDay(date, { weekday: 'long', month: 'short', day: 'numeric' })}</b><br>${M.money(spent)} spent${limit > 0 && !future ? ` of ${M.money0(limit)}` : ''}${entries.slice(0, 5).map((t) => `<br>· ${esc(t.title || t.category)} ${M.money(t.amount)}`).join('')}${entries.length > 5 ? `<br>· and ${entries.length - 5} more` : ''}`;
    cells.push(`<div class="cal-cell ${st !== 'none' ? st : ''} ${future ? 'future' : ''} ${M.sameDay(date, today) ? 'today' : ''}" data-tip="${esc(tip)}">
      <span class="d">${day}</span><span class="v">${spent > 0 ? M.money0(spent) : future ? '' : '$0'}</span></div>`);
  }
  const canNext = M.monthStart(month) < M.monthStart(now);
  host.innerHTML = `
    <div class="cal-head">
      <button class="icon-btn" id="cal-prev" aria-label="Previous month">‹</button>
      <span class="title">${month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
      <button class="icon-btn" id="cal-next" aria-label="Next month" ${canNext ? '' : 'disabled'}>›</button>
    </div>
    <div class="cal">${cells.join('')}</div>
    <div class="legend">
      <span><i class="sw" style="background:var(--mint)"></i>Under</span>
      <span><i class="sw" style="background:var(--amber)"></i>Close</span>
      <span><i class="sw" style="background:var(--rose)"></i>Over</span>
      <span class="num">${counted ? `${under} of ${counted} days at or under · average ${M.money(sum / counted)}` : ''}</span>
    </div>`;
  host.querySelector('#cal-prev').addEventListener('click', () => { state.calMonth = M.addMonths(state.calMonth, -1); drawCalendar(host, d, limitInfo); });
  host.querySelector('#cal-next').addEventListener('click', () => { if (canNext) { state.calMonth = M.addMonths(state.calMonth, 1); drawCalendar(host, d, limitInfo); } });
}

function txRows(list) {
  if (!list.length) return '<div class="empty-state">Nothing yet</div>';
  return `<div class="rows">${list.map((t) => {
    const s = M.share(t);
    const sub = `${esc(M.shortName(t.category))} · ${fmtDay(t.date)}${s < 0.999 ? ` · your ${M.sharePhrase(s)} of ${M.money(t.fullAmount)}` : ''}`;
    return `<div class="row"><span class="ic">${svg(catIcon(t.category))}</span>
      <div class="grow"><div class="t">${esc(t.title || t.category)}</div><div class="s">${sub}</div></div>
      <span class="amt ${t.type === 'income' ? 'in' : ''}">${t.type === 'income' ? '+' : '−'}${M.money(t.amount)}</span></div>`;
  }).join('')}</div>`;
}

function categoryBars(d, month) {
  const totals = new Map();
  for (const t of d.transactions) if (M.countsForDay(t) && M.inMonth(t.date, month)) totals.set(t.category, (totals.get(t.category) || 0) + t.amount);
  const rows = [...totals].sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<div class="empty-state">No everyday spending this month yet</div>';
  const max = rows[0][1];
  const total = rows.reduce((s, r) => s + r[1], 0);
  return rows.map(([c, v]) => `<div class="cat-row" data-tip="<b>${esc(c)}</b><br>${M.money(v)} · ${Math.round((v / total) * 100)}% of everyday spending">
      <span class="name">${esc(M.shortName(c))}</span>
      <span class="cat-track"><span class="cat-fill" style="width:${(v / max) * 100}%"></span></span>
      <span class="val">${M.money0(v)}</span></div>`).join('')
    + `<p class="small muted" style="margin-top:10px">${M.money(total)} everyday spending this month. Bills and savings are separate.</p>`;
}

function cashFlow(d, now, p, outlook, fig) {
  const income = outlook ? Math.max(outlook.expected, outlook.received) : fig.income;
  const bills = M.billsInMonth(d, now);
  const cats = new Map();
  for (const t of d.transactions) if (M.countsForDay(t) && M.inMonth(t.date, now)) cats.set(t.category, (cats.get(t.category) || 0) + t.amount);
  let catRows = [...cats].sort((a, b) => b[1] - a[1]);
  if (catRows.length > 5) {
    const rest = catRows.slice(4).reduce((s, r) => s + r[1], 0);
    catRows = [...catRows.slice(0, 4), ['Other', rest]];
  }
  const saved = fig.saved;
  const outs = [[(d.habitGoals || []).length ? 'Bills & goals' : 'Bills', bills, 'Bills'], ...catRows.map(([c, v]) => [M.shortName(c), v, c]), ...(saved > 0 ? [['Savings', saved, 'Savings']] : [])];
  const spent = outs.reduce((s, o) => s + o[1], 0);
  const left = income - spent;
  if (left > 0) outs.push(['Not spent yet', left, 'left']);
  if (!(income > 0) || !outs.length) return '<div class="empty-state">Log a paycheck to see where your money goes</div>';

  const W = 560, H = 320, nodeW = 12, gap = 6, labelW = 150;
  const totalRight = outs.reduce((s, o) => s + o[1], 0);
  const scale = (H - gap * (outs.length - 1)) / Math.max(totalRight, income);
  const leftH = income * scale;
  const leftY = (H - leftH) / 2;
  let y = 0, ly = leftY;
  const x0 = 120, x1 = W - labelW;
  const parts = [];
  let lastLabelY = -Infinity;
  outs.forEach(([label, v, key]) => {
    const h = Math.max(v * scale, 1.5);
    const color = key === 'left' ? 'var(--line-2)' : slotColor(key);
    const lh = Math.min(v * scale, leftH - (ly - leftY));
    const c = (x0 + nodeW + x1) / 2;
    const tip = `<b>${esc(label)}</b><br>${M.money(v)} · ${Math.round((v / income) * 100)}% of take-home`;
    parts.push(`<path d="M${x0 + nodeW},${ly} C${c},${ly} ${c},${y} ${x1},${y} L${x1},${y + h} C${c},${y + h} ${c},${ly + lh} ${x0 + nodeW},${ly + lh} Z" fill="${color}" opacity="${key === 'left' ? 0.35 : 0.28}" data-tip="${esc(tip)}"/>`);
    parts.push(`<rect x="${x1}" y="${y}" width="${nodeW}" height="${h}" rx="3" fill="${color}" data-tip="${esc(tip)}"/>`);
    const labelY = Math.max(y + h / 2 + 4, lastLabelY + 17);
    lastLabelY = labelY;
    if (Math.abs(labelY - (y + h / 2 + 4)) > 3) {
      parts.push(`<path d="M${x1 + nodeW + 1},${y + h / 2} L${x1 + nodeW + 5},${labelY - 4}" stroke="#4A5562" stroke-width="1" fill="none"/>`);
    }
    parts.push(`<text x="${x1 + nodeW + 8}" y="${labelY}" font-size="12.5" font-weight="700" fill="#C9CED6">${esc(label)} <tspan fill="#F3F1EA" font-weight="800">${M.money0(v)}</tspan></text>`);
    y += h + gap;
    ly += lh;
  });
  const leftLabel = outlook ? 'Take-home' : 'Income';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${leftLabel} ${M.money0(income)} split into bills, spending, savings and what's left">
      <rect x="${x0}" y="${leftY}" width="${nodeW}" height="${leftH}" rx="3" fill="var(--mint)"/>
      <text x="${x0 - 10}" y="${leftY + leftH / 2 - 6}" font-size="12.5" font-weight="700" fill="#C9CED6" text-anchor="end">${leftLabel}</text>
      <text x="${x0 - 10}" y="${leftY + leftH / 2 + 12}" font-size="15" font-weight="800" fill="#F3F1EA" text-anchor="end">${M.money0(income)}</text>
      ${parts.join('')}
    </svg>
    <p class="small muted">${outlook ? `Expected take-home for the month (${M.money0(outlook.received)} received so far).` : 'Income logged this month.'} Bills count only your share of split bills.</p>`;
}

// ---------- transactions ----------
function viewTransactions(el, d) {
  const f = state.txFilter;
  const months = [...new Set(d.transactions.map((t) => `${t.date.getFullYear()}-${t.date.getMonth()}`))]
    .map((k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m, 1); }).sort((a, b) => b - a);
  const categories = [...new Set(d.transactions.map((t) => t.category))].sort();
  el.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input class="input search" id="q" type="search" placeholder="Search name, category or note" value="${esc(f.q)}" aria-label="Search transactions">
        <select class="input" id="month" aria-label="Month">
          <option value="this" ${f.month === 'this' ? 'selected' : ''}>This month</option>
          <option value="all" ${f.month === 'all' ? 'selected' : ''}>All time</option>
          ${months.map((m) => `<option value="${m.getTime()}" ${String(f.month) === String(m.getTime()) ? 'selected' : ''}>${m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</option>`).join('')}
        </select>
        <select class="input" id="type" aria-label="Type">
          <option value="all">Money in and out</option>
          <option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Spent</option>
          <option value="income" ${f.type === 'income' ? 'selected' : ''}>Income</option>
          <option value="repeats" ${f.type === 'repeats' ? 'selected' : ''}>Repeating</option>
        </select>
        <select class="input" id="category" aria-label="Category">
          <option value="all">All categories</option>
          ${categories.map((c) => `<option ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <button class="btn" id="export">Export CSV</button>
      </div>
      <div id="tx-table"></div>
    </div>`;
  const update = () => drawTxTable(el.querySelector('#tx-table'), d);
  el.querySelector('#q').addEventListener('input', (e) => { f.q = e.target.value; update(); });
  el.querySelector('#month').addEventListener('change', (e) => { f.month = e.target.value; update(); });
  el.querySelector('#type').addEventListener('change', (e) => { f.type = e.target.value; update(); });
  el.querySelector('#category').addEventListener('change', (e) => { f.category = e.target.value; update(); });
  el.querySelector('#export').addEventListener('click', () => exportCSV(filteredTx(d)));
  update();
}

function filteredTx(d) {
  const f = state.txFilter;
  const now = new Date();
  const q = f.q.trim().toLowerCase();
  let list = d.transactions.filter((t) => {
    if (f.month === 'this' && !M.inMonth(t.date, now)) return false;
    if (f.month !== 'this' && f.month !== 'all' && !M.inMonth(t.date, new Date(Number(f.month)))) return false;
    if (f.type === 'repeats' && !(M.isTemplate(t) || M.isGenerated(t))) return false;
    if ((f.type === 'expense' || f.type === 'income') && t.type !== f.type) return false;
    if (f.category !== 'all' && t.category !== f.category) return false;
    if (q && !`${t.title} ${t.category} ${t.notes}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const key = f.sort;
  list.sort((a, b) => {
    const va = key === 'amount' ? a.amount : key === 'title' ? (a.title || '').toLowerCase() : key === 'category' ? a.category : a.date.getTime();
    const vb = key === 'amount' ? b.amount : key === 'title' ? (b.title || '').toLowerCase() : key === 'category' ? b.category : b.date.getTime();
    return (va < vb ? -1 : va > vb ? 1 : 0) * f.dir;
  });
  return list;
}

function drawTxTable(host, d) {
  const f = state.txFilter;
  const list = filteredTx(d);
  const spent = list.filter(M.isSpending).reduce((s, t) => s + t.amount, 0);
  const income = list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const arrow = (k) => (f.sort === k ? (f.dir < 0 ? ' ↓' : ' ↑') : '');
  host.innerHTML = list.length ? `
    <div class="table-wrap"><table>
      <thead><tr>
        <th data-sort="date">Date${arrow('date')}</th><th data-sort="title">Name${arrow('title')}</th>
        <th data-sort="category">Category${arrow('category')}</th><th>Details</th><th class="r" data-sort="amount">Amount${arrow('amount')}</th>
      </tr></thead>
      <tbody>${list.slice(0, 600).map((t) => {
        const s = M.share(t);
        const details = [t.date > new Date() ? '<span class="pill amber">Upcoming</span>' : '', M.isTemplate(t) ? `<span class="pill">Repeats ${esc((t.recurringFrequency || '').toLowerCase())}</span>` : M.isGenerated(t) ? '<span class="pill">Repeating</span>' : '',
          s < 0.999 ? `<span class="pill mint">Your ${M.sharePhrase(s)} of ${M.money(t.fullAmount)}</span>` : '',
          t.notes ? `<span class="muted small">${esc(t.notes)}</span>` : ''].filter(Boolean).join(' ');
        return `<tr><td class="num">${fmtDay(t.date, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td class="t">${esc(t.title || t.category)}</td>
          <td>${esc(M.shortName(t.category))}</td><td>${details}</td>
          <td class="r amt ${t.type === 'income' ? 'in' : ''}">${t.type === 'income' ? '+' : '−'}${M.money(t.amount)}</td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="totals"><span><b>${list.length}</b> entries${list.length > 600 ? ' (first 600 shown)' : ''}</span><span>Spent <b>${M.money(spent)}</b></span><span>Income <b>${M.money(income)}</b></span></div>`
    : '<div class="empty-state">No entries match</div>';
  host.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (f.sort === k) f.dir *= -1; else { f.sort = k; f.dir = k === 'title' || k === 'category' ? 1 : -1; }
    drawTxTable(host, d);
  }));
}

function exportCSV(list) {
  const rows = [['Date', 'Name', 'Category', 'Type', 'Amount', 'Your share of', 'Notes']];
  for (const t of list) rows.push([t.date.toISOString().slice(0, 10), t.title, t.category, t.type, t.amount.toFixed(2), t.fullAmount ? t.fullAmount.toFixed(2) : '', t.notes || '']);
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `zentavo-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- bills ----------
function viewBills(el, d) {
  const now = new Date();
  const lines = M.billLines(d, now);
  const counted = lines.filter((l) => l.counted);
  const total = counted.reduce((s, l) => s + l.total, 0);
  const saved = lines.filter((l) => l.counted && l.fullTotal).reduce((s, l) => s + (l.fullTotal - l.total), 0);
  const today = M.startOfDay(now);
  const events = M.upcomingEvents(d, today, M.addDays(today, 31)).filter((e) => !e.isIncome)
    .map((e) => ({ ...e, budget: !!e.transaction && M.isBudgetLike(e.transaction, d.transactions) }));
  const due = events.filter((e) => !e.budget);
  const p = M.pace(d, now);
  const pays = p ? M.projectedPaydays(p, M.addDays(today, 31)) : [];
  const timeline = [...events.map((e) => ({ ...e, kind: 'bill' })), ...pays.map((x) => ({ date: x.day, title: 'Payday', amount: x.amount, kind: 'pay' }))].sort((a, b) => a.date - b.date);
  el.innerHTML = `
    <section class="grid kpis three">
      <div class="card"><h2>Bills this month</h2><div class="kpi-val">${M.money(total)}</div><div class="kpi-sub">${counted.length} counted in your daily limit</div></div>
      <div class="card"><h2>Covered by others</h2><div class="kpi-val">${M.money(saved)}</div><div class="kpi-sub">the other share of split bills, not counted as yours</div></div>
      <div class="card"><h2>Next 31 days</h2><div class="kpi-val">${M.money(due.reduce((s, e) => s + e.amount, 0))}</div><div class="kpi-sub">${due.length} bills due</div></div>
    </section>
    <section class="grid halves">
      <div class="card"><h2>This month's bills</h2>
        <div class="rows">${lines.map((l) => `<div class="row">
          <span class="ic">${svg(catIcon(l.category))}</span>
          <div class="grow"><div class="t">${esc(l.title)}</div>
            <div class="s">${esc(l.kind)}${l.times > 1 ? ` · ${l.times} times` : ''}${l.fullTotal ? ` of ${M.money(l.fullTotal)}` : ''}</div>
            ${l.note ? `<div class="note">${esc(l.note)}</div>` : ''}</div>
          <span class="amt ${l.counted ? '' : 'muted'}">${l.counted ? M.money(l.total) : 'Not counted'}</span></div>`).join('') || '<div class="empty-state">No repeating bills</div>'}</div>
      </div>
      <div class="card"><h2>Coming up</h2>
        <div class="rows">${timeline.map((e) => `<div class="row">
          <span class="ic">${svg(e.kind === 'pay' ? 'coin' : catIcon(e.transaction?.category))}</span>
          <div class="grow"><div class="t">${esc(e.title)}</div><div class="s">${fmtDay(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}${e.kind === 'bill' ? ` · ${e.budget ? 'spending budget, counted day by day' : esc(e.detail)}` : ' · expected'}</div></div>
          <span class="amt ${e.kind === 'pay' ? 'in' : e.budget ? 'muted' : ''}">${e.kind === 'pay' ? '+' : e.budget ? '' : '−'}${M.money(e.amount)}</span></div>`).join('') || '<div class="empty-state">Nothing in the next month</div>'}</div>
      </div>
    </section>`;
}

// ---------- paychecks ----------
function viewPaychecks(el, d) {
  const now = new Date();
  const p = M.pace(d, now);
  if (!p) {
    el.innerHTML = `<div class="card"><div class="empty-state">No paychecks logged yet. On your iPhone, Zentavo logs them from your bank's deposit email, or add one with + → Income.</div></div>`;
    return;
  }
  const outlook = M.monthOutlook(d, p, now, now);
  const extra = M.nextExtraPaydayMonth(p, now);
  const days = M.daysInMonth(now);
  const today = M.startOfDay(now);
  const history = p.history.filter((x) => x.day >= M.addDays(today, -112));
  const future = M.projectedPaydays(p, M.addDays(today, 29)).slice(0, 4);
  const cols = [...history.map((x) => ({ ...x, projected: false })), ...future.map((x) => ({ ...x, projected: true }))];
  const max = Math.max(...cols.map((c) => c.amount), 1);
  const year = [];
  const futureYear = M.projectedPaydays(p, M.addMonths(M.monthStart(now), 13));
  for (let k = 0; k < 12; k++) {
    const m = M.addMonths(M.monthStart(now), k);
    const inM = futureYear.filter((x) => M.inMonth(x.day, m));
    const got = k === 0 ? outlook.receivedCount : 0;
    year.push({ m, count: inM.length + got, total: inM.reduce((s, x) => s + x.amount, 0) + (k === 0 ? outlook.received : 0) });
  }
  el.innerHTML = `
    <section class="grid kpis">
      <div class="card"><h2>Take-home pace</h2><div class="hero-num">${M.money0(p.perDay * days)}</div>
        <div class="kpi-sub">a month after taxes · ${p.planned ? 'from a repeating income entry, not real deposits' : `based on your last ${p.counted} paychecks`}</div></div>
      <div class="card"><h2>Payday</h2><div class="kpi-val">${esc(p.scheduleName)}</div><div class="kpi-sub">last ${M.money(p.last.amount)} on ${fmtDay(p.last.day, { weekday: 'short', month: 'short', day: 'numeric' })}</div></div>
      <div class="card"><h2>Next</h2><div class="kpi-val">${fmtDay(p.next, { weekday: 'short', month: 'short', day: 'numeric' })}</div><div class="kpi-sub">about <b>${M.money(p.nextAmount)}</b></div></div>
      <div class="card"><h2>This month</h2><div class="kpi-val">${M.money0(outlook.received)}</div><div class="kpi-sub">in · about <b>${M.money0(outlook.expected)}</b> by month end · ${outlook.paydayCount} paydays</div></div>
    </section>
    <section class="grid two">
      <div class="card"><h2>Paychecks <span class="legend" style="margin:0"><span><i class="sw" style="background:var(--mint)"></i>Received</span><span><i class="sw" style="box-shadow:inset 0 0 0 2px var(--mint)"></i>Expected</span></span></h2>
        <div class="cols">${cols.map((c) => `<div class="col ${c.projected ? 'projected' : ''}" data-tip="<b>${fmtDay(c.day, { weekday: 'short', month: 'short', day: 'numeric' })}</b><br>${c.projected ? 'about ' : ''}${M.money(c.amount)}${c.projected ? ' expected' : ''}"><div class="colbar" style="height:${(c.amount / max) * 100}%"></div></div>`).join('')}</div>
        <div class="col-labels">${cols.map((c) => `<span>${c.day.getMonth() + 1}/${c.day.getDate()}</span>`).join('')}</div>
        <p class="small muted" style="margin-top:12px">Weekly pay from two jobs alternates, so each coming check is expected to match the one two weeks before it.</p>
      </div>
      <div class="card"><h2>The next 12 months</h2>
        <div class="rows">${year.map((y) => `<div class="kv"><span class="k">${y.m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          <span class="v">${y.count} paydays · ${M.money0(y.total)}${y.count > p.usual ? ' <span class="pill mint">Extra payday</span>' : ''}</span></div>`).join('')}</div>
        ${extra ? `<p class="small muted" style="margin-top:10px">${extra.month.toLocaleDateString('en-US', { month: 'long' })} has ${extra.count} paydays. It raises that month's daily limit, or it can all go to savings.</p>` : ''}
      </div>
    </section>`;
}

// ---------- money plan ----------
function planKpi(d, now, monthName) {
  const pl = M.moneyPlan(d, now);
  return `<div class="card clickable" data-goto="plan">
    <h2>Left in ${monthName}</h2>
    <div class="hero-num ${pl.leftThisMonth < 0 ? 'over' : ''}">${M.money(pl.leftThisMonth)}</div>
    <div class="bar ${pl.leftThisMonth < 0 ? 'rose' : pct(pl.used, pl.takeHome) > 85 ? 'amber' : ''}"><span style="width:${pct(pl.used, pl.takeHome)}%"></span></div>
    <div class="kpi-sub"><b>${M.money0(pl.used)}</b> of ${M.money0(pl.takeHome)} take-home · ${pl.canInvest > 0 ? `about <b class="status-good">${M.money0(pl.leftToInvest)}</b> left to invest this month` : 'your spending pace uses all of this month\'s pay'}</div>
  </div>`;
}

function viewPlan(el, d) {
  const now = new Date();
  const pl = M.moneyPlan(d, now);
  const monthName = now.toLocaleDateString('en-US', { month: 'long' });
  const end = `${monthName} ${M.daysInMonth(now)}`;
  const coming = pl.paydayCount - pl.landedCount;
  const row = (icon, title, detail, amount, sign, cls = '') => `<div class="row">
      <span class="ic">${svg(icon)}</span>
      <div class="grow"><div class="t">${esc(title)}</div><div class="s">${detail}</div></div>
      <span class="amt ${cls}">${sign}${M.money(amount)}</span></div>`;
  const sub = (title, amount, hi) => `<div class="row subtotal ${hi ? 'hi' : ''}"><div class="grow"><div class="t">${title}</div></div><span class="amt">${M.money(amount)}</span></div>`;
  const investGoal = (d.habitGoals || []).find((g) => g.kind === 'investing');
  const limitNow = M.dailyLimit(d, now, now).amount;
  const limitWith = Math.max(Math.floor(limitNow - Math.max(pl.suggestedInvest, 50) / M.daysInMonth(now)), 0);
  el.innerHTML = `
    <section class="grid kpis">
      <div class="card"><h2>Left to invest in ${monthName}</h2><div class="hero-num ${pl.leftToInvest > 0 ? '' : 'over'}">${M.money0(pl.leftToInvest)}</div>
        <div class="kpi-sub">${pl.canInvest <= 0 ? (pl.savedInMonth > 0 ? `Bills, your <b>${M.money0(pl.savedInMonth)}</b> to savings and everyday spending use this month's pay.` : 'At your everyday pace, bills and spending use all of this month\'s pay.')
          : pl.invested > 0 ? `You've invested <b>${M.money0(pl.invested)}</b> so far. About <b>${M.money0(pl.leftToInvest)}</b> more is free by ${end}.`
          : `After bills${pl.goals.length ? ', goals' : ''}${pl.savedInMonth > 0 ? ', savings' : ''} and everyday spending${pl.usesBudgets ? ` (your <b>${M.money0(pl.everydayBudgetTotal)}</b> everyday budgets)` : pl.paceDays ? ` (about <b>${M.money0(pl.perDay)}</b> a day)` : ''}, free by ${end}.`}</div></div>
      <div class="card"><h2>Take-home</h2><div class="kpi-val">${M.money0(pl.takeHome)}</div><div class="kpi-sub">${pl.fromPaychecks ? `${pl.paydayCount} paychecks · ${pl.landedCount} in${coming > 0 ? `, ${coming} coming` : ''}` : 'income this month'}</div></div>
      <div class="card"><h2>Bills & goals</h2><div class="kpi-val">${M.money0(pl.billsTotal + pl.goalsTotal)}</div><div class="kpi-sub">your share only · ${pl.bills.length + pl.goals.length} items</div></div>
      <div class="card"><h2>Invested this month</h2><div class="kpi-val ${pl.invested > 0 ? 'status-good' : ''}">${M.money0(pl.invested)}</div><div class="kpi-sub">${investGoal ? `goal ${M.money0(investGoal.targetAmount)} a ${investGoal.period === 'month' ? 'month' : 'week'}` : 'Fidelity, Robinhood…'}</div></div>
    </section>
    ${planSplit(pl)}
    <section class="grid two">
      <div class="card"><h2>Where your paychecks go</h2>
        <div class="rows">
          ${row('coin', 'Take-home', pl.fromPaychecks ? `${pl.paydayCount} paychecks · ${pl.landedCount} in${coming > 0 ? `, ${coming} coming` : ''}` : 'This month\'s income', pl.takeHome, '+', 'in')}
          ${pl.bills.map((l) => row(catIcon(l.category), l.title, l.billsAccount ? esc(l.kind) : l.fullTotal ? `Your ${M.sharePhrase(l.share)} of ${M.money(l.fullTotal)}` : l.kind === 'Debt payment' ? 'Debt minimum' : l.times > 1 ? `${l.times} times this month` : 'Monthly', l.total, '−')).join('')}
          ${pl.goals.map((l) => row('family', l.title, esc(l.kind), l.total, '−')).join('')}
          ${sub('Free after bills & goals', pl.free)}
          ${row('cart', 'Everyday spending', pl.usesBudgets ? `Your budgets: ${pl.everydayBudgets.slice(0, 3).map((b) => `${M.shortName(b.category)} ${M.money0(b.amount)}`).join(', ')} · ${M.money0(pl.everydaySpent)} spent so far` : pl.daysLeft && pl.paceDays ? `${M.money0(pl.everydaySpent)} so far + about ${M.money0(pl.perDay)} a day for ${pl.daysLeft} more days` : `${M.money0(pl.everydaySpent)} this month`, pl.projectedEveryday, '−')}
          ${pl.savedInMonth > 0 ? row('coin', 'To savings', pl.savingsPlanned > 0 ? `${pl.savingsMoves.reduce((s, l) => s + l.times, 0)} moves this month${pl.saved > 0 ? ` · ${M.money0(pl.saved)} moved so far` : ''}` : 'This month', pl.savedInMonth, '−') : ''}
          ${pl.invested > 0 ? row('networth', 'Already invested', 'This month', pl.invested, '−') : ''}
          ${sub('Left to invest', pl.leftToInvest, true)}
        </div>
      </div>
      <div class="card"><h2>Pay yourself first</h2>
        ${investGoal ? `<p class="kpi-sub">Your investing goal (${M.money0(investGoal.targetAmount)} a ${investGoal.period === 'month' ? 'month' : 'week'}) is taken out before the daily limit, so the limit leaves room for it.</p>`
          : `<p class="kpi-sub" style="margin-bottom:12px">Your daily limit (<b>${M.money0(limitNow)}</b>) gives everything after bills to everyday spending. Set an investing goal on your iPhone (Home → Money plan) and Zentavo takes it out first.</p>
            ${pl.canInvest >= 50 ? `<div class="kv"><span class="k">Invest ${M.money0(Math.max(pl.suggestedInvest, 50))} a month (keeps a cushion)</span><span class="v status-good">daily limit about ${M.money0(limitWith)}</span></div>` : ''}`}
        <p class="small muted" style="margin-top:14px">Take-home is what lands in your account, after taxes, 401(k) and insurance. Paychecks still to come are estimated from your recent ones.${pl.paceDays && pl.paceDays < 14 ? ` Your everyday pace is based on ${pl.paceDays} days of spending, so it firms up as you log more.` : ''}</p>
      </div>
    </section>`;
}

// This week against seven days of the limit: a bigger day is fine when the week can take it.
function weekLine(w, spentToday, dayLimit) {
  if (!(w.limit > 0)) return '';
  const st = M.dayStatus(w.spent, w.limit);
  const hint = w.left < 0 ? 'Over for the week. Lighter days from here bring it back.'
    : spentToday > dayLimit ? (w.daysLeft > 1 ? `Over today, but the week can take it: about ${M.money0(Math.floor(w.perDayAfterToday))} a day for the rest of the week.` : 'Over today, but the week still ends on budget.')
    : w.daysLeft > 1 ? `Leaves about ${M.money0(Math.floor(w.perDayAfterToday))} a day for the other ${w.daysLeft - 1} day${w.daysLeft === 2 ? '' : 's'}.` : 'Last day of the week.';
  return `<div class="kpi-sub" style="margin-top:6px"><b>This week</b> ${M.money(w.spent)} of ${M.money0(w.limit)} · <b class="${w.left < 0 ? 'status-bad' : 'status-good'}">${w.left < 0 ? `${M.money(-w.left)} over` : `${M.money(w.left)} left`}</b></div>
    <div class="bar ${st === 'over' ? 'rose' : st === 'close' ? 'amber' : ''}" style="margin:8px 0 6px"><span style="width:${pct(w.spent, w.limit)}%"></span></div>
    <div class="small muted">${hint}</div>`;
}

// The spending-plan split: fixed costs, investments, savings and guilt-free spending as shares of take-home.
const SPLIT_COLOR = { fixed: 'var(--sky)', investments: 'var(--mint)', savings: 'var(--lav)', guiltFree: 'var(--amber)' };
function splitStatus(b) {
  const lo = b.low - 0.005, hi = b.high + 0.005, s = b.share;
  if (b.key === 'fixed') return s > hi ? ['above the range', 'status-warn'] : s < lo ? ['below the range, so more room for the rest', 'status-good'] : ['in range', 'status-good'];
  if (b.key === 'investments') return s >= lo ? ['on target', 'status-good'] : ['below target', 'status-warn'];
  if (b.key === 'savings') return s > hi ? ['above the range', 'status-good'] : s >= lo ? ['in range', 'status-good'] : ['below the range', 'status-warn'];
  if (s < 0) return ['nothing left for it this month', 'status-bad'];
  return s < lo ? ['below the range', 'status-warn'] : s > hi ? ['above the range', 'muted'] : ['in range', 'status-good'];
}
function planSplit(pl) {
  if (!(pl.takeHome > 0)) return '';
  const pos = pl.split.map((b) => Math.max(b.share, 0));
  const total = pos.reduce((a, b) => a + b, 0);
  const scale = total > 1 ? 1 / total : 1;
  const detail = (b) => {
    if (b.key === 'fixed') return [`Bills ${M.money0(pl.billsTotal)}`, ...(pl.goals.length ? [`${pl.goals.map((g) => esc(g.title)).join(' &amp; ')} ${M.money0(pl.goalsTotal)}`] : []), `Everyday needs ${M.money0(pl.essentialEveryday)}`].join(' · ');
    if (b.key === 'investments') return pl.invested > 0 ? `Invested so far ${M.money0(pl.invested)}${pl.investTarget > pl.invested ? ` · goal ${M.money0(pl.investTarget)}` : ''}` : pl.investTarget > 0 ? `Investing goal ${M.money0(pl.investTarget)}` : 'Nothing invested yet this month';
    if (b.key === 'savings') return pl.savingsPlanned > 0 ? `Moves to savings ${M.money0(pl.savingsPlanned)}` : pl.saved > 0 ? 'Moved to savings this month' : 'Nothing saved yet this month';
    return `Left for dining out, fun and shopping · ${M.money0(pl.guiltFreeSpent)} spent so far`;
  };
  return `<section class="card split-card"><h2>How your pay splits</h2>
    <div class="split-bar">${pl.split.map((b, i) => (pos[i] > 0.001 ? `<span style="width:${(pos[i] * scale * 100).toFixed(2)}%;background:${SPLIT_COLOR[b.key]}" data-tip="${esc(b.label)}: ${Math.round(b.share * 100)}%"></span>` : '')).join('')}</div>
    <div class="split-rows">${pl.split.map((b) => { const [st, cls] = splitStatus(b); return `<div class="split-row">
      <span class="dot" style="background:${SPLIT_COLOR[b.key]}"></span>
      <div class="grow"><div class="t">${b.label}<span class="amt">${M.money0(b.amount)} · ${Math.round(b.share * 100)}%</span></div>
        <div class="s">${detail(b)}</div>
        <div class="s"><span class="${cls}">Target ${b.target} · ${st}</span></div></div></div>`; }).join('')}</div>
    <p class="small muted" style="margin-top:12px">Targets from a popular spending plan: fixed costs 50–60% of take-home, investments about 10%, savings 5–10% and guilt-free spending 25–30%. A guide, not a rule. Money your employer takes for a 401(k) or HSA isn't in take-home, so it isn't counted here.</p>
  </section>`;
}

// ---------- weekly goals + net worth on the overview ----------
function overviewGoals(d, now) {
  const habits = (d.habitGoals || []).map((g) => ({ g, p: M.habitProgress(g, d.transactions, now) }));
  const nw = M.netWorth(d);
  const hasNet = (d.assets || []).length > 0;
  if (!habits.length && !hasNet) return '';
  const history = M.netWorthHistory(d);
  const first = history.find((h) => h.day >= M.addDays(now, -30)) || history[0];
  const change = first && !M.sameDay(first.day, now) ? nw.net - first.net : null;
  return `
    <section class="grid halves">
      <div class="card"><h2>${habits.every((h) => h.p.weekly) ? 'Weekly goals' : 'Repeating goals'} <button class="link" data-goto="goals">See all</button></h2>
        ${habits.length ? habits.map(({ g, p }) => habitHeader(g, p)).join('') : '<div class="empty-state">No weekly goals yet. Add one on your iPhone, like Mom &amp; Dad $50 a week.</div>'}
      </div>
      <div class="card"><h2>Net worth <button class="link" data-goto="networth">Details</button></h2>
        ${hasNet ? `<div class="kpi-val ${nw.net < 0 ? 'status-bad' : ''}">${M.money0(nw.net)}</div>
          <div class="kpi-sub">own <b>${M.money0(nw.assets)}</b> · owe <b>${M.money0(nw.liabilities)}</b>${change !== null && Math.abs(change) >= 1 ? ` · <b class="${change >= 0 ? 'status-good' : 'status-bad'}">${change >= 0 ? '+' : '−'}${M.money0(Math.abs(change))}</b> since ${fmtDay(first.day)}` : ''}</div>
          ${history.length >= 2 ? netWorthChart(history, 80, false) : ''}`
        : '<div class="empty-state">Add what you own on your iPhone (Home → Net worth) to see it here.</div>'}
      </div>
    </section>`;
}

function habitHeader(g, p) {
  const tint = p.met ? '' : p.done > 0 ? 'amber' : '';
  return `<div class="progress-row">
    <div class="top"><b>${svg(g.kind === 'family' ? 'family' : g.kind === 'giving' ? 'heart' : 'coin', 'inline-ic')} ${esc(g.name)}</b>
      <span class="num ${p.met ? 'status-good' : ''}">${M.money0(p.done)} of ${M.money0(p.target)}</span></div>
    <div class="bar ${tint}"><span style="width:${pct(p.done, p.target)}%"></span></div>
    <div class="small muted">${esc(p.status)}${p.streak >= 2 ? ` · <span class="streak">${svg('flame', 'inline-ic')}${p.streak} ${p.word}s in a row</span>` : ''}</div>
  </div>`;
}

// ---------- goals ----------
function viewGoals(el, d) {
  const now = new Date();
  const habits = (d.habitGoals || []).map((g) => ({ g, p: M.habitProgress(g, d.transactions, now) }));
  const groups = [['short', 'Short term', 'Within a year'], ['long', 'Long term', 'More than a year out'], ['someday', 'Someday', 'No date yet']]
    .map(([k, title, caption]) => ({ title, caption, goals: d.goals.filter((g) => M.goalHorizon(g, now) === k)
      .sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity)) }))
    .filter((x) => x.goals.length);
  const saved = d.goals.reduce((s, g) => s + g.currentAmount, 0);
  const target = d.goals.reduce((s, g) => s + g.targetAmount, 0);
  const perWeek = d.goals.reduce((s, g) => s + (M.goalPerWeek(g, now) || 0), 0);
  const week = habits[0];

  el.innerHTML = `
    <section class="grid kpis three">
      <div class="card"><h2>Saved toward goals</h2><div class="hero-num">${M.money0(saved)}</div>
        <div class="bar"><span style="width:${pct(saved, target)}%"></span></div>
        <div class="kpi-sub">of <b>${M.money0(target)}</b> across ${d.goals.length} savings goal${d.goals.length === 1 ? '' : 's'}</div></div>
      <div class="card"><h2>To stay on time</h2><div class="kpi-val">${perWeek > 0 ? `${M.money0(Math.ceil(perWeek))} a week` : '—'}</div>
        <div class="kpi-sub">${perWeek > 0 ? `about <b>${M.money0(Math.ceil((perWeek * 52) / 12))}</b> a month keeps every dated goal on schedule` : 'Add a date to a goal to get a weekly number'}</div></div>
      <div class="card"><h2>This ${week ? week.p.word : 'week'}</h2>
        ${week ? `<div class="kpi-val ${week.p.met ? 'status-good' : ''}">${M.money0(week.p.done)} <span class="muted small">of ${M.money0(week.p.target)}</span></div>
          <div class="kpi-sub">${esc(week.g.name)} · ${esc(week.p.status)}</div>` : '<div class="kpi-val muted">—</div><div class="kpi-sub">No weekly goals yet</div>'}</div>
    </section>

    <section class="card" style="margin-bottom:18px">
      <h2>Weekly goals <span class="legend" style="margin:0"><span><i class="sw" style="background:var(--mint)"></i>Hit it</span><span><i class="sw" style="background:var(--amber)"></i>Some</span><span><i class="sw" style="background:var(--line-2)"></i>None</span></span></h2>
      ${habits.length ? `<div class="habit-grid">${habits.map(({ g, p }) => habitBlock(g, p)).join('')}</div>`
        : `<div class="empty-state">Goals you keep every week, like sending Mom &amp; Dad $50, giving, or saving $25. Add one on your iPhone: Home → Weekly goals.</div>`}
    </section>

    <section class="grid ${groups.length >= 3 ? 'thirds' : groups.length === 2 ? 'halves' : ''}">
      ${groups.map((grp) => `<div class="card"><h2>${grp.title} <span class="small muted" style="text-transform:none;letter-spacing:0">${grp.caption}</span></h2>
        ${grp.goals.map((g) => savingsRow(g, now)).join('')}</div>`).join('') || '<div class="card"><div class="empty-state">No savings goals yet. Add one on your iPhone, like a vacation or an emergency fund.</div></div>'}
    </section>`;
  el.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.goto; history.replaceState(null, '', `#${state.view}`); render(); }));
}

function habitBlock(g, p) {
  const peak = Math.max(...p.history.map((h) => h.amount), p.target, 1);
  const labels = p.history.map((h) => (p.weekly ? `${h.start.getMonth() + 1}/${h.start.getDate()}` : h.start.toLocaleDateString('en-US', { month: 'short' })));
  return `<div class="habit">
    ${habitHeader(g, p)}
    ${p.history.length ? `<div class="cols short">${p.history.map((h, i) => `<div class="col" data-tip="<b>${p.weekly ? 'Week of ' : ''}${labels[i]}</b><br>${M.money(h.amount)} ${h.met ? '· hit it' : h.amount > 0 ? `· ${M.money0(p.target - h.amount)} short` : '· none'}">
        <div class="colbar ${h.met ? '' : h.amount > 0 ? 'amber' : 'none'}" style="height:${Math.max((h.amount / peak) * 100, 3)}%"></div></div>`).join('')}</div>
      <div class="col-labels">${labels.map((l) => `<span>${l}</span>`).join('')}</div>
      <p class="small muted" style="margin-top:8px">Hit it ${p.history.filter((h) => h.met).length} of the last ${p.history.length} ${p.word}s.</p>` : ''}
    ${p.matches.length ? `<div class="rows" style="margin-top:6px">${p.matches.slice(0, 3).map((t) => `<div class="row">
        <span class="ic">${svg(catIcon(t.category))}</span>
        <div class="grow"><div class="t">${esc(t.title)}</div><div class="s">${fmtDay(t.date, { weekday: 'short', month: 'short', day: 'numeric' })}${t.notes ? ` · ${esc(t.notes)}` : ''}</div></div>
        <span class="amt">${M.money(t.amount)}</span></div>`).join('')}</div>` : ''}
  </div>`;
}

function savingsRow(g, now) {
  const perWeek = M.goalPerWeek(g, now);
  const left = Math.max(g.targetAmount - g.currentAmount, 0);
  const done = left <= 0;
  return `<div class="progress-row">
    <div class="top"><b>${esc(g.name)}</b><span class="num">${M.money0(g.currentAmount)} of ${M.money0(g.targetAmount)}</span></div>
    <div class="bar"><span style="width:${pct(g.currentAmount, g.targetAmount)}%"></span></div>
    <div class="small muted">${done ? '<b class="status-good">Reached</b>' : perWeek ? `<b>${M.money0(Math.ceil(perWeek))} a week</b> gets you there by ${fmtDay(g.deadline, { month: 'short', year: 'numeric' })}` : `${M.money0(left)} to go · no date`}</div>
  </div>`;
}

// ---------- net worth ----------
const ASSET_ORDER = ['Checking & cash', 'Savings', 'Investments', 'Retirement', 'Crypto', 'Home & property', 'Vehicles', 'Other'];

function viewNetWorth(el, d) {
  const now = new Date();
  const nw = M.netWorth(d);
  const history = M.netWorthHistory(d);
  const assets = d.assets || [];
  const debts = d.debts.filter((x) => x.remainingBalance > 0.004).sort((a, b) => b.remainingBalance - a.remainingBalance);
  if (!assets.length && !debts.length) {
    el.innerHTML = `<div class="card"><div class="empty-state">
      <p style="color:var(--text);font-weight:800;font-size:18px;margin-bottom:8px">Everything you own, minus what you owe.</p>
      On your iPhone, open Home → Net worth and type in your balances: checking, savings, investments, retirement, even your car. No bank login. They show up here right away.</div></div>`;
    return;
  }
  const first = history.find((h) => h.day >= M.addDays(now, -30)) || history[0];
  const change = first && !M.sameDay(first.day, now) ? nw.net - first.net : null;
  const firstEver = history[0];
  const kinds = ASSET_ORDER.map((k) => ({ k, items: assets.filter((a) => (ASSET_ORDER.includes(a.kind) ? a.kind : 'Other') === k) }))
    .filter((x) => x.items.length)
    .map((x) => ({ ...x, total: x.items.reduce((s, a) => s + a.value, 0) }));
  const maxKind = Math.max(...kinds.map((x) => x.total), 1);
  const stale = assets.filter((a) => now - a.updatedAt > 35 * 86400000);

  el.innerHTML = `
    <section class="grid kpis">
      <div class="card"><h2>Net worth</h2><div class="hero-num ${nw.net < 0 ? 'over' : ''}">${M.money0(nw.net)}</div>
        <div class="kpi-sub">${change !== null && Math.abs(change) >= 1 ? `<b class="${change >= 0 ? 'status-good' : 'status-bad'}">${change >= 0 ? '+' : '−'}${M.money0(Math.abs(change))}</b> since ${fmtDay(first.day)}` : 'Typed in by you. No bank login.'}</div></div>
      <div class="card"><h2>You own</h2><div class="kpi-val">${M.money0(nw.assets)}</div><div class="kpi-sub">${assets.length} account${assets.length === 1 ? '' : 's'} and things</div></div>
      <div class="card"><h2>You owe</h2><div class="kpi-val ${nw.liabilities > 0 ? 'status-bad' : ''}">${M.money0(nw.liabilities)}</div><div class="kpi-sub">${debts.length} debt${debts.length === 1 ? '' : 's'} from your Debts tab</div></div>
      <div class="card"><h2>Since you started</h2>${firstEver && history.length >= 2 ? `<div class="kpi-val ${nw.net - firstEver.net >= 0 ? 'status-good' : 'status-bad'}">${nw.net - firstEver.net >= 0 ? '+' : '−'}${M.money0(Math.abs(nw.net - firstEver.net))}</div><div class="kpi-sub">since ${fmtDay(firstEver.day, { month: 'short', day: 'numeric', year: 'numeric' })}</div>` : '<div class="kpi-val muted">—</div><div class="kpi-sub">The line starts the day you add something</div>'}</div>
    </section>
    ${history.length >= 2 ? `<section class="card" style="margin-bottom:18px"><h2>Over time</h2>${netWorthChart(history, 220, true)}</section>` : ''}
    <section class="grid halves">
      <div class="card"><h2>What you own</h2>
        ${kinds.map((x) => `<div class="progress-row">
          <div class="top"><b>${esc(x.k)}</b><span class="num">${M.money0(x.total)}</span></div>
          <div class="bar"><span style="width:${(x.total / maxKind) * 100}%"></span></div>
          <div class="small muted">${x.items.map((a) => `${esc(a.name)} ${M.money0(a.value)}`).join(' · ')}</div></div>`).join('') || '<div class="empty-state">Nothing added yet</div>'}
        ${stale.length ? `<p class="note" style="margin-top:10px">${esc(stale[0].name)} hasn't been updated in a while. Update it on your iPhone so this stays true.</p>` : ''}
      </div>
      <div class="card"><h2>What you owe</h2>
        ${debts.length ? debts.map((x) => `<div class="progress-row"><div class="top"><b>${esc(x.name)}</b><span class="num status-bad">${M.money(x.remainingBalance)}</span></div>
          <div class="bar"><span style="width:${pct(x.amountPaid, x.totalAmount)}%"></span></div>
          <div class="small muted">${Math.round(pct(x.amountPaid, x.totalAmount))}% paid off${x.minimumPayment ? ` · ${M.money(x.minimumPayment)} minimum` : ''}${x.interestRate ? ` · ${x.interestRate}% APR` : ''}</div></div>`).join('') : '<div class="empty-state">No debts. Nice.</div>'}
        ${d.goals.length ? '<p class="small muted" style="margin-top:10px">Money in your savings goals sits inside your accounts, so it\'s already counted in what you own.</p>' : ''}
      </div>
    </section>`;
}

/** Net worth line. `full` adds axis labels and point tooltips. */
function netWorthChart(history, height, full) {
  const W = 800, H = height, padL = full ? 64 : 4, padR = 8, padT = 10, padB = full ? 26 : 6;
  const xs = history.map((h) => h.day.getTime());
  const ys = history.map((h) => h.net);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padY = Math.max((y1 - y0) * 0.12, 50);
  y0 -= padY; y1 += padY;
  const X = (t) => padL + ((t - x0) / Math.max(x1 - x0, 1)) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - y0) / Math.max(y1 - y0, 1)) * (H - padT - padB);
  const pts = history.map((h) => [X(h.day.getTime()), Y(h.net)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const area = `${line}L${pts[pts.length - 1][0].toFixed(1)},${H - padB}L${pts[0][0].toFixed(1)},${H - padB}Z`;
  const ticks = full ? [y0 + padY, (y0 + y1) / 2, y1 - padY] : [];
  const xTicks = full ? [0, Math.floor((history.length - 1) / 2), history.length - 1] : [];
  return `<svg class="nw-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth over time, now ${M.money0(ys[ys.length - 1])}">
    <defs><linearGradient id="nwfill${H}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5EE6A8" stop-opacity=".28"/><stop offset="1" stop-color="#5EE6A8" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" class="grid-line"/><text x="${padL - 8}" y="${Y(v) + 4}" text-anchor="end" class="axis">${compact(Math.round(v))}</text>`).join('')}
    <path d="${area}" fill="url(#nwfill${H})"/>
    <path d="${line}" fill="none" stroke="#5EE6A8" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
    ${xTicks.map((i) => `<text x="${pts[i][0]}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === history.length - 1 ? 'end' : 'middle'}" class="axis">${fmtDay(history[i].day)}</text>`).join('')}
    ${full ? pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="9" fill="transparent" data-tip="<b>${fmtDay(history[i].day, { month: 'short', day: 'numeric', year: 'numeric' })}</b><br>Net worth ${M.money0(history[i].net)}<br>own ${M.money0(history[i].assets)} · owe ${M.money0(history[i].liabilities)}"/>`).join('') : ''}
  </svg>`;
}

window.addEventListener('hashchange', () => { state.view = location.hash.slice(1) || 'overview'; if (state.data) render(); });
boot();
