'use strict';
/**
 * response.js — thin wrappers for sending JSON HTTP responses.
 *
 * Using these helpers keeps every route consistent: correct Content-Type,
 * status code, and JSON body every time.
 */

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { error: message });
}

module.exports = { sendJSON, sendError };
