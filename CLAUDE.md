# CLAUDE.md — NNEL Finance-Ready Pipeline Tracker

This file tells you (Claude Code) how to build and work on this project. Read it at the
start of every session, along with `NNEL_Pipeline_Tracker_Build_Spec.md` in this folder.

---

## What this project is

A web app for running NNEL clean-energy projects through the six-stage Finance-Ready
Pipeline (FRP) procedure, with role-enforced gate authorizations and an immutable audit
trail. It must be trustworthy enough for a Board and external lenders to rely on. The
full requirements — roles, permission matrix, gate-routing logic, screen inventory — are
in `NNEL_Pipeline_Tracker_Build_Spec.md`. **That spec is the source of truth. Follow it.**

The project owner is comfortable with frontend but is NOT a backend developer. When you
write backend code, briefly explain in plain language what each part does and why. Do not
assume backend knowledge. Flag anything security-sensitive clearly so it can be reviewed.

---

## Tech stack (do not substitute without asking)

- **Backend:** Node.js using the built-in `http` module. No web framework (no Express).
- **Database:** MariaDB (MySQL-compatible), accessed via the `mysql2` driver only.
- **Frontend:** Plain HTML, CSS, and JavaScript. No React, no build step, no bundler.
- **One deployable app:** the Node backend serves the built frontend as static files AND
  exposes the JSON API, on a single port. This is required so it deploys cleanly to cPanel.

Keep dependencies to the bare minimum. The only acceptable dependencies are: `mysql2`
(database), a vetted password hasher (`bcrypt`), and a vetted session/token library for
auth. Do not add anything else without explaining why and asking first.

---

## Backend rules (owner is trusting you on these — enforce them strictly)

These are non-negotiable. They are what make this a governance tool rather than a demo.

1. **Enforce ALL permissions on the server.** Never trust the browser. Every request that
   changes data must re-check, server-side, that the logged-in user's role is allowed to
   perform that action on that project and stage. Client-side checks are for UI convenience
   only and must never be the only gate.

2. **Parameterised SQL only — always.** Every value supplied by a user goes into `?`
   placeholders passed to `mysql2`'s prepared statements. Never build a SQL string by
   concatenating or interpolating user input. This is the rule that prevents SQL injection.

3. **The audit log is append-only.** Every state-changing action (edits, submissions, gate
   decisions, re-opens) writes a row to an `audit_log` table recording who, what, when
   (server UTC time), and on which project/stage. The app's database user must have only
   INSERT and SELECT on that table — never UPDATE or DELETE. Set this up at the DB-grant
   level, not just in code.

4. **Gate decisions are append-only and locked on signing.** A recorded GO / Conditional /
   NO-GO decision can never be edited or deleted. Changing course requires a logged
   stage re-open by an equal-or-higher authority, recorded as a new event.

5. **Segregation of duties.** The person who submits a stage for review can never be the
   person who approves that same gate. Enforce this server-side.

6. **Submission lock.** Once a stage is submitted for gate review, its working data freezes.
   Any edit after submission invalidates the pending approval and forces re-submission, so
   approvers only ever sign exactly what they reviewed.

7. **Wrap related writes in a transaction.** A gate decision and its audit-log entry must
   succeed or fail together. Never leave half-written state.

8. **Money as DECIMAL, time as UTC DATETIME.** CAPEX and any monetary value use DECIMAL
   (never FLOAT — rounding drift must not affect the $50M gate-routing threshold). Store
   all timestamps in UTC.

9. **Secrets live in `.env`, never in code, never committed.** Database password, auth
   keys, etc. Add `.env` to `.gitignore`.

When in doubt on a backend decision, choose the safer/more auditable option and explain
the choice. Err toward correctness over cleverness.

---

## Frontend rules (owner's spec — follow exactly)

- **Clean, uncluttered UI.** Mostly white background. Generous spacing. Show only what
  matters on each screen — follow the progressive-disclosure approach in the build spec
  (current stage by default, the rest collapsed; role drives the landing screen). Avoid
  cramming everything on one screen.

- **Keep NNEL's green theme** from the original HTML dashboard as the accent colour
  (buttons, active states, highlights, the pipeline strip) — but on a predominantly white
  layout, used as accents rather than filling large areas.

