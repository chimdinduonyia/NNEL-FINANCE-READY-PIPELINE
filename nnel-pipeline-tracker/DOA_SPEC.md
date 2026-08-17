# DOA (Delegation of Authority) — Current Implementation Spec

**Purpose of this document:** a precise, code-accurate record of how gate-routing /
DOA authority is currently implemented, written *before* it gets torn out. The
project owner has made an explicit decision (2026-08-17, recorded in memory) to
remove the hardcoded CAPEX-threshold routing for Stages 2 and 3 and replace it
with fully admin-configured gate-approver chains for every stage — trusting
admins to follow NNEL's real FRP procedure rather than having the system
enforce it in code. This document exists so that decision can be implemented
without silently losing any of the business rules currently encoded here.

Every fact below was verified directly against the code/migrations in this
repo on 2026-08-17, not reconstructed from memory. File:line references are
given so they can be re-checked as the code moves.

---

## 1. Authority tiers

Six authority values exist today, used consistently as `VARCHAR(20)` /
`ENUM(...)` values across the schema and as string literals in code:

| Value | Meaning |
|---|---|
| `slt_mtc` | Senior Leadership Team — Management Team Committee |
| `m4_ed_cam` | M4 — Executive Director, Clean Asset Management |
| `m3_md_nnel` | M3 — Managing Director, NNEL |
| `m2_evp` | M2 — Executive Vice President |
| `nnel_board` | NNEL Board |
| `m1_nnpc` | M1 — NNPC Group |

**Naming history** (relevant if you ever see old data or old code comments):
originally these were `ed_cam`, `md_nnel`, `nnpc_group`, `slt_mtc`,
`nnel_board`. Migration `016_user_authority_workstream.sql` renamed
`ed_cam→m4_ed_cam`, `md_nnel→m3_md_nnel`, `nnpc_group→m1_nnpc`, backfilled
existing rows, and added the new `m2_evp` tier (no old equivalent). This
touched both `project_members.approver_authority` and
`gate_decisions.authority`. **The `gate_decisions.authority` column ENUM in
the live schema is `('m1_nnpc','m2_evp','nnel_board','m3_md_nnel','slt_mtc','m4_ed_cam')
NULL DEFAULT NULL`** — migration 003's original ENUM definition (which still
shows the old names) is superseded by 016; don't read 003 alone as ground
truth for the current schema. It was made `NULL`-able by migration
`013_stage4_attestation.sql` (see §5).

### Authority ranking (for "equal or higher" comparisons — re-opens only)

`server/middleware/permissions.js` — `AUTHORITY_RANK`:
```js
const AUTHORITY_RANK = { slt_mtc: 1, m3_md_nnel: 2, nnel_board: 3, m4_ed_cam: 2, m2_evp: 4, m1_nnpc: 5 };
```
Note `m3_md_nnel` and `m4_ed_cam` are **tied at rank 2** here.

**⚠ Known inconsistency, not yet causing an observed bug:** `server/routes/conditions.js`
(`reopenStage()`, ~line 260-290) independently ranks authorities via a raw SQL
`CASE` expression for a different purpose (finding the highest-ranking signer
on the current review round) and uses **different numbers**:
```sql
CASE authority
  WHEN 'm1_nnpc' THEN 6 WHEN 'm2_evp' THEN 5 WHEN 'nnel_board' THEN 4
  WHEN 'm3_md_nnel' THEN 3 WHEN 'm4_ed_cam' THEN 2 WHEN 'slt_mtc' THEN 1 END
```
Here `m3_md_nnel` (3) outranks `m4_ed_cam` (2) — they are **not** tied, unlike
the JS table. The SQL ranking picks the *highest signer so far*; the result is
then compared against the reopener's own rank using the **JS** `AUTHORITY_RANK`
table (`provided < required → 403`). Because the two tables agree on relative
ordering everywhere except the `m3_md_nnel`/`m4_ed_cam` tie, this has not
produced a wrong result in any chain currently configured — but if a future
chain ever put `m4_ed_cam` after `m3_md_nnel` in the same stage, or relied on
them being interchangeable for re-open purposes, the two tables would disagree.
**When this logic is rebuilt, define the rank order in exactly one place** and
have both call sites use it.

---

## 2. How the required authority for a gate is determined today

Single function, `server/middleware/permissions.js` →
`getRequiredAuthority(stageNumber, capexUSD, projectId = null)`. Called from
three places that must all agree on the same routing:
`gates.js` (`recordDecision`, `canApproveGate` internally),
`portfolio.js` (`getPendingDecisions`, for the "awaiting your decision" queue),
and indirectly by `canApproveGate` in `permissions.js` itself.

