'use strict';
/**
 * server.js — main HTTP server and request dispatcher
 *
 * Routes are matched manually using a tiny path-parameter helper.
 * No framework. All async route errors are caught centrally and
 * returned as 500 so the process never crashes on a stray exception.
 */

require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const path = require('path');
const fs   = require('fs').promises;

const authRoutes      = require('./routes/auth');
const projectRoutes   = require('./routes/projects');
const stageRoutes     = require('./routes/stages');
const gateRoutes       = require('./routes/gates');
const conditionRoutes  = require('./routes/conditions');
const documentRoutes   = require('./routes/documents');
const templateRoutes  = require('./routes/templates');
const portfolioRoutes = require('./routes/portfolio');
const dataroomRoutes  = require('./routes/dataroom');
const raciRoutes      = require('./routes/raci');
const memoRoutes      = require('./routes/memo');
const userRoutes      = require('./routes/users');
const notificationRoutes = require('./routes/notifications');
const { sendJSON, sendError } = require('./utils/response');

const PORT       = Number(process.env.PORT) || 3000;
const CLIENT_DIR = path.join(__dirname, '..', 'client');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
};

// Serves a file from the client/ directory.
// SECURITY: startsWith check prevents path traversal.
async function serveStatic(req, res, urlPath) {
  const rel      = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const filePath = path.join(CLIENT_DIR, rel);

  if (!filePath.startsWith(CLIENT_DIR)) {
    return sendError(res, 403, 'Forbidden');
  }

  try {
    const content  = await fs.readFile(filePath);
    const ext      = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') sendError(res, 404, 'Not found');
    else throw err;
  }
}

// ---------------------------------------------------------------------------
// Minimal path-parameter router
// match('/api/projects/:id', '/api/projects/42') → { id: '42' }
// match('/api/projects/:id', '/api/projects')    → null
// ---------------------------------------------------------------------------
function match(pattern, pathname) {
  const pParts = pattern.split('/').filter(Boolean);
  const uParts = pathname.split('/').filter(Boolean);
  if (pParts.length !== uParts.length) return null;
  const params = {};
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i].startsWith(':')) {
      params[pParts[i].slice(1)] = uParts[i];
    } else if (pParts[i] !== uParts[i]) {
      return null;
    }
  }
  return params;
}

