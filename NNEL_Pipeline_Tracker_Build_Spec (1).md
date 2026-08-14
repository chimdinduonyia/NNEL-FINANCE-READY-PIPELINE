# NNEL Finance-Ready Pipeline Tracker — Build Spec

**For:** Developer / build team
**Basis document:** NNEL-CAM-FRP-001 v1.0 (Finance-Ready Project Pipeline Procedure)
**Purpose of this app:** Run individual clean-energy projects through the FRP's six-stage stage-gate process, with role-enforced authorizations and an immutable audit trail credible to a Board and to lenders.

---

## 1. First principle (read before building)

The app must enforce **one hard line: working data is separate from authorizations, and both are separate from the procedure template.**

| Data category | Who may change it | Mutability |
|---|---|---|
| **Procedure template** (checklist items, gate thresholds, pillar definitions) | Process Owner / Admin only, centrally | Versioned; project instances inherit a fixed version |
| **Working data** (checklist ticks, evidence, model inputs, document/risk status) | Scoped project-team members, only while the stage is open | Editable, fully logged |
| **Authorizations** (gate GO / NO-GO / Conditional) | Named approver for that gate only | **Append-only.** Locked on signing. Amendable only by re-opening the stage via logged change-control |

**Permissions must be enforced on the server, not in the browser.** Client-side checks are UI convenience only. Every state-changing request is re-validated server-side against the user's role, the project, and the stage state.

---

## 2. Roles & permission matrix (role × action × stage)

Roles are derived from the FRP's gate authorities and RACI, consolidated to six types. The **Gate Approver** is a routed tier, not one flat role (see §3).

### Roles

| Role | Scope | Core capability |
|---|---|---|
| **Process Owner / Admin** | System-wide | Manages template versions, users, role assignments, DOA thresholds. **Not** a project decision-maker. |
| **Project Lead** | One project instance | Completes working data, attaches evidence, **submits** a stage for gate review. Cannot approve own gate. |
| **Workstream Contributor** | One section of a project (Technical / Commercial / Finance / Legal) | Edits **only** their section. |
| **Gate Approver** (tiered: ED-CAM, MD-NNEL, SLT/MTC, NNEL Board, NNPC Group) | Gates routed to their authority level | GO / Conditional / NO-GO. Cannot edit the evidence being approved. |
| **Independent Reviewer / Assurance** (IE, auditor, verifier — often external) | Relevant package, read + certify | Read access + attach certification artifact. No gate authority, no data edits. |
| **Observer / Lender** | Read-only | Lenders get a scoped, time-limited data-room view, **Stage 3+ only**, VDR folders only. |

### Action permissions (✔ allowed · ✘ denied · ◑ scoped/conditional)

| Action | Admin | Project Lead | Contributor | Approver | Reviewer | Observer |
|---|---|---|---|---|---|---|
| Create / configure project | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Edit procedure template / thresholds | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Assign roles to a project | ✔ | ◑ (request) | ✘ | ✘ | ✘ | ✘ |
| Edit working data (checklists, fields) | ✘ | ✔ | ◑ (own section) | ✘ | ✘ | ✘ |
| Upload / manage evidence & documents | ✘ | ✔ | ◑ (own section) | ✘ | ✘ | ✘ |
| Submit stage for gate review | ✘ | ✔ | ✘ | ✘ | ✘ | ✘ |
| Record gate decision (GO/COND/NO-GO) | ✘ | ✘ | ✘ | ◑ (routed gate only) | ✘ | ✘ |
| Attach independent certification | ✘ | ✘ | ✘ | ✘ | ◑ (own scope) | ✘ |
| Re-open a locked stage | ✔ (logged) | ✘ | ✘ | ◑ (≥ original authority) | ✘ | ✘ |
| View full project | ✔ | ✔ | ◑ (own + read others) | ✔ | ◑ (scope) | ✘ |
| View data room | ✔ | ✔ | ◑ | ✔ | ◑ | ◑ (Stage 3+, time-boxed) |
| View audit log | ✔ | ✔ | ✘ | ✔ | ✘ | ✘ |

### Two non-negotiable boundaries