```js
async function getRequiredAuthority(stageNumber, capexUSD, projectId = null) {
  const capex = Number(capexUSD) || 0;

  // ---- CAPEX-governed gates: always use hardcoded thresholds, ignore template ----
  if (stageNumber === 2) {
    return capex < 50_000_000 ? ['slt_mtc'] : ['nnel_board'];
  }
  if (stageNumber === 3) {
    if (capex <= 50_000_000) return ['nnel_board'];
    return ['nnel_board', 'm1_nnpc'];   // two-signer chain, in this order
  }

  // ---- Template-configurable gates (0, 1, 4, 5) ----
  if (projectId) {
    try {
      const [rows] = await pool.execute(
        `SELECT ga.authority FROM template_gate_approvers ga
         JOIN template_versions tv ON tv.id = ga.template_version_id
         JOIN projects p ON p.template_version = tv.version AND p.id = ?
         WHERE ga.stage_number = ? ORDER BY ga.chain_position`,
        [projectId, stageNumber]
      );
      if (rows.length > 0) return rows.map(r => r.authority);
    } catch { /* table may not exist yet — fall through to defaults */ }
  }

  switch (stageNumber) {
    case 0: return ['m3_md_nnel'];
    case 1: return ['m4_ed_cam', 'm3_md_nnel'];   // chain: ED-CAM then MD-NNEL
    case 4: return ['m3_md_nnel'];
    case 5: return ['m4_ed_cam'];
    default: return [];
  }
}
```

The return value is always an **ordered array** — one element per required
signature, in signing order. Chain length 1 = single approver. Chain length 2+
= sequential multi-signer gate (see §3).

### 2a. CAPEX-governed stages (2 and 3) — the part being removed

- **Stage 2**: CAPEX < $50,000,000 USD → `slt_mtc` alone decides.
  CAPEX ≥ $50,000,000 → `nnel_board` alone decides.
- **Stage 3**: CAPEX ≤ $50,000,000 → `nnel_board` alone decides.
  CAPEX > $50,000,000 → **two-signer chain**: `nnel_board` signs first, then
  `m1_nnpc`. Both must sign (in that order) before the stage advances.
- CAPEX is read from `stage.capex_at_submission` — a value frozen onto the
  `project_stages` row at submission time (not the live/current project CAPEX),
  so the routing a stage was submitted under can't shift underneath an
  in-flight approval if someone edits the project's CAPEX later. This
  freeze-at-submission behaviour is unrelated to the CAPEX-threshold decision
  itself and should almost certainly be preserved for whatever replaces it —
  it's what makes "what you approved is what was actually submitted" true.
- **This logic completely ignores `template_gate_approvers`** — even if an
  admin configured chain rows for stage 2 or 3 today, they'd be silently
  unused. (`templates.js`'s `setGateApprovers()` actively prevents this
  configuration from being saved in the first place — see §4.)
- These are the only two stages with a hardcoded dollar threshold anywhere in
  the system. Nothing else in the codebase references `50_000_000` /
  `50000000` for routing purposes.

### 2b. Template-configurable stages (0, 1, 4, 5) — the part staying (and being extended)

- If `template_gate_approvers` has rows for `(this project's template version,
  this stage number)`, those rows define the chain, ordered by
  `chain_position`. This is a real per-template-version override — different
  template versions (e.g. `solar-pv-1.0` vs a lightweight variant) can define
  different chains for the same stage number.
- If no rows exist (table missing, or simply no configuration saved for that
  stage/version), the hardcoded `switch` defaults above apply. This fallback
  is what lets the feature ship without every existing template version
  needing to be populated first.
- Default chains today: Stage 0 → MD-NNEL alone. Stage 1 → ED-CAM then
  MD-NNEL (chain of 2). Stage 4 → MD-NNEL alone. Stage 5 → ED-CAM alone.