- **Font: Google Font "Urbanist"** for all text. Put these in the `<head>` of every page:

  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Urbanist:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
  ```

  Set `font-family: 'Urbanist', sans-serif;` as the base. Use the weight range freely for
  hierarchy (lighter for body, heavier for headings/labels).

- Use the FRP stage/gate language from the spec in the UI (Stage 0–5, gate names,
  authorities) so the tool matches the procedure staff already know.

---

## How we work together

- **Build in the order in the spec, one step at a time.** Do not jump ahead or build
  multiple steps at once. Finish, explain, and let the owner review and test a step before
  starting the next.
- After each step, tell the owner exactly how to run and test it (commands to run, what to
  check in HeidiSQL, what "working" looks like).
- Keep functions small and readable. Comment the security-critical parts clearly.
- Do not invent requirements. If the spec doesn't cover something, ask.

## Project structure (target)

```
nnel-pipeline-tracker/
├── server/        # Node http backend: routes, permission middleware, db, services
├── client/        # plain HTML/CSS/JS frontend
├── migrations/    # database schema (CREATE TABLE statements, versioned)
├── .env           # secrets — never committed
├── .gitignore
└── CLAUDE.md      # this file
```

---

## Features added after initial build

### User Management (admin only)
Built as `client/users.html` + `client/js/users.js` + `server/routes/users.js`.

Endpoints needed:
- GET    /api/users              — list all users (admin only)
- POST   /api/users              — create user (admin only)
- PATCH  /api/users/:id          — update name, email, system_role (admin only)
- PATCH  /api/users/:id/password — reset password (admin only)
- PATCH  /api/users/:id/status   — activate/deactivate (admin only)

UI: a "Users" link in the admin portfolio navigation, a user list table,
and a "+ New User" modal with fields: full_name, email, password, system_role.

Rules:
- All endpoints server-side enforced: admin only.
- Every action logged to audit_log.
- Password stored as bcrypt hash, never plain text.
- Deactivate sets is_active = 0, does not delete the row.
- Email must be unique — return 409 if duplicate.

### Email (deferred)
Email sending (welcome email, password reset email) is not built yet.
Do not add Nodemailer or any email dependency until asked.

---

## Features added after initial build

### User Management page (admin only)
Built as `client/users.html` + `client/js/users.js` + `server/routes/users.js`.

Endpoints needed:
- GET    /api/users              — list all users (admin only)
- POST   /api/users              — create user (admin only)
- PATCH  /api/users/:id          — update name, email, system_role (admin only)
- PATCH  /api/users/:id/password — reset password (admin only)
- PATCH  /api/users/:id/status   — activate/deactivate (admin only)

UI: a "Users" link in the admin portfolio navigation, a user list table,
and a "+ New User" modal with fields: full_name, email, password, system_role
(admin or user only — project roles are assigned per-project, not here).

Rules:
- All endpoints server-side enforced: admin only.
- Every action logged to audit_log.
- Password stored as bcrypt hash, never plain text.
- Deactivate sets is_active = 0, does not delete the row.
- Email must be unique — return 409 if duplicate.

### Project Members tab (admin only, inside project view)
Add a 5th tab called "Team" to the project view, visible only to admin.

UI: a table showing current project members with their name, email,
project role, workstream (if contributor), approver authority
(if gate_approver), and access expiry (if observer).
Each row has a "Remove" button.
Below the table, an "Add Member" form with:
- User dropdown (list of all active users)
- Project role dropdown: project_lead, contributor, gate_approver,
  reviewer, observer
- Workstream dropdown (only shown if contributor selected):
  technical, commercial, finance, legal
- Approver authority dropdown (only shown if gate_approver selected):
  ed_cam, md_nnel, slt_mtc, nnel_board, nnpc_group
- Access expiry date picker (only shown if observer selected)
- "Add to Project" button

Endpoints (already exist in backend, just need UI):
- POST   /api/projects/:id/members         — add member
- DELETE /api/projects/:id/members/:userId — remove member

Rules:
- Tab only visible to admin.
- All actions logged to audit_log.

### Email (deferred)
Email sending is not built yet.
Do not add Nodemailer or any email dependency until asked.

### Stage History View (read-only snapshot for completed stages)
No new page needed — update the existing project view.

Behaviour:
- Clicking a green checkmark stage in the pipeline strip loads a
  read-only snapshot of that stage instead of the current working view.
- Clicking the current active stage (blue dot) loads the normal
  working checklist as it does now.
- Clicking a grey/future stage does nothing (or shows "Not yet started").

Snapshot view shows:
1. A "Historical view — Stage X" label at the top making it clear
   this is read-only. Checklist items greyed out, all inputs disabled,
   checkboxes unclickable.
2. Checklist items grouped by pillar showing:
   - Ticked or unticked state at time of submission
   - Evidence note if recorded
   - "Completed by [name] · [date]" on ticked items
3. Gate Decision stamp at the bottom showing:
   - Decision (GO / CONDITIONAL / NO-GO) in colour (green/amber/red)
   - Authority (e.g. MD-NNEL)
   - Decided by (full name)
   - Date and time
   - Rationale text
   - For chained gates: both decisions in order (e.g. ED-CAM then
     MD-NNEL), each with their own stamp
   - If conditions existed: list them with closure evidence and
     who closed them
   - Review round number if stage was re-opened (e.g. "Round 2")

Endpoints needed (check if already exist before creating new ones):
- GET /api/projects/:id/stages/:stage/checklist — already exists,
  may need a ?submitted=true param to return the frozen snapshot
- GET /api/projects/:id/stages/:stage/decisions — already exists
- GET /api/projects/:id/stages/:stage/conditions — already exists

Who can see it: all project members. Read-only, no permission
restriction beyond project membership.

# CLAUDE.md Addition — Multi-Vertical Templates & Template Editor
# Append this section to the bottom of your existing CLAUDE.md

---

### Multi-vertical template support (Biofuels + Abatement)

Two new template seed files are provided and must be run in HeidiSQL
before this feature is built:
- `migrations/006_seed_template_biofuels_v1.sql`  (version: 'biofuels-1.0')
- `migrations/007_seed_template_abatement_v1.sql` (version: 'abatement-1.0')

The `template_versions` table needs a `technology` column if not already
present. Add via migration if missing:
```sql
ALTER TABLE template_versions
  ADD COLUMN technology ENUM('solar_pv','biofuels','abatement') NOT NULL DEFAULT 'solar_pv'
  AFTER version;