// ---------------------------------------------------------------------------
// Request dispatcher
// ---------------------------------------------------------------------------
async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method;
  let params;

  // ---- Health check (no auth) --------------------------------------------
  if (method === 'GET' && path === '/api/health') {
    return sendJSON(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }

  // ---- Auth ---------------------------------------------------------------
  if (method === 'POST' && path === '/api/auth/login')   return authRoutes.login(req, res);
  if (method === 'POST' && path === '/api/auth/signup')  return authRoutes.signup(req, res);
  if (method === 'GET'  && path === '/api/auth/me')      return authRoutes.me(req, res);

  // ---- Portfolio & decisions queue ----------------------------------------
  if (method === 'GET' && path === '/api/portfolio')          return portfolioRoutes.getPortfolio(req, res);
  if (method === 'GET' && path === '/api/portfolio/kpis')     return portfolioRoutes.getKPIs(req, res);
  if (method === 'GET' && path === '/api/decisions/pending')  return portfolioRoutes.getPendingDecisions(req, res);
  if (method === 'GET' && path === '/api/decisions/rejected') return portfolioRoutes.getRejectedDecisions(req, res);

  // ---- Notifications --------------------------------------------------------
  if (method === 'GET'  && path === '/api/notifications')              return notificationRoutes.list(req, res);
  if (method === 'GET'  && path === '/api/notifications/unread-count') return notificationRoutes.unreadCount(req, res);
  if (method === 'POST' && path === '/api/notifications/mark-seen')    return notificationRoutes.markSeen(req, res);

  // ---- User management (admin only) ---------------------------------------
  if (method === 'GET'  && path === '/api/users') return userRoutes.list(req, res);
  if (method === 'POST' && path === '/api/users') return userRoutes.create(req, res);

  if (params = match('/api/users/:id', path)) {
    if (method === 'PATCH') return userRoutes.update(req, res, params);
  }
  if (params = match('/api/users/:id/password', path)) {
    if (method === 'PATCH') return userRoutes.resetPassword(req, res, params);
  }
  if (params = match('/api/users/:id/status', path)) {
    if (method === 'PATCH') return userRoutes.setStatus(req, res, params);
  }

  // ---- Templates ----------------------------------------------------------
  if (path === '/api/templates') {
    if (method === 'GET')  return templateRoutes.listVersions(req, res);
    if (method === 'POST') return templateRoutes.createVersion(req, res);
  }
  if (method === 'GET'  && path === '/api/templates/active') return templateRoutes.getActive(req, res);
  if (params = match('/api/templates/:versionId/activate', path)) {
    if (method === 'PATCH') return templateRoutes.setActive(req, res, params);
  }
  if (params = match('/api/templates/:versionId', path)) {
    if (method === 'DELETE') return templateRoutes.deleteVersion(req, res, params);
  }

  if (params = match('/api/templates/:versionId/items', path)) {
    if (method === 'GET')  return templateRoutes.getItems(req, res, params);
    if (method === 'POST') return templateRoutes.addItem(req, res, params);
  }
  if (params = match('/api/templates/:versionId/items/:itemId/status', path)) {
    if (method === 'PATCH') return templateRoutes.setItemStatus(req, res, params);
  }
  if (params = match('/api/templates/:versionId/items/:itemId', path)) {
    if (method === 'PATCH') return templateRoutes.editItem(req, res, params);
  }
  if (params = match('/api/templates/:versionId/stages/:stage/status', path)) {
    if (method === 'PATCH') return templateRoutes.setStageStatus(req, res, params);
  }
  if (params = match('/api/templates/:versionId/publish', path)) {
    if (method === 'POST') return templateRoutes.publishVersion(req, res, params);
  }

  // ---- Template gate-approver configuration (configurable stages only) ----
  if (params = match('/api/templates/:versionId/gate-approvers', path)) {
    if (method === 'GET')  return templateRoutes.getGateApprovers(req, res, params);
    if (method === 'POST') return templateRoutes.setGateApprovers(req, res, params);
  }
  if (params = match('/api/templates/:versionId/gate-approvers/:stage', path)) {
    if (method === 'DELETE') return templateRoutes.clearGateApprovers(req, res, params);
  }

  // ---- Projects -----------------------------------------------------------
  if (method === 'POST' && path === '/api/projects')     return projectRoutes.create(req, res);
  if (method === 'GET'  && path === '/api/projects')     return projectRoutes.list(req, res);

  if (params = match('/api/projects/:id', path)) {
    if (method === 'GET')    return projectRoutes.getOne(req, res, params);
    if (method === 'PATCH')  return projectRoutes.update(req, res, params);
    if (method === 'DELETE') return projectRoutes.deleteProject(req, res, params);
  }

  if (params = match('/api/projects/:id/members', path)) {
    if (method === 'POST')  return projectRoutes.addMember(req, res, params);
  }

  if (params = match('/api/projects/:id/members/:userId/:role', path)) {
    if (method === 'DELETE') return projectRoutes.removeMember(req, res, params);
    if (method === 'PATCH')  return projectRoutes.updateMember(req, res, params);
  }

  // ---- Stages & checklist -------------------------------------------------
  if (params = match('/api/projects/:id/stages/:stage', path)) {
    if (method === 'GET') return stageRoutes.getStage(req, res, params);
  }

  if (params = match('/api/projects/:id/stages/:stage/checklist', path)) {
    if (method === 'GET') return stageRoutes.getChecklist(req, res, params);
  }

  if (params = match('/api/projects/:id/stages/:stage/checklist/:itemId', path)) {
    if (method === 'PATCH') return stageRoutes.updateChecklistItem(req, res, params);
  }

  // ---- Gate submission & decisions ----------------------------------------
  if (params = match('/api/projects/:id/stages/:stage/submit', path)) {
    if (method === 'POST') return gateRoutes.submit(req, res, params);
  }

  if (params = match('/api/projects/:id/stages/:stage/recall', path)) {
    if (method === 'POST') return gateRoutes.recall(req, res, params);
  }

  if (params = match('/api/projects/:id/stages/:stage/decision', path)) {
    if (method === 'POST') return gateRoutes.recordDecision(req, res, params);
  }

  if (params = match('/api/projects/:id/stages/:stage/decisions', path)) {
    if (method === 'GET') return gateRoutes.listDecisions(req, res, params);
  }

  // ---- Project audit log --------------------------------------------------
  if (params = match('/api/projects/:id/audit', path)) {
    if (method === 'GET') return gateRoutes.getAuditLog(req, res, params);
  }

  // ---- Conditions & re-open -----------------------------------------------
  if (params = match('/api/projects/:id/stages/:stage/conditions', path)) {
    if (method === 'GET') return conditionRoutes.listConditions(req, res, params);
  }

  if (params = match('/api/projects/:id/stages/:stage/conditions/:condId', path)) {
    if (method === 'PATCH') return conditionRoutes.closeCondition(req, res, params);
  }

  if (params = match('/api/projects/:id/stages/:stage/reopen', path)) {
    if (method === 'POST') return conditionRoutes.reopenStage(req, res, params);
  }

  // ---- Data room ----------------------------------------------------------
  if (params = match('/api/projects/:id/dataroom', path)) {
    if (method === 'GET') return dataroomRoutes.getDataroom(req, res, params);
  }

  // ---- RACI matrix --------------------------------------------------------
  if (params = match('/api/projects/:id/raci', path)) {
    if (method === 'GET')  return raciRoutes.getRaci(req, res, params);
    if (method === 'POST') return raciRoutes.upsertCell(req, res, params);
  }

  // ---- Memo export --------------------------------------------------------
  if (params = match('/api/projects/:id/memo', path)) {
    if (method === 'GET') return memoRoutes.getMemo(req, res, params);
  }

  // ---- Documents ----------------------------------------------------------
  if (params = match('/api/projects/:id/documents', path)) {
    if (method === 'GET')  return documentRoutes.list(req, res, params);
    if (method === 'POST') return documentRoutes.create(req, res, params);
  }

  if (params = match('/api/projects/:id/documents/:docId', path)) {
    if (method === 'PATCH')  return documentRoutes.update(req, res, params);
    if (method === 'DELETE') return documentRoutes.remove(req, res, params);
  }

  // ---- Static files (non-API requests fall through here) ------------------
  if (!path.startsWith('/api/')) {
    return serveStatic(req, res, path);
  }

  sendError(res, 404, 'Not found');
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('Unhandled request error:', err);
    if (!res.headersSent) sendError(res, 500, 'Internal server error');
  });
});