- **Stage 4's "attestation" is not actually a separate mechanism.** A code
  comment in both `gates.js` (~line 201) and `permissions.js` describes Stage
  4 (First Disbursement) as having "a special attestation flow (Project Lead +
  Finance verification) not covered by the standard gate_approver path,
  implemented as a dedicated flow in Step 4" — but no such dedicated flow
  exists in the code; Stage 4 goes through the exact same `getRequiredAuthority`
  → `canApproveGate` → `recordDecision` path as every other stage, defaulting
  to a single `m3_md_nnel` signer. The `recordedAuthority = required[chainPosition
  - 1] ?? null` line in `gates.js` would only actually record `NULL` if
  `required` were an empty array, which doesn't happen for stage 4 today (the
  default always returns `['m3_md_nnel']`). **Flag this to the project owner
  when work resumes** — either the comment is stale (attestation was planned
  but never built, and Stage 4 should be treated as an ordinary configurable
  gate going forward) or a real attestation flow was intended and is still
  missing. Don't silently assume either answer.

---

## 3. Chain enforcement, segregation of duties, submission lock

All server-side, in `server/middleware/permissions.js` unless noted.

- **`canApproveGate(userId, systemRole, projectId, stageNumber)`** — the single
  gate that `recordDecision` calls before anything else. Checks, in order:
  1. Caller has an active `gate_approver` role on this project (or is admin —
     admin bypass exists but is narrow; check current code before assuming
     scope).
  2. Stage status is `'submitted'` (not `in_progress`, not already
     `approved`/`conditional`/`rejected`).
  3. **Segregation of duties**: caller's user id must not equal
     `project_stages.submitted_by` for this stage/round — the person who
     submitted a stage can never be the one who signs its gate.
  4. **Chain ordering**: counts existing `gate_decisions` rows for this
     project/stage/`review_round` (only the *current* round counts — see
     below), takes that count as the 0-indexed "next position", and requires
     the caller's own authority (from `project_members.approver_authority`
     for this project, or `member_authority` per-project override) to equal
     `required[nextPosition]`. A second-in-chain approver literally cannot
     sign before the first has.
- **Submission lock**: once a stage is `'submitted'`, `canEditWorkingData`
  refuses further checklist edits. Any edit must go through a resubmission
  path that un-submits the stage first — approvers only ever sign exactly
  what they reviewed. (Full un-submit mechanics live in `stages.js`, not
  re-verified line-by-line for this document — the *rule* is what matters for
  the rebuild, not the exact function name.)
- **Review rounds** (`migrations/004_review_rounds.sql`): `project_stages.review_round`
  and `gate_decisions.review_round` both start at 1. A NO-GO auto-reopens the
  stage (`review_round + 1`, status → `in_progress`, `submitted_by`/
  `submitted_at`/`capex_at_submission` cleared) so the team can revise and
  resubmit without manual intervention. Chain-position counting and the
  "am I next" check in `canApproveGate` only ever look at the *current*
  round's decisions — prior rounds' decisions stay in the table forever
  (append-only) but don't count toward whether today's chain is complete.
- **Document-review gating** (`gates.js`, `recordDecision`, ~line 220-257):
  before any decision can be recorded, every document attached to that
  project/stage must be out of `'submitted'` status (approver must have
  approved or returned each one first) — a decision attempt with any document
  still `'submitted'` is rejected with 409. Separately, if any document is
  `'outstanding'` (returned to the team), **only `no_go` is a legal decision**
  — you can't wave through a stage while documents are still kicked back to
  the team. Both checks are independent of authority/DOA but sit in the same
  function and matter for anyone rebuilding `recordDecision`.

---

## 4. Configuring chains today (admin-only)

`server/routes/templates.js`:

```js
const CAPEX_GOVERNED_STAGES = [2, 3];
const GATE_AUTHORITY_VALUES = ['m1_nnpc','m2_evp','nnel_board','m3_md_nnel','slt_mtc','m4_ed_cam'];
```

- **`getGateApprovers(templateVersionId)`** — returns the configured chains
  for a template version, grouped by stage.
- **`setGateApprovers(...)`** — admin/PM only. Server-side rejects any attempt
  to configure stage 2 or 3 with:
  `"Stage X gate routing is governed by CAPEX thresholds and cannot be
  configured."` — **this is the one line that must be deleted (or inverted)
  to let stages 2/3 become admin-configurable like the rest.** Validates the
  submitted chain is a non-empty array of values drawn from
  `GATE_AUTHORITY_VALUES`. If the template version currently has projects
  using it, **forks a new version first** (via the existing `forkVersion`/
  `projectCount` helpers — the same fork-on-edit rule used for checklist item
  edits) so in-flight projects keep the chain they were actually approved
  under; the edit only applies to the new version and future projects.

