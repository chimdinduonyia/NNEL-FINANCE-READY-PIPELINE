# Deploying to Railway

This app was built to deploy as a single Node process (backend + static
frontend on one port), so Railway needs almost no extra configuration.
This doc covers the parts that DO need doing: provisioning the database,
running the migrations in order, setting the right environment variables,
and locking down the app's DB user correctly.

Read this alongside `CLAUDE.md` — the security rules there (audit_log
append-only, DECIMAL money, UTC timestamps, server-side permission checks)
are already implemented in code and in the migrations. This doc is only
about the *deployment* steps, not about changing any of that.

---

## 1. Create the Railway project

1. In Railway, create a new project.
2. Add a **MySQL** database plugin to it. (Railway doesn't offer managed
   MariaDB as a first-party plugin, but MariaDB and MySQL are wire-compatible
   and the app talks to it through the `mysql2` driver either way — nothing
   in the schema uses a MariaDB-only feature.)
3. Add a second service for this app, deploying from this repo (GitHub or
   `railway up` from the CLI — either works, Railway auto-detects Node via
   Nixpacks and runs `npm install` then `npm start`, which is already the
   correct start command in `package.json`). No Dockerfile or Procfile needed.

---

## 2. Environment variables (set on the APP service, not the DB service)

Railway lets you reference another service's variables. Set these on the
app service, pointing at the MySQL plugin's own vars:

| App variable   | Value                              |
|-----------------|-------------------------------------|
| `DB_HOST`       | `${{MySQL.MYSQLHOST}}`             |
| `DB_PORT`       | `${{MySQL.MYSQLPORT}}`             |
| `DB_USER`       | `nnel_app` (see step 4 — not the default root user) |
| `DB_PASSWORD`   | the password you set for `nnel_app` in step 4 |
| `DB_NAME`       | `nnel_frp` (or whatever you name the database) |
| `JWT_SECRET`    | a **fresh** secret — generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`. Do not reuse your local dev secret. |
| `JWT_EXPIRES_IN`| `8h` |

Do **not** set `PORT` yourself — Railway injects its own and `server.js`
already reads `process.env.PORT`.

---

## 3. Run the migrations, in this exact order

There's no migration runner script — these are plain `.sql` files meant to
be run by hand (as documented in each file's own header). Connect to the
Railway MySQL instance with `railway connect mysql` (or point HeidiSQL at
the plugin's public connection details, temporarily) and run:

1. `001_initial_schema.sql`
2. Run the **production GRANTs** from step 4 below (adapted from the
   commented-out block at the bottom of `001_initial_schema.sql`)
3. `002_working_data.sql`
4. `npm run create-admin` — run this via `railway run npm run create-admin`
   from your machine (with the Railway service linked), so it picks up the
   production `DB_*` vars. This creates the first admin account, whose `id`
   the next migration needs.
5. `002_seed_template_v1.sql`
6. `003_gate_decisions.sql`
7. `004_review_rounds.sql`
8. `005_project_technology.sql`
9. `006_template_enhancements.sql` — **must run before** the biofuels seed
10. `006_seed_template_biofuels_v1.sql`
11. `007_seed_template_abatement_v1.sql`
12. `008_project_raci.sql`
13. `013_stage4_attestation.sql`
14. `014_stage_submission_summary.sql`
15. `015_project_details.sql`
16. `016_user_authority_workstream.sql`
17. `017_extend_workstream_enum.sql`
18. `018_template_gate_approvers.sql`
19. `019_project_manager_role.sql`

(Migration numbers 009–012 don't exist in this repo — that's not a gap to
fill, just a note so you don't go looking for missing files.)

---

## 4. Production DB user & grants (do this — don't skip it)

Every migration file has a commented-out `GRANT` block written for local
dev, using `'nnel_app'@'localhost'`. **That host restriction won't work on
Railway** — the app and the database run in separate containers, so a grant
scoped to `localhost` will never match the app's actual connection, and
you'd either get access-denied errors or end up running the app as the
unrestricted root user (which defeats the whole point of a scoped app user).

Run this instead, as the root/privileged user Railway gives you for the
MySQL plugin. It's the same privilege set as the commented blocks in the
migration files — least privilege per table, audit_log and gate_decisions
locked to append-only — just with the host fixed:

```sql
CREATE USER IF NOT EXISTS 'nnel_app'@'%' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.users                        TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.projects                     TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.project_members              TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.project_stages               TO 'nnel_app'@'%';
GRANT SELECT, INSERT               ON nnel_frp.audit_log                      TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.template_versions            TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.template_checklist_items     TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.template_vdr_folders         TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.stage_checklist              TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.document_register            TO 'nnel_app'@'%';
GRANT SELECT, INSERT               ON nnel_frp.gate_decisions                 TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE        ON nnel_frp.gate_conditions               TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.project_raci                 TO 'nnel_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.template_gate_approvers      TO 'nnel_app'@'%';

FLUSH PRIVILEGES;
```

Notes:
- `audit_log` and `gate_decisions` deliberately have no `UPDATE`/`DELETE`
  grant — this is the database-level enforcement of the append-only rule
  from `CLAUDE.md`, so even a bug in application code can't alter or erase
  a record. Don't widen these.
- `'%'` means "any host" at the MySQL layer — the actual access control is
  still the password plus Railway's private networking (the MySQL plugin
  isn't exposed publicly unless you turn on its public proxy). If you want
  to scope it tighter than `'%'`, Railway's private network uses per-project
  internal hostnames, but `'%'` is the standard pattern for this setup and
  is safe as long as you don't also expose the DB port publicly.
- Use this `nnel_app` user (not root) as `DB_USER`/`DB_PASSWORD` in step 2.

---

## 5. Health check

`GET /api/health` already exists and requires no auth — set it as Railway's
healthcheck path for the app service.

---

## 6. Things that already just work, no action needed

- Frontend calls the API with relative `fetch()` URLs (see `client/js/api.js`),
  so there's no base-URL config to change for a same-origin deploy.
- HTTPS is handled by Railway's edge — the app itself only needs to speak
  plain HTTP on `process.env.PORT`, which it already does.
- No file uploads: the document register stores a `file_ref` string, not an
  actual file, so there's no persistent volume to provision.
- Static file serving has a path-traversal guard already in place.

## 7. One thing to just watch during the first deploy

`bcrypt` has native bindings. Nixpacks (Railway's default Node builder)
usually compiles these without issue, but if the build fails on it, that's
the first place to look. Don't swap it for a pure-JS alternative without
checking in first — `CLAUDE.md` restricts dependency changes to ones we've
discussed.
