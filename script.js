'use strict';

/* ================= Constants ================= */
const STORAGE_KEY = 'cpt_applications_v1';
const SEEDED_KEY = 'cpt_demo_seeded_v1';
const STATUSES = ['Applied', 'Shortlisted', 'Interview Scheduled', 'Interviewed', 'Offer Received', 'Rejected'];
// Statuses that automatically mean "reached interview stage"
const INTERVIEW_STATUSES = ['Interview Scheduled', 'Interviewed', 'Offer Received'];
const MIN_APPLICATIONS_FOR_RATE_INSIGHT = 3;
const STATUS_COLORS = ['#6366f1', '#06b6d4', '#f59e0b', '#3b82f6', '#22c55e', '#ef4444'];

let applications = [];
let editingId = null;
let statusChart = null;
let roleChart = null;

const $ = (id) => document.getElementById(id);

/* ================= Small helpers ================= */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
function normalizeText(text) { return text.trim().replace(/\s+/g, ' '); }
function roleKey(role) { return normalizeText(role).toLowerCase(); } // "frontend intern" == "Frontend Intern"
function statusClass(status) { return 'status-' + status.toLowerCase().replace(/\s+/g, '-'); }
function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayString() {
  const t = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number); // avoids timezone shifts
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function percent(part, whole) { return whole === 0 ? 0 : Math.round((part / whole) * 100); }
function plural(n, one, many) { return n === 1 ? one : many; }

/* ================= localStorage ================= */
function loadApplications() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return []; // corrupted or blocked storage: start empty instead of crashing
  }
}

function saveApplications() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
  } catch (err) {
    $('formMsg').textContent = 'Could not save to this browser. Changes will be lost on refresh.';
  }
}

// Adds 12 fictional demo records only on the very first launch
function seedDemoDataOnce() {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return;
    localStorage.setItem(SEEDED_KEY, 'yes');
  } catch (err) { return; }

  const demo = (company, role, date, status, reachedAfterReject) => ({
    id: makeId(), company, role, date, status, demo: true,
    reachedInterview: INTERVIEW_STATUSES.includes(status) || Boolean(reachedAfterReject)
  });
  applications = [
    demo('Infosys', 'Frontend Intern', '2026-08-04', 'Rejected'),
    demo('Razorpay', 'Frontend Intern', '2026-08-10', 'Interviewed'),
    demo('Zoho', 'Frontend Intern', '2026-08-14', 'Offer Received'),
    demo('Swiggy', 'Frontend Intern', '2026-08-21', 'Rejected', true),
    demo('Flipkart', 'Software Engineer Intern', '2026-08-25', 'Applied'),
    demo('Microsoft', 'Software Engineer Intern', '2026-09-01', 'Rejected'),
    demo('Atlassian', 'Software Engineer Intern', '2026-09-05', 'Interview Scheduled'),
    demo('Adobe', 'Software Engineer Intern', '2026-09-12', 'Shortlisted'),
    demo('Freshworks', 'Web Developer', '2026-09-18', 'Interviewed'),
    demo('Postman', 'Web Developer', '2026-09-22', 'Applied'),
    demo('Myntra', 'UI/UX Intern', '2026-10-02', 'Rejected'),
    demo('Paytm', 'UI/UX Intern', '2026-10-09', 'Shortlisted')
  ];
  saveApplications();
}

/* ================= Filtering ================= */
// Returns only the applications matching search text, status and role filters
function getFilteredApplications() {
  const query = $('searchInput').value.trim().toLowerCase();
  const status = $('statusFilter').value;
  const role = $('roleFilter').value;
  return applications.filter((app) => {
    const matchesSearch = !query || app.company.toLowerCase().includes(query) || app.role.toLowerCase().includes(query);
    const matchesStatus = !status || app.status === status;
    const matchesRole = !role || roleKey(app.role) === role;
    return matchesSearch && matchesStatus && matchesRole;
  });
}
function filtersAreActive() {
  return Boolean($('searchInput').value.trim() || $('statusFilter').value || $('roleFilter').value);
}

/* ================= Metric calculations ================= */
function calculateMetrics(list) {
  const total = list.length;
  const interviews = list.filter((a) => a.reachedInterview).length;
  const offers = list.filter((a) => a.status === 'Offer Received').length;
  // Interview rate = (reached interview / total) x 100, and 0% when there is no data
  const rate = percent(interviews, total);
  return { total, interviews, offers, rate };
}

