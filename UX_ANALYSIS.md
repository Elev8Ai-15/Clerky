# Clerky — UX Efficiency & User Flow Analysis
**Date:** 2026-03-01
**Branch:** claude/analyze-code-structure-Gmp6h

---

## Executive Summary

The app has strong bones — a well-organized sidebar, consistent card layouts, responsive mobile nav, dark-mode AI chat — but several **key user flows have a missing or disconnected step** that creates friction. The most impactful issue is a broken "New Case" action at the highest-traffic point (the dashboard). Several secondary flows require the user to navigate away and back to complete what should be one task.

---

## 1. The Primary "Missing Step" — New Case from Dashboard

This is the single biggest user flow problem.

### Current Flow
```
Dashboard
  └── "New Case" button (line 828)
        └── onclick="navigate('cases')"   ← Takes user to the Cases LIST
              └── User sees list + ANOTHER "New Case" button
                    └── Clicks "New Case" again
                          └── Modal opens
```

### What the User Expects
```
Dashboard
  └── "New Case" button
        └── New Case modal opens immediately
```

**Root cause:** `src/index.tsx:828` — The dashboard button calls `navigate('cases')` instead of `showNewCaseModal()`.

**Impact:** Every attorney wanting to open a new matter takes an extra, confusing click through the list page. The word "New" implies creation, not navigation.

### Fix
Change the dashboard button's onclick from `navigate('cases')` to `showNewCaseModal()`.

---

## 2. New Case Flow — No Client = Dead End

Even after fixing Issue #1, users hit a second wall immediately.

### Current Flow
```
New Case Modal opens
  └── User fills in Title, Type, Priority, Description
        └── "Client *" dropdown → required field
              └── If no clients exist:
                    └── "Client is required. Add a client first."
                          └── User must CLOSE the modal
                                └── Navigate to Clients
                                      └── Create a client
                                            └── Navigate back to Cases
                                                  └── Click "New Case" again
                                                        └── Fill all fields again
```

All form state is lost when the modal closes. New users on first launch have zero clients and will hit this wall on their very first action.

### Fix
Add a "+ New Client" quick-create option inside the case modal dropdown. This is a common pattern (a small inline form or a "Create and select" option in the dropdown). Alternatively, pre-populate with a placeholder "New/Unknown Client" that the user can fill in later.

---

## 3. Splash Screen — Backwards Sequence

### Current Flow (src/index.tsx:729-748)
```javascript
async function init() {
  await axios.get(API + '/init-db');  // 1. Initialize DB
  navigate('dashboard');              // 2. Load dashboard (content visible behind splash)
  // ... THEN show "Enter Platform" button
}
```

The dashboard is **fully loaded** before the splash shows the "Enter Platform" button. By the time the user sees the ready state, they've been waiting for a page that's already done loading behind the overlay.

**Two problems:**
1. The splash doesn't auto-dismiss — the user must manually click "Enter Platform" even though the app is ready. It's an unnecessary gate.
2. The `splash` variable is declared (line 730) but **never used** in `init()` — the splash element is controlled only by `dismissSplash()`, which is called by the button's onclick. The variable is dead code.

### Expected Flow
```
Splash screen visible
    → DB init completes
        → Dashboard loads
            → Splash auto-fades after 800ms (no user action needed)
```
OR show a proper loading animation and only auto-dismiss when ready.

---

## 4. Notification Bell — Updates Badge But Shows Nothing

The bell icon in the top-right header shows an unread count badge. Clicking it calls `loadNotifications()`.

### What loadNotifications() Actually Does (line 3811)
```javascript
async function loadNotifications() {
  const { data } = await axios.get(API + '/notifications');
  const badge = document.getElementById('notifBadge');
  if (data.unread_count > 0) { badge.textContent = data.unread_count; badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); }
}
```

**It only updates the badge number. The user never sees the notification content.** Clicking the bell does nothing visible. There is no notification dropdown, panel, or page. The user has no way to read notifications — the data exists in the API and DB but is unreachable from the UI.

### Fix
Either:
- Open a slide-in notification panel/dropdown listing recent notifications with "Mark read" actions
- Navigate to a Notifications page
- At minimum: mark all as read when the bell is clicked

---

## 5. Filter Buttons — Non-Functional (Cases Page)

The Cases page has 6 filter buttons: All, Open, In Progress, Pending, Discovery, Closed. None of them work.

### Root Cause (line 1073)
```javascript
async function filterCases(status) {
  const url = status ? API + '/cases?status=' + status : API + '/cases';
  const { data } = await axios.get(url);  // ← filtered data fetched
  loadCases();  // ← calls loadCases() which fetches ALL cases (filter discarded)
}
```

The filtered API response is fetched and then immediately thrown away. `loadCases()` makes its own fresh request with no filter.

