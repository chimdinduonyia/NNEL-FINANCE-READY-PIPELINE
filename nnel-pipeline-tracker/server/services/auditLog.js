'use strict';
/**
 * auditLog.js — append-only audit log writer
 *
 * SECURITY: This is the only place in the codebase that writes to audit_log.
 * The database user has only INSERT + SELECT on this table — any attempt to
 * UPDATE or DELETE will be refused at the DB level.
 *
 * Every state-changing action in the system calls log() here. Never write
 * directly to audit_log from route handlers.
 *
 * @param {object} conn  A pool or connection object (supports transactions:
 *                       pass the transaction connection, not the pool, so
 *                       the log entry commits or rolls back with its parent).
 * @param {object} entry
 * @param {number}       entry.userId       Who performed the action
 * @param {string}       entry.action       Machine-readable verb
 * @param {number|null}  [entry.projectId]  Relevant project (null = system event)
 * @param {number|null}  [entry.stageNumber]
 * @param {object|null}  [entry.detail]     Arbitrary extra context (serialised to JSON)
 */
async function log(conn, { userId, action, projectId = null, stageNumber = null, detail = null }) {
  const detailStr = detail ? JSON.stringify(detail) : null;

  await conn.execute(
    `INSERT INTO audit_log (project_id, stage_number, user_id, action, detail)
     VALUES (?, ?, ?, ?, ?)`,
    [projectId, stageNumber, userId, action, detailStr]
  );
}

module.exports = { log };