Schema — `migrations/018_template_gate_approvers.sql`:
```sql
CREATE TABLE template_gate_approvers (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_version_id  INT UNSIGNED NOT NULL,
  stage_number         TINYINT UNSIGNED NOT NULL,
  chain_position       TINYINT UNSIGNED NOT NULL,
  authority            VARCHAR(20) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gate_chain (template_version_id, stage_number, chain_position),
  CONSTRAINT fk_tga_version FOREIGN KEY (template_version_id) REFERENCES template_versions (id)
);
```
Nothing in this table's shape prevents storing stage 2/3 chains — the
restriction is purely the application-layer check in `setGateApprovers` plus
`getRequiredAuthority` never reading this table for those two stage numbers.
Removing CAPEX-governance is therefore mostly a matter of **deleting the
special-case branches**, not building new infrastructure.

---

## 5. Append-only guarantees relevant to DOA (do not weaken these when rebuilding)

- `gate_decisions` — DB grant is INSERT + SELECT only (no UPDATE/DELETE) per
  `CLAUDE.md` rule #3/#4. A recorded decision can never be edited or deleted;
  changing course requires a logged re-open (new review round) and a fresh
  decision row. `authority` column is nullable (migration 013) — originally
  added so Stage 4's imagined attestation flow could omit a DOA tier; in
  practice today it's never actually NULL (see §2b) but the column stays
  nullable, which is harmless and doesn't need to be "fixed."
- `gate_conditions` — allows UPDATE (to record closure: `is_closed`,
  `closed_by`, `closed_at`, `evidence_note`) but not DELETE. A condition can
  be closed but never removed.
- `chain_position` and `review_round` are stamped onto each `gate_decisions`
  row at insert time and never change afterward — the historical chain shape
  for any past decision is always reconstructable from the row itself, even
  if the *current* configured chain for that stage/template later changes.
  This matters a lot for the rebuild: whatever replaces
  `getRequiredAuthority`, past decisions must keep referring to the chain
  they were actually signed against, not be reinterpreted against today's
  configuration.

---

## 6. Re-open authority rule

`server/middleware/permissions.js` → `canReopenStage()` (coarse check: admin
always allowed; gate_approver allowed only if stage is in a decided state —
`approved`/`conditional`/`rejected`) plus a fine-grained check in
`server/routes/conditions.js` → `reopenStage()` for non-admin callers:
finds the highest-ranking authority among signers in the most recent
`review_round` (via the SQL `CASE` ranking noted in §1), and requires the
reopener's own authority to be **equal or higher** than that, using the JS
`AUTHORITY_RANK` table. Also blocks the re-open outright if the *next* stage
has already progressed too far (`submitted`/`approved`/`conditional`/`rejected`)
— you can't reopen a stage the pipeline has already moved past.

---

## 7. What changes vs. what doesn't, for the planned rebuild

**Removing** (per 2026-08-17 decision):
- The two `if (stageNumber === 2)` / `if (stageNumber === 3)` branches in
  `getRequiredAuthority` and the `50_000_000` thresholds entirely.
- The `CAPEX_GOVERNED_STAGES` guard in `templates.js` that blocks configuring
  stages 2/3.
- `capex_at_submission`-driven routing — CAPEX becomes a plain informational/
  reporting field again, no longer a routing input. (Confirm with the owner
  whether `capex_at_submission` itself should still be frozen at submission
  for audit/reporting purposes — recommend keeping it even though it stops
  driving routing, since "what was the CAPEX when this was approved" is
  still a legitimate governance question a lender might ask.)

**Keeping unchanged:**
- Everything in §3 (chain enforcement, segregation of duties, submission
  lock, review rounds, document-review gating) — none of it depends on
  *how* the required-authority array is produced, only on it existing.
  `getRequiredAuthority` becomes a pure `template_gate_approvers` lookup for
  every stage 0-5 with no hardcoded fallback branches for 2/3 (the existing
  fallback defaults for 0/1/4/5 can stay as a safety net, or be extended to
  cover 2/3 too — owner's call).
- All of §5 (append-only guarantees) and §6 (re-open rule) — unaffected by
  where the chain definition comes from.
- The fork-on-edit versioning rule in `templates.js` — this is exactly the
  mechanism that will make admin-configured chains for *every* stage safe
  the same way it already is for stages 0/1/4/5 today.

**Worth resolving before/while rebuilding** (surfaced by writing this spec,
not previously flagged):
- The SQL-vs-JS authority ranking inconsistency (§1) — pick one source of
  truth for rank order.
- The Stage 4 "attestation" comment vs. actual behaviour mismatch (§2b) —
  confirm with the owner whether real attestation logic was ever meant to
  exist, or the comment is aspirational leftover text to delete.