// Groups applications by role: { label, total, interviews }
function calculateRoleStats(list) {
  const map = new Map();
  list.forEach((app) => {
    const key = roleKey(app.role);
    if (!map.has(key)) map.set(key, { label: normalizeText(app.role), total: 0, interviews: 0 });
    const entry = map.get(key);
    entry.total += 1;
    if (app.reachedInterview) entry.interviews += 1;
  });
  return [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function calculateStatusCounts(list) {
  return STATUSES.map((s) => list.filter((a) => a.status === s).length);
}

/* ================= Insights ================= */
function buildInsights(list) {
  if (list.length === 0) return ['Add or show some applications to see insights.'];
  const insights = [];
  const { total, interviews, rate } = calculateMetrics(list);
  const stats = calculateRoleStats(list);

  insights.push(`Overall, ${interviews} of ${total} ${plural(total, 'application', 'applications')} reached the interview stage (${rate}%).`);

  // Only roles with enough applications are compared, so 1 of 1 does not look like 100%
  const eligible = stats.filter((s) => s.total >= MIN_APPLICATIONS_FOR_RATE_INSIGHT);
  if (eligible.length === 0) {
    insights.push(`Not enough data for a "highest interview rate" insight yet: a role needs at least ${MIN_APPLICATIONS_FOR_RATE_INSIGHT} applications.`);
  } else {
    const best = Math.max(...eligible.map((s) => s.interviews / s.total));
    const top = eligible.filter((s) => s.interviews / s.total === best);
    const describe = (s) => `${s.interviews} ${plural(s.interviews, 'time', 'times')} out of ${s.total} (${percent(s.interviews, s.total)}%)`;
    if (best === 0) {
      insights.push('None of the roles with enough applications has reached the interview stage yet.');
    } else if (top.length === 1) {
      insights.push(`${top[0].label} applications reached the interview stage ${describe(top[0])}. This is your highest interview rate.`);
    } else {
      insights.push(`Tied for the highest interview rate: ${top.map((s) => `${s.label} (${describe(s)})`).join('; ')}.`);
    }
  }

  const most = stats[0];
  if (stats.length > 1 && most.total > stats[1].total) {
    insights.push(`You have applied most for ${most.label}: ${most.total} applications.`);
  }
  return insights;
}

/* ================= Rendering ================= */
function renderAll() {
  refreshRoleControls();
  const list = getFilteredApplications();
  renderFilterNotice(list);
  renderMetrics(list);
  renderCharts(list);
  $('insightList').innerHTML = buildInsights(list).map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  renderList(list);
  $('demoBanner').hidden = !applications.some((a) => a.demo);
}

// Rebuilds the role dropdown and the role suggestions from all saved records
function refreshRoleControls() {
  const select = $('roleFilter');
  const previous = select.value;
  const roles = calculateRoleStats(applications).sort((a, b) => a.label.localeCompare(b.label));
  select.innerHTML = '<option value="">All roles</option>' +
    roles.map((r) => `<option value="${escapeHtml(roleKey(r.label))}">${escapeHtml(r.label)}</option>`).join('');
  select.value = roles.some((r) => roleKey(r.label) === previous) ? previous : '';
  $('roleOptions').innerHTML = roles.map((r) => `<option value="${escapeHtml(r.label)}"></option>`).join('');
}

function renderFilterNotice(list) {
  const notice = $('filterNotice');
  notice.hidden = !filtersAreActive();
  $('dashTitle').textContent = filtersAreActive() ? 'Dashboard (filtered view)' : 'Dashboard';
  notice.textContent = `Filters active: showing ${list.length} of ${applications.length} applications. Cards, charts and insights reflect only these records.`;
}

function renderMetrics(list) {
  const m = calculateMetrics(list);
  $('mTotal').textContent = m.total;
  $('mInterviews').textContent = m.interviews;
  $('mOffers').textContent = m.offers;
  $('mRate').textContent = m.rate + '%';
}

function renderCharts(list) {
  const hasData = list.length > 0;
  $('statusBox').classList.toggle('is-empty', !hasData);
  $('roleBox').classList.toggle('is-empty', !hasData);
  if (typeof Chart === 'undefined') { $('chartNotice').hidden = false; return; }

  const roleStats = calculateRoleStats(list);
  const statusData = calculateStatusCounts(list);

  if (!statusChart) {
    const colors = getChartColors();
    Chart.defaults.color = colors.text;
    Chart.defaults.borderColor = colors.grid;
    statusChart = new Chart($('statusChart'), {
      type: 'doughnut',
      data: { labels: STATUSES, datasets: [{ data: statusData, backgroundColor: STATUS_COLORS, borderColor: colors.surface }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
    roleChart = new Chart($('roleChart'), {
      type: 'bar',
      data: { labels: [], datasets: [
        { label: 'Applications', data: [], backgroundColor: colors.barApplications },
        { label: 'Interviews reached', data: [], backgroundColor: colors.barInterviews }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }
  statusChart.data.datasets[0].data = statusData;
  statusChart.update();
  roleChart.data.labels = roleStats.map((r) => r.label);
  roleChart.data.datasets[0].data = roleStats.map((r) => r.total);
  roleChart.data.datasets[1].data = roleStats.map((r) => r.interviews);
  roleChart.update();
}

function renderList(list) {
  const empty = $('emptyState');
  const table = $('appTable');
  table.hidden = list.length === 0;
  empty.hidden = list.length > 0;

  if (applications.length === 0) {
    empty.innerHTML = '<p>No applications yet. Add your first one using the form above.</p>';
  } else if (list.length === 0) {
    empty.innerHTML = '<p>No applications match your search or filters.</p><button type="button" class="btn btn-secondary" id="emptyClearBtn">Clear filters</button>';
  }

  const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date)); // newest first
  $('appBody').innerHTML = sorted.map((a) => `
    <tr>
      <td data-label="Company"><strong>${escapeHtml(a.company)}</strong>${a.demo ? ' <span class="demo-tag">Demo</span>' : ''}</td>
      <td data-label="Role">${escapeHtml(a.role)}</td>
      <td data-label="Applied on">${formatDate(a.date)}</td>
      <td data-label="Status"><span class="status ${statusClass(a.status)}">${a.status}</span></td>
      <td data-label="Interview stage">${a.reachedInterview ? 'Reached' : 'Not yet'}</td>
      <td class="actions">
        <button type="button" class="btn btn-secondary btn-small" data-action="edit" data-id="${a.id}" aria-label="Edit ${escapeHtml(a.company)}">Edit</button>
        <button type="button" class="btn btn-danger btn-small" data-action="delete" data-id="${a.id}" aria-label="Delete ${escapeHtml(a.company)}">Delete</button>
      </td>
    </tr>`).join('');
}

/* ================= Form: validation, add, edit, delete ================= */
function setError(fieldId, message) {
  $(fieldId + 'Err').textContent = message;
  $(fieldId).classList.toggle('invalid', Boolean(message));
  $(fieldId).setAttribute('aria-invalid', message ? 'true' : 'false');
}

// Every field is required; returns the cleaned values or null if something is wrong
function validateForm() {
  const values = {
    company: normalizeText($('company').value),
    role: normalizeText($('role').value),
    date: $('date').value,
    status: $('status').value
  };
  const messages = {
    company: values.company ? '' : 'Please enter the company name.',
    role: values.role ? '' : 'Please enter the job role.',
    date: values.date ? '' : 'Please choose the application date.',
    status: values.status ? '' : 'Please select a status.'
  };
  Object.keys(messages).forEach((f) => setError(f, messages[f]));
  const firstBad = Object.keys(messages).find((f) => messages[f]);
  if (firstBad) { $(firstBad).focus(); return null; }
  return values;
}

function handleSubmit(event) {
  event.preventDefault();
  const values = validateForm();
  if (!values) { $('formMsg').textContent = ''; return; }
  // New records are always auto-marked for interview-type statuses; manual correction is for edits
  const reached = editingId
    ? $('reached').checked
    : $('reached').checked || INTERVIEW_STATUSES.includes(values.status);

  if (editingId) {
    const app = applications.find((a) => a.id === editingId);
    Object.assign(app, values, { reachedInterview: reached, demo: false }); // edited demo records become your own
    $('formMsg').textContent = 'Application updated.';
  } else {
    applications.push({ id: makeId(), ...values, reachedInterview: reached, demo: false });
    $('formMsg').textContent = 'Application added.';
  }
  saveApplications();
  const message = $('formMsg').textContent;
  resetForm();
  $('formMsg').textContent = message;
  renderAll();
}

function resetForm() {
  editingId = null;
  $('appForm').reset();
  $('date').value = todayString();
  ['company', 'role', 'date', 'status'].forEach((f) => setError(f, ''));
  $('formTitle').textContent = 'Add application';
  $('saveBtn').textContent = 'Add application';
  $('cancelEditBtn').hidden = true;
  $('formMsg').textContent = '';
}

function startEdit(id) {
  const app = applications.find((a) => a.id === id);
  if (!app) return;
  editingId = id;
  $('company').value = app.company;
  $('role').value = app.role;
  $('date').value = app.date;
  $('status').value = app.status;
  $('reached').checked = app.reachedInterview;
  ['company', 'role', 'date', 'status'].forEach((f) => setError(f, ''));
  $('formTitle').textContent = 'Edit application';
  $('saveBtn').textContent = 'Save changes';
  $('cancelEditBtn').hidden = false;
  $('formMsg').textContent = '';
  $('appForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('company').focus();
}

function deleteApplication(id) {
  const app = applications.find((a) => a.id === id);
  if (!app || !confirm(`Delete the ${app.company} application?`)) return;
  applications = applications.filter((a) => a.id !== id);
  if (editingId === id) resetForm();
  saveApplications();
  renderAll();
}

// Keeps user-added (and edited) records, removes only untouched demo records
function clearDemoData() {
  if (!confirm('Remove all demo applications? Your own records will be kept.')) return;
  applications = applications.filter((a) => !a.demo);
  saveApplications();
  renderAll();
}

function clearFilters() {
  $('searchInput').value = '';
  $('statusFilter').value = '';
  $('roleFilter').value = '';
  renderAll();
}

/* ================= Theme (light / dark) ================= */
const THEME_KEY = 'cpt_theme';

function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function updateThemeButton() {
  const isDark = getTheme() === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  $('themeToggle').textContent = isDark ? '☀️' : '🌙'; // the icon shows the mode you will switch to
  $('themeToggle').setAttribute('aria-label', label); // emoji alone is not readable by screen readers
  $('themeToggle').title = label;
}

// Colours Chart.js needs, because charts are drawn on a canvas and cannot use CSS variables
function getChartColors() {
  const dark = getTheme() === 'dark';
  return {
    text: dark ? '#cbd5e1' : '#475569',
    grid: dark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(0, 0, 0, 0.1)',
    surface: dark ? '#131c2e' : '#ffffff',
    barApplications: dark ? '#60a5fa' : '#1d4ed8',
    barInterviews: dark ? '#fbbf24' : '#f59e0b'
  };
}

function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* preference just won't persist */ }
  updateThemeButton();
  // Charts take their colours when created, so rebuild them for the new theme
  if (statusChart) { statusChart.destroy(); statusChart = null; }
  if (roleChart) { roleChart.destroy(); roleChart = null; }
  renderCharts(getFilteredApplications());
}

/* ================= Setup ================= */
function init() {
  updateThemeButton();
  $('themeToggle').addEventListener('click', toggleTheme);

  $('status').innerHTML = '<option value="">Select status</option>' + STATUSES.map((s) => `<option>${s}</option>`).join('');
  $('statusFilter').innerHTML = '<option value="">All statuses</option>' + STATUSES.map((s) => `<option>${s}</option>`).join('');

  applications = loadApplications();
  if (applications.length === 0) seedDemoDataOnce();

  // Choosing an interview-type status ticks the box; other statuses never untick it
  $('status').addEventListener('change', () => {
    if (INTERVIEW_STATUSES.includes($('status').value)) $('reached').checked = true;
  });

  $('appForm').addEventListener('submit', handleSubmit);
  $('cancelEditBtn').addEventListener('click', resetForm);
  $('clearDemoBtn').addEventListener('click', clearDemoData);
  $('clearFiltersBtn').addEventListener('click', clearFilters);
  ['searchInput', 'statusFilter', 'roleFilter'].forEach((id) => {
    $(id).addEventListener(id === 'searchInput' ? 'input' : 'change', renderAll);
  });

  // One listener handles every Edit / Delete button (and the empty-state button)
  document.addEventListener('click', (event) => {
    if (event.target.id === 'emptyClearBtn') return clearFilters();
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit') startEdit(btn.dataset.id);
    if (btn.dataset.action === 'delete') deleteApplication(btn.dataset.id);
  });

  resetForm();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