**User experience:** The filter buttons appear to do nothing. A user trying to see only "Open" cases will get the full unfiltered list every time.

### Fix
`loadCases()` should accept an optional `status` parameter and pass it to the API call. `filterCases(status)` should call `loadCases(status)` instead.

---

## 6. Global Search — Goes Nowhere

The search bar in the top header (`onkeyup="handleGlobalSearch(event)"`) is the most prominent UI element. Pressing Enter:

```javascript
function handleGlobalSearch(e) {
  if (e.key === 'Enter') {
    const q = e.target.value;
    if (q.length > 0) {
      navigate('cases');  // ← navigates to Cases page, query is lost
    }
  }
}
```

The search term is discarded. The user lands on the unfiltered Cases page. **The search bar is purely decorative** and has never worked.

### Fix
Pass the query as a parameter to `loadCases({ search: q })` — the backend already supports `?q=` search on cases, clients, and documents.

---

## 7. Dashboard Stat Cards — Not Clickable

The 4 stat cards on the dashboard (Active Cases, Active Clients, Pending Tasks, Documents) display counts but are not interactive. Users naturally tap/click on summary numbers expecting to be taken to the filtered list.

| Card | Expected Navigation |
|---|---|
| "12 Active Cases" | → Cases page, filtered `status=open` |
| "8 Active Clients" | → Clients page |
| "5 Pending Tasks" | → Tasks page, filtered `status=pending` |
| "44 Documents" | → Documents page |

### Fix
Wrap each stat card `<div>` in an `onclick` handler calling the appropriate `navigate()` or `loadX({ filter })` function.

---

## 8. Case Detail — AI Buttons Use `alert()`

The Case detail page has 3 AI action buttons:
```
AI Research  |  AI Draft  |  Compliance Check
```

They call `runAIAgent(agentType, caseId)` which posts to `/api/ai/run` and then:
```javascript
alert('AI Agent ' + agentType + ' completed!\nTokens: ' + data.tokens_used + '\nStatus: ' + data.status);
```

**The result is shown in a raw browser `alert()` dialog.** The actual AI-generated content (stored in `result.content`) is truncated to 500 chars in the response and never shown to the user in a readable format.

### Fix
Route these buttons to the AI Chat with the case pre-selected and the appropriate quick-chip pre-injected, OR show results in an inline panel below the buttons. The AI Chat page already has the infrastructure for this.

---

## 9. Case Notes — Returned by API, Never Rendered

The backend's `GET /api/cases/:id` returns `notes` (an array of case notes). The `viewCase()` function receives `data.notes` but never renders it.

The case detail view has panels for Documents, Tasks, and Time Entries — but there is no Case Notes section despite the data being available.

**User impact:** Any notes added via the API are completely invisible in the UI. There's no way to view or add case notes from the case detail screen.

---

## 10. No "View What You Just Created" Flow

After creating a case or client, the modal closes and the list page reloads. There's no navigation to the newly created record.

| Action | Current Result | Better UX |
|---|---|---|
| Create Case | Closes modal → reloads Cases list | Navigate to `viewCase(newId)` |
| Create Client | Closes modal → reloads Clients list | Navigate to `viewClient(newId)` |
| Create Invoice | Closes modal → reloads Billing | Navigate to invoice detail |
| Create Task | Closes modal → reloads Tasks | Highlight new task in list |

The **Intake flow is the exception** — it correctly shows a "View Case" button after completion. All other create flows should follow this pattern.

---

## 11. No "Log Time" Action from Case Detail

The Case detail page shows the time entries table for the case. But there's no "Log Time" button — the user has to navigate to Billing, open a separate "Log Time" modal, and manually select the case again.

The most natural place to log time is on the case you're working in.

### Fix
Add a "+ Log Time" button in the Time Entries section of `viewCase()` that opens the time-entry modal with the `case_id` pre-filled.

---

## 12. Calendar — List View Only, No Calendar Grid

The "Calendar" page shows a card grid of events sorted chronologically. There is no actual calendar (month/week grid view). Users familiar with legal practice management tools expect to see a month-view calendar where they can see the density of hearings, deadlines, and meetings at a glance.

The current flat-list layout makes it impossible to see time relationships between events — e.g., "my trial starts 2 days before a competing deadline."

---

## 13. Invoice Table — No Click-Through / No Time Entry List

**Two gaps in the Billing page:**

1. **Invoice rows are not clickable.** Every other list in the app (cases, clients, documents, tasks) has clickable rows that drill into a detail view. Billing invoice rows have no `onclick`, no chevron icon, and no action. The user can see the invoice summary but cannot drill into line items or payment history.

2. **No time entry list on the Billing page.** The app has full time tracking infrastructure (`/api/billing/time-entries`) and a "Log Time" modal, but there's no section on the Billing page showing existing time entries. The user has no way to review logged time from the Billing module.

