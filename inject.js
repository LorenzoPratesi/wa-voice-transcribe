/**
 * WA Voice Transcribe — inject.js (MAIN world, document_start)
 *
 * WhatsApp media is end-to-end encrypted: the only place the audio exists in the
 * clear is the Blob that WhatsApp hands to URL.createObjectURL to feed the
 * <audio> element.
 *
 * Two complementary hooks, both required:
 *
 *  1. URL.createObjectURL / revokeObjectURL — keeps the Blob. revoke does NOT
 *     drop the entry from the Map: WhatsApp revokes right after use, and from
 *     that moment the blob: URL can no longer be fetched.
 *
 *  2. HTMLMediaElement.prototype (the `src` setter and the `play` method) — tells
 *     us WHICH blob URL starts playing and WHEN. This is needed because WhatsApp
 *     never inserts the audio element into the DOM: it uses a detached
 *     `new Audio()`, which no querySelector can reach. Hooking the prototype is
 *     the only way to see it.
 *
 * Runs in the MAIN world declared by the manifest: an inline <script> tag would
 * be blocked by WhatsApp Web's CSP.
 */
(function () {
  'use strict';

  var MAX_BLOBS = 50;
  var MAX_RECENT = 20;

  /** @type {Map<string, Blob>} key = the blob: URL returned by createObjectURL */
  var blobs = new Map();

  /** @type {Array<{url:string, at:number}>} audio blob URLs that started playing */
  var recent = [];

  /** @type {Array<{sinceMs:number, reqId:string, timer:number}>} pending requests */
  var waiters = [];

  /** Window during which the next play() is ours: mute it and stop it at once. */
  var armedUntil = 0;

  /** Last audio element seen: this is where playback state actually lives. */
  var lastEl = null;

  // ---------------------------------------------------------------------------
  // 1. Blob capture
  // ---------------------------------------------------------------------------

  var origCreate = URL.createObjectURL.bind(URL);
  var origRevoke = URL.revokeObjectURL.bind(URL);

  URL.createObjectURL = function (obj) {
    var url = origCreate(obj);
    try {
      if (obj instanceof Blob && typeof obj.type === 'string' && obj.type.indexOf('audio/') === 0) {
        blobs.set(url, obj);
        while (blobs.size > MAX_BLOBS) blobs.delete(blobs.keys().next().value);
      }
    } catch (_) {
      /* never break the original behaviour */
    }
    return url;
  };

  URL.revokeObjectURL = function (url) {
    // Deliberately does NOT remove the entry from the Map.
    return origRevoke(url);
  };

  // ---------------------------------------------------------------------------
  // 2. Media element prototype hooks
  // ---------------------------------------------------------------------------

  function noteAudioUrl(el, value) {
    var url = String(value || '');
    if (url.indexOf('blob:') !== 0) return;
    // Audio only: the src setter is shared with <video>.
    if (el && el.tagName && el.tagName !== 'AUDIO') return;

    if (el) lastEl = el;

    var rec = { url: url, at: Date.now() };
    recent.push(rec);
    while (recent.length > MAX_RECENT) recent.shift();

    for (var i = waiters.length - 1; i >= 0; i--) {
      var w = waiters[i];
      if (rec.at >= w.sinceMs) {
        waiters.splice(i, 1);
        clearTimeout(w.timer);
        serveUrl(w.reqId, rec.url);
      }
    }
  }

  try {
    var proto = HTMLMediaElement.prototype;

    var srcDesc = Object.getOwnPropertyDescriptor(proto, 'src');
    if (srcDesc && srcDesc.set) {
      Object.defineProperty(proto, 'src', {
        configurable: true,
        enumerable: srcDesc.enumerable,
        get: function () { return srcDesc.get.call(this); },
        set: function (v) {
          try { noteAudioUrl(this, v); } catch (_) { /* ignore */ }
          return srcDesc.set.call(this, v);
        }
      });
    }

    // On a replay WhatsApp may simply call play() again without reassigning src:
    // without this hook that case would slip through.
    var origPlay = proto.play;
    proto.play = function () {
      var el = this;
      try { noteAudioUrl(el, el.currentSrc || el.src || ''); } catch (_) { /* ignore */ }

      var armed = Date.now() < armedUntil && el.tagName === 'AUDIO';
      if (!armed) return origPlay.apply(el, arguments);

      // Playback forced by the content script: it only exists to make WhatsApp
      // decrypt the media. Mute it, stop it immediately and rewind, so the user
      // hears nothing and the voice note is not marked as played.
      armedUntil = 0;
      var wasMuted = el.muted;
      try { el.muted = true; } catch (_) { /* ignore */ }
      var ret = origPlay.apply(el, arguments);
      // pause() right after play() rejects the promise: that is expected.
      if (ret && typeof ret.catch === 'function') ret.catch(function () {});
      setTimeout(function () {
        try { el.pause(); el.currentTime = 0; el.muted = wasMuted; } catch (_) { /* ignore */ }
      }, 0);
      return ret;
    };
  } catch (_) {
    /* if the prototype cannot be patched, blob capture alone still works */
  }

  // ---------------------------------------------------------------------------
  // Resolution and bridge
  // ---------------------------------------------------------------------------

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('read_failed')); };
      fr.readAsDataURL(blob);
    });
  }

  function reply(reqId, payload) {
    var msg = { source: 'wa-vt-page', type: 'BLOB_DATA', reqId: reqId };
    if (payload.dataUrl) msg.dataUrl = payload.dataUrl;
    if (payload.error) msg.error = payload.error;
    window.postMessage(msg, '*');
  }

  function serveUrl(reqId, url) {
    Promise.resolve()
      .then(function () {
        var blob = blobs.get(url);
        if (blob) return blob;
        // Not in the Map (created before our patch): if it has not been revoked
        // yet, fetching it still works.
        return fetch(url).then(function (res) { return res.blob(); });
      })
      .then(blobToDataUrl)
      .then(function (dataUrl) { reply(reqId, { dataUrl: dataUrl }); })
      .catch(function () { reply(reqId, { error: 'blob_unavailable' }); });
  }

  window.addEventListener('message', function (event) {
    // Guards: only messages from this same window, carrying our signature.
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== 'wa-vt') return;

    // Playback state lives on the media element. WhatsApp's DOM exposes it only
    // through aria-label, which changes with the interface language, so the
    // content script asks here instead of reading labels.
    if (data.type === 'IS_PLAYING') {
      window.postMessage({
        source: 'wa-vt-page', type: 'BLOB_DATA', reqId: data.reqId,
        stats: { playing: !!(lastEl && !lastEl.paused && !lastEl.ended) }
      }, '*');
      return;
    }

    if (data.type === 'ARM') {
      armedUntil = Date.now() + (Number(data.ttlMs) || 8000);
      return;
    }

    if (data.type === 'GET_BLOB') {
      serveUrl(data.reqId, data.url);
      return;
    }

    // Waits for the first audio that starts playing after `sinceMs`, i.e. the one
    // caused by the content script's click. Answers as soon as it is available,
    // with no polling.
    if (data.type === 'GET_SINCE') {
      var sinceMs = Number(data.sinceMs) || 0;
      for (var i = recent.length - 1; i >= 0; i--) {
        if (recent[i].at >= sinceMs) { serveUrl(data.reqId, recent[i].url); return; }
      }
      var reqId = data.reqId;
      var w = {
        sinceMs: sinceMs,
        reqId: reqId,
        timer: setTimeout(function () {
          for (var j = 0; j < waiters.length; j++) {
            if (waiters[j].reqId === reqId) { waiters.splice(j, 1); break; }
          }
          reply(reqId, { error: 'no_audio' });
        }, Math.max(1000, Number(data.waitMs) || 8000))
      };
      waiters.push(w);
      return;
    }

    // Diagnostics, used by the content script when everything else has failed.
    if (data.type === 'STATS') {
      window.postMessage({
        source: 'wa-vt-page', type: 'BLOB_DATA', reqId: data.reqId,
        stats: { capturedAudioBlobs: blobs.size, recentUrls: recent.length, waiting: waiters.length }
      }, '*');
      return;
    }
  });
})();