1. **Segregation of duties:** preparer ≠ approver. The Project Lead who submits a gate can never be the approver of that same gate.
2. **Submission lock:** once a stage is submitted, working data freezes. Any edit after submission **invalidates the pending approval** and forces re-submission. Approvers only ever sign exactly what they reviewed.

---

## 3. Gate-routing logic (against the DOA thresholds)

The approver is selected by **project CAPEX** and **gate number**, per the FRP. Some gates require a **chain** of approvals in sequence, not a single sign-off.

```
function requiredApprovers(gate, capexUSD):

  Gate 0 (Opportunity Screening):
      → [MD-NNEL]                       # all CAPEX bands

  Gate 1 (Preliminary Assessment):
      → [ED-CAM, then MD-NNEL]          # decision + endorsement (chain of 2)

  Gate 2 (Full Feasibility):
      if capexUSD < 50_000_000:
          → [SLT/MTC]
      else:
          → [NNEL Board]

  Gate 3 (Financial Close / FID):
      if capexUSD <= 50_000_000:
          → [NNEL Board]
      else:
          → [NNEL Board, then NNPC Group endorsement]
      # SPV / IJV formation adds: [NNPC Board]

  Gate 4 (First Disbursement):
      → [Project Lead attest + Finance verify all CPs cleared]

  COD (Commissioning):
      → [Independent Engineer sign-off, then ED-CAM acceptance]
```

**Rules for the engine:**
- A gate is not "passed" until **every** approver in its chain has signed in order.
- A **Conditional** decision must capture its conditions as discrete, trackable items; the **next gate is blocked** until each condition is marked closed with evidence.
- The CAPEX figure that drives routing is locked at submission; if CAPEX later crosses a threshold, the gate must be re-routed and re-submitted.
- Every decision records: decider identity (authenticated), role, timestamp (server time), decision type, and rationale. Immutable.

---

## 4. Trimmed screen inventory

Two tiers. Default to **progressive disclosure** — show the current stage only; collapse the rest. **Role drives the landing screen.**

### Tier 1 — Portfolio (all projects)
- **Portfolio funnel:** Horizon → Hopper → Funnel → Project, projects as cards by stage.
- Filters: technology, stage, approver-pending, at-risk.
- **Portfolio KPI dashboard** lives here (not on the project screen).
- Approver landing = **"Decisions awaiting me"** queue.

### Tier 2 — Single project (focused)
Keep only the five essentials; everything else is secondary or moved out:

1. **Pipeline position** — where this project is across the six gates.
2. **This gate's requirements** — checklist for the *current* stage only, role-filtered to the viewer's section.
3. **Gate decision panel** — submit / approve / conditions, with the routed authority shown.
4. **Document & evidence register** — single list, each item tagged with its VDR folder (00–09) and status. *(Replaces the duplicated Outputs list + VDR view.)*
5. **Audit trail** — who did what, when.

Plus a compact **six-pillar status strip** (not a full separate page), and a single **change register**.

### Moved out of the working flow
- **RACI matrix** → project setup / admin (configured once).
- **KPI dashboard** → portfolio tier.
- **Opportunity Log / funnel** → portfolio tier.

### De-duplication checklist (from the demo)
- [ ] Merge the two change-request logs into **one** change register.
- [ ] Merge Outputs/Deliverables + VDR folders into **one** document register.
- [ ] Replace dual persistence (live-sync + Save-to-Drive) with **one** backend; keep PDF export as a record output only.
- [ ] Fold the Bankability page into a six-pillar status strip.
- [ ] Make procedure text read-only template data, not per-project editable fields.

---

## 5. Suggested build order (de-risked)

1. Auth + roles + project model + **server-side permission enforcement**.
2. Template/versioning + a single project's working data + document register.
3. Gate submission → routing engine → append-only decisions + audit log.
4. Conditional-gate condition tracking + re-open change-control.
5. Portfolio tier + KPI dashboard.
6. Lender/observer scoped data-room view.
7. *(Optional, defer)* real-time presence / co-editing.

> **Scope note:** Real-time presence avatars and live co-editing are the most complex and the *least* important part for a governance tool. Defer them. Spend that effort on correct server-side permissions, the approval-chain logic, and the immutable audit log — those are what make the tool credible to a Board or a lender, which is the entire reason the FRP exists.
