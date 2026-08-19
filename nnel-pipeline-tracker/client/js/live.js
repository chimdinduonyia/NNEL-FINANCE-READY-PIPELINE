/* live.js - shared live-update client (Server-Sent Events)
 *
 * Opens one persistent connection to /api/events and republishes each
 * incoming message to whatever page-specific callbacks have registered
 * via api.onLiveUpdate(). Only loaded on pages that actually want live
 * updates (see the <script> tag in project.html / index.html) - it does
 * nothing until something calls api.onLiveUpdate().
 *
 * The browser's native EventSource handles reconnecting on a dropped
 * connection automatically - no retry logic needed here.
 */
'use strict';

(function () {
  let source = null;
  const listeners = [];

  function start() {
    if (source) return; // already connected (or connecting)
    const token = api.getToken();
    if (!token) return; // not logged in - api.getMe() elsewhere handles redirecting to login

    // EventSource can't send an Authorization header, so the token travels
    // as a query parameter instead - see server/routes/events.js for the
    // full reasoning and trade-off.
    source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    source.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      listeners.forEach(fn => {
        try { fn(data); } catch (err) { console.error('live update listener failed:', err); }
      });
    };
  }

  // Pages call this to be told whenever something changes on the server -
  // e.g. { project_id, stage_number, action, at }. Lazily opens the
  // connection on the first subscriber.
  api.onLiveUpdate = function (callback) {
    listeners.push(callback);
    start();
  };
})();