```

**Project creation change:** The "+ New Project" modal must add a
**Technology** dropdown: Solar PV / Biofuels / Abatement.
On project creation, the system selects the active template matching that
technology (e.g. technology='biofuels' → loads 'biofuels-1.0').
The correct checklist items for that technology are then seeded into
`stage_checklist` for Stage 0.

**Checklist item codes** are now technology-prefixed:
- Solar PV:  S0-T-01, S1-C-02, etc.
- Biofuels:  B0-T-01, B1-C-02, etc.
- Abatement: A0-T-01, A1-C-02, etc.

No other changes to the stage-gate structure, gate routing, or DOA
thresholds — those are identical across all three verticals.

---

### Template Editor (admin only)

Built as `client/templates.html` + `client/js/templates.js` +
`server/routes/templates.js` (extend the existing templates route file).

**Where it lives:** A "Templates" link in the admin navigation
(alongside "Users"). Only visible to `system_role = 'admin'`.

**What it shows:**
A three-tab view — Solar PV | Biofuels | Abatement — each showing
the active template version for that technology.

Within each tab, checklist items are grouped by Stage (0–5) and then
by Pillar (technical, commercial, finance, legal, esg).

Each checklist item row shows:
- Item code (e.g. B2-T-01)
- Description (editable inline)
- Guidance text (editable inline, shown on expand)
- Pillar (dropdown: technical, commercial, finance, legal, esg)
- Mandatory toggle (yes/no)
- Sort order (number, drag-to-reorder optional)
- Deactivate button (soft-delete — sets is_active = 0, does NOT delete)

**"+ Add Item" button** per stage opens a small form:
- Item code (auto-suggested, editable)
- Description (required)
- Guidance text (optional)
- Pillar (dropdown)
- Mandatory (toggle, default: yes)

**Versioning rules (CRITICAL — do not skip):**
- Editing a template item does NOT modify it in place if any
  in-flight projects are using that template version.
- Instead, create a NEW template version
  (e.g. 'solar-pv-1.1') with all the same items, apply the edit
  to the new version, and set it as active.
- Existing projects keep their original template_version (locked at
  project creation). Only NEW projects inherit the updated version.
- The admin sees a banner: "X projects are using solar-pv-1.0.
  Saving changes will create version solar-pv-1.1. Existing projects
  are unaffected."
- If NO projects are using the current version yet, edits can be
  made in place (no new version needed).

**New endpoints needed:**
```
GET    /api/templates                        — list all template versions
GET    /api/templates/:versionId/items       — items for a version, grouped by stage
POST   /api/templates/:versionId/items       — add new item (admin only)
PATCH  /api/templates/:versionId/items/:id   — edit item (triggers version check)
PATCH  /api/templates/:versionId/items/:id/status — activate/deactivate item
POST   /api/templates/:versionId/publish     — create new version from edits
```

**Rules:**
- All endpoints admin-only, server-side enforced.
- Every change logged to audit_log (action: 'template_item_edited',
  'template_version_created', etc.).
- Never hard-delete a template item — only soft-deactivate.
- Never modify a template version that has active projects using it
  — always fork to a new version.
- The existing GET /api/templates/active endpoint must continue to
  work and must return the correct active version per technology
  (pass ?technology=solar_pv|biofuels|abatement query param).
```
### Project RACI Matrix
New tab "RACI" in project view. Visible to all project members, editable
by admin only. Server-side enforced.

