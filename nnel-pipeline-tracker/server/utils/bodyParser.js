'use strict';
/**
 * bodyParser.js — reads and parses the request body as JSON.
 *
 * Node's http module gives you the body as a stream of chunks.
 * This helper collects them, joins them, then parses the result as JSON.
 * Returns the parsed object, or throws if the body is invalid JSON or
 * if the payload exceeds MAX_BYTES (guards against oversized requests).
 */

const MAX_BYTES = 1024 * 256; // 256 KB limit

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES) {
        req.destroy();
        return reject(new Error('Request body too large'));
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });

    req.on('error', reject);
  });
}

module.exports = { readBody };