server.listen(PORT, () => {
  console.log(`NNEL Pipeline Tracker — http://localhost:${PORT}`);
  console.log('');
  console.log('  Auth:');
  console.log('    POST /api/auth/login');
  console.log('    POST /api/auth/signup');
  console.log('    GET  /api/auth/me');
  console.log('');
  console.log('  Projects:');
  console.log('    POST   /api/projects');
  console.log('    GET    /api/projects');
  console.log('    GET    /api/projects/:id');
  console.log('    PATCH  /api/projects/:id');
  console.log('    POST   /api/projects/:id/members');
  console.log('    DELETE /api/projects/:id/members/:userId');
  console.log('');
  console.log('  Stages & checklist:');
  console.log('    GET   /api/projects/:id/stages/:stage');
  console.log('    GET   /api/projects/:id/stages/:stage/checklist');
  console.log('    PATCH /api/projects/:id/stages/:stage/checklist/:itemId');
  console.log('');
  console.log('  Gate submission & decisions:');
  console.log('    POST /api/projects/:id/stages/:stage/submit');
  console.log('    POST /api/projects/:id/stages/:stage/decision');
  console.log('    GET  /api/projects/:id/stages/:stage/decisions');
  console.log('    GET  /api/projects/:id/audit');
  console.log('');
  console.log('  Conditions & re-open:');
  console.log('    GET   /api/projects/:id/stages/:stage/conditions');
  console.log('    PATCH /api/projects/:id/stages/:stage/conditions/:condId');
  console.log('    POST  /api/projects/:id/stages/:stage/reopen');
  console.log('');
  console.log('  Documents:');
  console.log('    GET    /api/projects/:id/documents');
  console.log('    POST   /api/projects/:id/documents');
  console.log('    PATCH  /api/projects/:id/documents/:docId');
  console.log('    DELETE /api/projects/:id/documents/:docId');
  console.log('');
  console.log('  Data room:');
  console.log('    GET /api/projects/:id/dataroom');
  console.log('');
  console.log('  Portfolio & decisions queue:');
  console.log('    GET /api/portfolio');
  console.log('    GET /api/portfolio/kpis');
  console.log('    GET /api/decisions/pending');
  console.log('');
  console.log('  User management (admin only):');
  console.log('    GET   /api/users');
  console.log('    POST  /api/users');
  console.log('    PATCH /api/users/:id');
  console.log('    PATCH /api/users/:id/password');
  console.log('    PATCH /api/users/:id/status');
  console.log('');
  console.log('  Templates:');
  console.log('    GET /api/templates/active');
});