Pre-defined activity rows (see below). Columns = project team members
from project_members table. Each cell: R / A / C / I / blank dropdown.

Activities (rows):
Stage 0: Opportunity Screening
Stage 1: Preliminary Assessment
Stage 2: Technical Due Diligence | Commercial Structure |
         Legal & Regulatory | Financial Modelling
Stage 3: Information Memorandum | Lender Engagement | Data Room Management
Stage 4: CP Management | Construction Readiness
Stage 5: Commissioning Oversight | Post-COD Reporting
Cross-cutting: Gate 0/1 Decision | Gate 2 Decision | Gate 3/Financial Close |
               Financial Model Development | Community Engagement

New table needed: `project_raci`
  - id, project_id, activity, user_id, raci_code (R/A/C/I), updated_by,
    updated_at

New endpoints:
- GET  /api/projects/:id/raci  — full matrix for this project
- POST /api/projects/:id/raci  — upsert a cell (admin only)

All changes logged to audit_log. Read-only for non-admins.

### Internal Memo Export
"Export Memo" button in project view header. Visible to Project Lead
and Admin only (server-side enforced on the data endpoint).

GET /api/projects/:id/memo — returns all data needed for the memo
(project info, stage statuses, gate decisions, open conditions,
document register, team members).

Frontend: clicking the button opens a new browser tab with a
print-ready HTML page formatted for A4. Includes a Print button.
CSS @media print hides the print button and formats for clean output.

Memo sections:
1. Project Overview (name, technology, CAPEX, target COD)
2. Pipeline Status (current stage, completion %, stage table)
3. Gate Decision History (stage, decision, authority, date, rationale)
4. Open Conditions (if any)
5. Document Register Summary
6. Team
7. Next Steps (blank section)

Footer: CONFIDENTIAL — NNEL Internal Use Only
Generated by NNEL Pipeline Tracker on [date/time] | NNEL-CAM-FRP-001 v1.0

### Internal Memo Export — updates

The memo page must have two types of content:

1. AUTO-POPULATED (read-only, pulled from API):
   - Project name, technology, CAPEX, target COD
   - Pipeline status table (stage, status, completion %)
   - Gate decision history table
   - Open conditions table (if any)
   - Document register summary table
   - Team members table

2. MANUALLY EDITABLE fields (project lead fills in before printing):
   - "To:" field — blank, user types recipient
   - "From:" field — pre-filled "NNEL Clean Asset Management", editable
   - "Subject:" field — pre-filled "[Project Name] — Pipeline Status", editable
   - "Next Steps" — free-text area, blank, multi-line
   - "Additional Notes" — free-text area, optional, below Next Steps

UI behaviour:
- Editable fields look like clean underlined text inputs on screen,
  not standard browser input boxes — consistent with memo aesthetic
- A "Print / Save as PDF" button is visible on screen
- On print (@media print): all input borders/underlines hidden,
  print button hidden, content formats cleanly for A4
- The memo title at top right must read "INTERNAL MEMO"
  (not "INTERNAL MEMORANDUM")
- Font: Urbanist (same as rest of app)
- Colour: minimal — black text, NNEL green only for the header
  strip and section headings
- Footer on every printed page:
  "CONFIDENTIAL — NNEL Internal Use Only |
   Generated by NNEL Pipeline Tracker | NNEL-CAM-FRP-001 v1.0"

   ### Contributor checklist access — fix

Contributors can VIEW all checklist items for the current stage
but can only TICK items within their assigned workstream.

UI behaviour:
- Show all checklist items to contributors (no filtering)
- Items within their workstream: fully interactive (checkbox active)
- Items outside their workstream: checkbox visually greyed out,
  cursor shows 'not-allowed', small tooltip "Outside your workstream"
- A subtle "Your section" badge appears on the pillar heading that
  matches their workstream (e.g. contributor with workstream=finance
  sees "Your section" badge on the FINANCE pillar heading)
- Evidence note prompt still appears when they tick their own items

Backend: canEditWorkingData already handles this correctly —
the workstream check is already server-side enforced.
This is purely a frontend display fix.