---

## 14. `runAIAgent` / Case Detail AI Buttons Hit Hardcoded `jurisdiction: 'kansas'`

In `/api/ai/run` (line 868):
```typescript
jurisdiction: 'kansas',   // ← hardcoded, ignores case's actual jurisdiction
```

Even if a case is in Missouri, the AI agents are always run with Kansas jurisdiction when triggered from the Case detail AI buttons. This could produce incorrect legal analysis.

---

## 15. Intake Page — No History of Past Intakes

The `loadIntake()` page shows only the intake submission form. There's no list of previously submitted intakes, no way to review past intake assessments, and no link to the cases that were created from previous intakes.

For a busy practice, an attorney needs to see a history of intake submissions, especially if the intake assistant is the primary entry point for new clients.

---

## 16. Back Navigation Loses Filter/Scroll State

When a user:
1. Filters cases to "Open" only
2. Clicks a case to view its detail
3. Clicks the ← Back button

They're returned to the **unfiltered Cases list** (starting from the top). The filter, scroll position, and any context from step 1 are gone. This forces the user to re-apply filters every time they drill in and out.

The same issue applies to Documents, Clients, and Tasks.

---

## Performance Observations

### 1. Each Page Navigation = Full API Round-Trip
Every `navigate()` call re-fetches all data from the API with no caching. Switching between Cases and Calendar and back to Cases makes 3 API calls. There's no local cache or state management layer.

**Impact:** Noticeable delay on every navigation even when data hasn't changed.

### 2. `init()` Blocks on `/api/init-db` Before Loading Dashboard
On every page load, the app serially awaits `GET /api/init-db` before calling `navigate('dashboard')`. This is a table-creation endpoint that should be near-instant after first run, but it still adds a serial hop before the user sees anything.

### 3. AI Chat Loads Cases List on Every Entry
`loadAIChat()` always makes `GET /api/cases` to populate the matter dropdown, even if the cases haven't changed. This could be cached after the first load.

### 4. `showNewCaseModal()` Makes Parallel Requests But Then Waits
```javascript
Promise.all([axios.get(API + '/clients'), axios.get(API + '/users')]).then(([cRes, uRes]) => {
  // Populate dropdowns AFTER modal is already open
})
```
The modal renders immediately with `<option>Loading clients...</option>`. If the API is slow, the user sees a broken dropdown. The modal should show a loading state or defer opening until data is ready.

### 5. Dashboard Makes 7 Separate DB Queries Serially
The `/api/dashboard` endpoint runs all queries within one handler, but uses sequential `await` calls rather than `Promise.all`. Each query adds latency to the initial page load.

---

## Summary Table

| Issue | Severity | Pages Affected |
|---|---|---|
| Dashboard "New Case" goes to list, not modal | High | Dashboard |
| New Case blocked if no clients exist (no inline create) | High | Cases modal |
| Splash auto-dismiss broken, dead variable | Medium | Startup |
| Bell icon shows badge but no notification content | High | Global header |
| Filter buttons non-functional | High | Cases |
| Global search bar non-functional | High | Global header |
| Dashboard stat cards not clickable | Medium | Dashboard |
| Case detail AI buttons use `alert()` | Medium | Case detail |
| Case notes never rendered in UI | Medium | Case detail |
| No "view created record" after create | Medium | Cases, Clients, Billing |
| No "Log Time" button in case detail | Medium | Case detail |
| Calendar is a flat list, not a calendar | Low-Medium | Calendar |
| Invoice rows not clickable, no time entry list | Medium | Billing |
| AI buttons hardcode `jurisdiction: 'kansas'` | Low | Case detail |
| Intake page shows no history | Low | Intake |
| Back navigation loses filter context | Low-Medium | All list views |
| No page navigation caching | Low | Global |

---

## Priority Fixes (Ordered by Impact / Effort)

**Quick wins (< 30 min each):**
1. Change dashboard "New Case" button to `showNewCaseModal()`
2. Make dashboard stat cards clickable with `onclick="navigate(...)"`
3. Fix `filterCases()` to pass status to `loadCases()`
4. Fix `handleGlobalSearch()` to pass query to search API
5. Add `onclick="viewCase()"` to newly created case in `createCase()`
6. Auto-dismiss splash after dashboard loads

**Medium effort (1-4 hours each):**
7. Replace `alert()` in `runAIAgent()` with AI Chat routing or inline panel
8. Add notification dropdown/panel to the bell icon
9. Add Case Notes section to `viewCase()`
10. Add "+ Log Time" button to case detail time entries section
11. Fix `jurisdiction` hardcode in `/api/ai/run`

**Larger effort (1-2 days each):**
12. Add "+ New Client" inline creation in the case creation modal
13. Invoice detail drill-down view
14. Calendar month grid view
15. Client-side data caching layer for frequently-accessed lists
