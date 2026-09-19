/**
 * WA Voice Transcribe — content.js (ISOLATED world)
 *
 * Watches the WhatsApp Web DOM, injects the "Transcribe" link on every voice
 * message, retrieves the decrypted audio through inject.js and asks the service
 * worker for the transcript.
 *
 * Read-only on WhatsApp's DOM: the only write interaction is the play/pause
 * needed to make WhatsApp decrypt the audio. No message is ever sent.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // SELECTORS — the single place to maintain.
  //
  // WhatsApp Web's CSS classes are hashes that change often, so nothing here
  // depends on them: only the data-id attribute, element tags, ARIA roles and —
  // as a last resort — aria-label text. If the extension stops working, the fix
  // almost always starts here.
  // ---------------------------------------------------------------------------
  var SELECTORS = {
    main: '#main',
    messageRow: '[data-id]',
    audio: 'audio',
    video: 'video',
    waveform: 'canvas',
    avatar: 'img',
    labelled: '[aria-label]',
    control: 'button, [role="button"]',
    own: '.wa-vt-action',
    // LAST RESORT, not the primary criterion.
    // aria-labels change with WhatsApp's interface language, and there are about
    // sixty of those: covering six means finding nothing in all the others, and
    // the link would not appear at all. These are kept only so already-known
    // languages do not regress if the structural search fails.
    // The accented variants sit outside \b: in JS \b is ASCII-only and would not
    // recognise the boundary before "é".
    labelHints: /\b(play|lire|lecture|tocar|abspielen|wiedergabe)\b|riprodu|reprodu|ecouter|écouter|paus/i
  };

  /**
   * Localized text. Falling back to the key avoids a mute UI if the extension
   * context has been invalidated by a reload.
   */
  function t(key, subs) {
    try { return chrome.i18n.getMessage(key, subs) || key; } catch (_) { return key; }
  }

  var CACHE_PREFIX = 't:';
  var DAY_MS = 86400000;
  var DEBOUNCE_MS = 300;
  var BLOB_WAIT_MS = 8000;       // how long we wait for the audio to start
  var BRIDGE_TIMEOUT_MS = 10000; // how long we wait for inject.js to answer
  var RETARGET_MS = 2000;        // watchdog that re-attaches the observer to #main
  var MIN_BUBBLE_WIDTH = 120;    // narrower than this is a control, not a bubble

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /**
   * Finds the playback control without reading any label.
   *
   * The structure is the same in every language: the control sits in the player
   * box next to the waveform, and precedes it in DOM order because it is drawn
   * to its left.
   */
  function findControl(row) {
    var wave = row.querySelector(SELECTORS.waveform);

    if (wave) {
      // Nearest ancestor of the waveform that contains a control.
      var box = wave.parentElement;
      while (box && box !== row && !box.querySelector(SELECTORS.control)) {
        box = box.parentElement;
      }

      if (box && box !== row) {
        var found = box.querySelectorAll(SELECTORS.control);
        var first = null;
        for (var i = 0; i < found.length; i++) {
          var el = found[i];
          if (el.closest(SELECTORS.own)) continue;   // never our own buttons
          if (!first) first = el;
          if (wave.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) return el;
        }
        if (first) return first;
      }
    }

    // Unexpected structure: labels, limited coverage and all, still beat nothing.
    var candidates = row.querySelectorAll(SELECTORS.labelled);
    for (var j = 0; j < candidates.length; j++) {
      var label = (candidates[j].getAttribute('aria-label') || '').trim();
      if (label && SELECTORS.labelHints.test(label)) return candidates[j];
    }
    return null;
  }

  function isVoiceRow(row) {
    // A video also has a playback control: without this guard the programmatic
    // click in getAudioDataUrl would start playing the video.
    if (row.querySelector(SELECTORS.video)) return false;
    if (row.querySelector(SELECTORS.audio)) return true;
    // BOTH are required: an animated sticker can have a canvas but no playback
    // control.
    return !!row.querySelector(SELECTORS.waveform) && !!findControl(row);
  }

  /**
   * The player box: the ancestor of the playback control that also holds the
   * waveform (the <canvas>). This is a STRUCTURAL criterion, which is why it is
   * the primary one: it works even on a row that has not been laid out yet,
   * when background colour and width are not yet known.
   */
  function findPlayerBox(row, anchor) {
    var el = anchor;
    while (el && el !== row && !el.querySelector(SELECTORS.waveform)) {
      el = el.parentElement;
    }
    if (!el || el === row) return null;

    // The avatar may live in an outer container, side by side with a column
    // holding the player and the duration. Stopping at that column would put the
    // transcript BESIDE the avatar: narrow text, avatar vertically centred next
    // to it. Keep climbing until the avatar is included, so the text takes the
    // full width and flows underneath it, as the native UI does.
    if (row.querySelector(SELECTORS.avatar)) {
      while (el.parentElement && el.parentElement !== row &&
             !el.querySelector(SELECTORS.avatar)) {
        el = el.parentElement;
      }
    }
    return el;
  }

  /**
   * Picks the container to inject the UI into.
   *
   * 1. The player box's parent: the transcript lines up exactly with the player
   *    and stays inside the bubble. No dependency on layout.
   * 2. Style fallback: nearest ancestor with its own background and rounded
   *    corners. This needs the row to be laid out already — before that, width
   *    and colour are unavailable and the check fails.
   * 3. Last resort: the row's direct child. As wide as the whole conversation,
   *    so best avoided: it is what used to push the link outside the bubble on
   *    messages rendered off-screen.
   */
  function findBubble(row, anchor) {
    var player = findPlayerBox(row, anchor);
    if (player && player.parentElement && player.parentElement !== row) {
      return player.parentElement;
    }

    var el = anchor && anchor.parentElement;
    var fallback = null;
    while (el && el !== row) {
      if (el.parentElement === row) fallback = el;
      if (looksLikeBubble(el)) return el;
      el = el.parentElement;
    }
    return fallback || row;
  }

  function looksLikeBubble(el) {
    try {
      // Too narrow to be a bubble: this is an inner control.
      if (el.getBoundingClientRect().width < MIN_BUBBLE_WIDTH) return false;
      var cs = getComputedStyle(el);
      var bg = (cs.backgroundColor || '').replace(/\s+/g, '');
      if (!bg || bg === 'transparent' || /^rgba\(\d+,\d+,\d+,0\)$/.test(bg)) return false;
      return parseFloat(cs.borderTopLeftRadius) > 0;
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Cache (chrome.storage.local, keys "t:<msgId>")
  // ---------------------------------------------------------------------------

  // Retention, kept in memory so we do not add a storage read per row. It is
  // re-read whenever the options change.
  var ttlMs = 0;

  function loadTtl() {
    try {
      chrome.storage.local.get({ ttlDays: 0 })
        .then(function (cfg) { ttlMs = (Number(cfg.ttlDays) || 0) * DAY_MS; })
        .catch(function () { /* stays 0 = keep forever */ });
    } catch (_) { /* context invalidated */ }
  }

  loadTtl();
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes.ttlDays) {
        ttlMs = (Number(changes.ttlDays.newValue) || 0) * DAY_MS;
      }
    });
  } catch (_) { /* ignore */ }

  // Note: after an extension reload the content script's context is invalidated
  // and `chrome.storage` can throw SYNCHRONOUSLY, i.e. before a .catch() is even
  // attached. The try/catch here keeps that exception from reaching scan() and
  // breaking its loop.
  function cacheGet(msgId) {
    var key = CACHE_PREFIX + msgId;
    try {
      return chrome.storage.local.get(key)
        .then(function (res) {
          var entry = res[key];
          if (!entry) return null;

          // Entries written before expiry existed: a bare string, no timestamp.
          // Stamp them now rather than throw them away.
          if (typeof entry === 'string') {
            cacheSet(msgId, entry);
            return entry;
          }
          if (typeof entry.text !== 'string') return null;

          if (ttlMs > 0 && entry.at && (Date.now() - entry.at) > ttlMs) {
            try { chrome.storage.local.remove(key).catch(function () {}); } catch (_) {}
            return null;
          }
          return entry.text;
        })
        .catch(function () { return null; });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function cacheSet(msgId, text) {
    var payload = {};
    payload[CACHE_PREFIX + msgId] = { text: text, at: Date.now() };
    try {
      return chrome.storage.local.set(payload).catch(function () { /* non blocking */ });
    } catch (_) {
      return Promise.resolve();
    }
  }

  // ---------------------------------------------------------------------------
  // Bridge to inject.js (MAIN world)
  // ---------------------------------------------------------------------------

  function bridge(type, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var reqId = 'r' + Date.now() + '_' + Math.random().toString(36).slice(2);

      var timer = setTimeout(function () {
        window.removeEventListener('message', onMsg);
        reject(new Error(t('errPageNoResponse')));
      }, timeoutMs || BRIDGE_TIMEOUT_MS);

      function onMsg(event) {
        if (event.source !== window) return;
        var d = event.data;
        if (!d || d.source !== 'wa-vt-page' || d.type !== 'BLOB_DATA' || d.reqId !== reqId) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (d.error) {
          reject(new Error(d.error === 'no_audio'
            ? t('errPlaybackDidNotStart')
            : t('errAudioUnavailable')));
        } else {
          resolve(d.stats !== undefined ? d.stats : d.dataUrl);
        }
      }

      window.addEventListener('message', onMsg);
      var msg = { source: 'wa-vt', type: type, reqId: reqId };
      if (payload) {
        for (var k in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
        }
      }
      window.postMessage(msg, '*');
    });
  }

  /**
   * Returns the data URL of the voice note's audio.
   *
   * WhatsApp NEVER inserts the audio element into the DOM: it uses a detached
   * `new Audio()`, invisible to any querySelector. So we look for no <audio> at
   * all: we start playback and ask inject.js — which is hooked into
   * HTMLMediaElement.prototype — for the first audio blob that started playing
   * after that instant. The causal link with our own click is what guarantees it
   * is THIS message's audio.
   */
  function getAudioDataUrl(row) {
    var control = findControl(row);
    if (!control) {
      return Promise.reject(new Error(t('errNoControl')));
    }

    return isPlaying()
      .then(function (playing) {
        // If it is already playing, our click would pause it instead of
        // producing an observable play(): stop it first.
        if (!playing) return null;
        try { control.click(); } catch (_) { /* ignore */ }
        return sleep(200);
      })
      .then(function () {
        // Tell inject.js the next play() is ours: it must be muted and stopped
        // at once, so nothing is audible.
        window.postMessage({ source: 'wa-vt', type: 'ARM', ttlMs: BLOB_WAIT_MS }, '*');

        var t0 = Date.now();
        try { control.click(); } catch (_) { /* ignore */ }
        return bridge('GET_SINCE', { sinceMs: t0, waitMs: BLOB_WAIT_MS }, BLOB_WAIT_MS + 2000);
      })
      .then(function (dataUrl) {
        return stopPlayback(control).then(function () { return dataUrl; });
      })
      .catch(function (err) {
        return stopPlayback(control).then(function () { throw err; });
      });
  }

  /**
   * Is it playing? inject.js knows, because it owns the audio element.
   * WhatsApp's DOM would only say so through aria-label, which changes with the
   * interface language.
   */
  function isPlaying() {
    return bridge('IS_PLAYING', null, 2000)
      .then(function (state) { return !!(state && state.playing); })
      .catch(function () { return false; });
  }

  /** Safety net: if playback is still running, stop it. */
  function stopPlayback(control) {
    return isPlaying().then(function (playing) {
      if (!playing || !control) return;
      // Click the control rather than pausing the element behind WhatsApp's
      // back, so its interface stays consistent with the real state.
      try { control.click(); } catch (_) { /* ignore */ }
    });
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * UI states, modelled on WhatsApp's own transcript UI:
   *
   *   idle       green "Transcribe" link
   *   loading    spinner + dimmed "Transcribing…"
   *   done       the text in quotes, like a normal message, plus a dimmed row of
   *              actions underneath
   *   collapsed  green "Show transcript" link
   *   error      dimmed red message + green "Retry" link
   */
  function setState(ui, state) {
    var idle = state === 'idle';
    var loading = state === 'loading';
    var done = state === 'done';
    var collapsed = state === 'collapsed';
    var error = state === 'error';

    ui.state = state;
    ui.main.hidden = !(idle || collapsed || error);
    ui.status.hidden = !(loading || error);
    ui.spinner.hidden = !loading;
    ui.text.hidden = !done;
    ui.foot.hidden = !done;
    ui.status.classList.toggle('wa-vt-err', error);

    if (idle) ui.main.textContent = t('actionTranscribe');
    else if (collapsed) ui.main.textContent = t('actionShow');
    else if (error) ui.main.textContent = t('actionRetry');
  }

  function renderLoading(ui) {
    ui.statusText.textContent = t('statusWorking');
    setState(ui, 'loading');
  }

  function renderText(ui, text, scroll) {
    ui.value = text;
    // Typographic quotes around the text, the way WhatsApp does it.
    ui.text.textContent = '“' + text + '”';
    ui.copy.textContent = t('actionCopy');
    setState(ui, 'done');
    if (scroll) bringIntoView(ui.text);
  }

  function renderError(ui, message, needsKey) {
    ui.value = '';
    ui.statusText.textContent = message;

    if (needsKey) {
      ui.statusText.appendChild(document.createTextNode(' '));
      var a = document.createElement('button');
      a.type = 'button';
      a.className = 'wa-vt-action';
      a.textContent = t('actionOpenOptions');
      a.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        try { chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }); } catch (_) { /* ignore */ }
      });
      ui.statusText.appendChild(a);
    }

    setState(ui, 'error');
  }

  /**
   * Brings the transcript into view after a user action.
   *
   * `block: 'nearest'` scrolls the minimum necessary and does nothing when the
   * block is already visible, so the conversation never moves without reason.
   *
   * Call this ONLY on user actions: calling it from the automatic re-render out
   * of the cache would make the conversation jump every time an already
   * transcribed row scrolls back into view.
   */
  function bringIntoView(el) {
    try {
      el.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        // In a hidden document the animated scroll never advances and would sit
        // still, so in that case jump straight to the position.
        behavior: document.hidden ? 'auto' : 'smooth'
      });
    } catch (_) {
      try { el.scrollIntoView(false); } catch (__) { /* ignore */ }
    }
  }

  function flashCopy(copy, message) {
    copy.textContent = message;
    clearTimeout(copy._waVtTimer);
    copy._waVtTimer = setTimeout(function () { copy.textContent = t('actionCopy'); }, 1600);
  }

  /**
   * navigator.clipboard needs a focused document and a user gesture: the click
   * satisfies that, but WhatsApp may move focus. Hence the execCommand fallback,
   * which uses an off-screen textarea removed immediately afterwards (the only
   * DOM insertion, and outside the message tree).
   */
  function copyToClipboard(text) {
    return new Promise(function (resolve, reject) {
      function fallback() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.top = '-1000px';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          ta.remove();
          if (ok) resolve(); else reject(new Error('copy_failed'));
        } catch (err) {
          reject(err);
        }
      }

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(resolve, fallback);
          return;
        }
      } catch (_) { /* fall through to the fallback */ }
      fallback();
    });
  }

  // ---------------------------------------------------------------------------
  // Click flow
  // ---------------------------------------------------------------------------

  function onTranscribeClick(row, msgId, ui) {
    if (ui.busy) return;

    // Panel collapsed but the text is already in memory: reopen immediately.
    if (ui.value && ui.state === 'collapsed') { renderText(ui, ui.value, true); return; }

    ui.busy = true;
    renderLoading(ui);

    cacheGet(msgId)
      .then(function (cached) {
        // Cache hit: no network call.
        if (cached) { renderText(ui, cached, true); return null; }

        return getAudioDataUrl(row)
          .then(function (dataUrl) {
            var comma = dataUrl.indexOf(',');
            if (comma < 0) throw new Error(t('errBadAudioFormat'));
            var header = dataUrl.slice(0, comma);
            var base64 = dataUrl.slice(comma + 1);
            var m = header.match(/^data:([^;,]+)/);
            var mime = m ? m[1] : 'audio/ogg';
            return chrome.runtime.sendMessage({
              type: 'TRANSCRIBE', base64: base64, mime: mime, msgId: msgId
            });
          })
          .then(function (res) {
            if (!res) throw new Error(t('errNoExtensionResponse'));
            if (!res.ok) { renderError(ui, res.error, !!res.needsKey); return null; }
            renderText(ui, res.text, true);
            return cacheSet(msgId, res.text);
          });
      })
      .catch(function (err) {
        renderError(ui, (err && err.message) ? err.message : String(err), false);
      })
      .then(function () { ui.busy = false; });
  }

  // ---------------------------------------------------------------------------
  // UI injection
  // ---------------------------------------------------------------------------

  function inject(row, msgId) {
    var anchor = row.querySelector(SELECTORS.audio) || findControl(row);
    var bubble = findBubble(row, anchor);

    var wrap = document.createElement('div');
    wrap.className = 'wa-vt-wrap';

    // Green link with no chrome: this is how the native "Transcribe" looks.
    var main = document.createElement('button');
    main.type = 'button';
    main.className = 'wa-vt-action wa-vt-main';

    var status = document.createElement('div');
    status.className = 'wa-vt-status';
    var spinner = document.createElement('span');
    spinner.className = 'wa-vt-spinner';
    var statusText = document.createElement('span');
    status.appendChild(spinner);
    status.appendChild(statusText);

    var text = document.createElement('div');
    text.className = 'wa-vt-text';

    var foot = document.createElement('div');
    foot.className = 'wa-vt-foot';
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'wa-vt-action wa-vt-copy';
    copy.textContent = t('actionCopy');
    var sep = document.createElement('span');
    sep.className = 'wa-vt-sep';
    sep.textContent = '·';
    var hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'wa-vt-action wa-vt-hide';
    hide.textContent = t('actionHide');
    foot.appendChild(copy);
    foot.appendChild(sep);
    foot.appendChild(hide);

    wrap.appendChild(main);
    wrap.appendChild(status);
    wrap.appendChild(text);
    wrap.appendChild(foot);
    bubble.appendChild(wrap);

    // `value` holds the transcript alone: `text` shows it in quotes, and in the
    // error state `status` contains something else entirely.
    var ui = {
      main: main, status: status, spinner: spinner, statusText: statusText,
      text: text, foot: foot, copy: copy, hide: hide,
      value: '', state: 'idle', busy: false
    };
    setState(ui, 'idle');

    main.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onTranscribeClick(row, msgId, ui);
    });

    copy.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!ui.value) return;
      copyToClipboard(ui.value)
        .then(function () { flashCopy(copy, t('actionCopied')); })
        .catch(function () { flashCopy(copy, t('actionCopyFailed')); });
    });

    hide.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      // Does not touch the cache: `value` stays, and "Show transcript" reopens it
      // instantly.
      setState(ui, 'collapsed');
    });

    // If this voice note was transcribed before, re-render from the cache:
    // without this the text would vanish every time WhatsApp rebuilds the row.
    cacheGet(msgId).then(function (cached) {
      if (cached && wrap.isConnected) renderText(ui, cached);
    });
  }

  function removeUi(row) {
    var stale = row.querySelectorAll('.wa-vt-wrap');
    for (var i = 0; i < stale.length; i++) stale[i].remove();
  }

  // ---------------------------------------------------------------------------
  // Scanning and observation
  // ---------------------------------------------------------------------------

  function scan() {
    var root = document.querySelector(SELECTORS.main) || document.body;
    var rows = root.querySelectorAll(SELECTORS.messageRow);

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var msgId = row.getAttribute('data-id');
      if (!msgId) continue;

      // Idempotence: WhatsApp recycles nodes during virtual scrolling, so a
      // boolean flag would linger on a row that now holds a DIFFERENT message.
      // We compare the stored id with the current one, and check the UI is still
      // attached (WhatsApp may have removed it while rebuilding the row's
      // children).
      if (row.dataset.waVtId === msgId && row.querySelector('.wa-vt-wrap')) continue;
      if (!isVoiceRow(row)) continue;

      removeUi(row);
      row.dataset.waVtId = msgId;
      inject(row, msgId);
    }
  }

  var scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, DEBOUNCE_MS);
  }

  var observer = null;
  var observed = null;

  function observe(target) {
    if (observed === target) return;
    if (observer) observer.disconnect();
    observer = new MutationObserver(scheduleScan);
    // attributeFilter on data-id is essential: when recycling a node WhatsApp
    // may replace just that attribute, leaving the children alone. With
    // childList only, the scan would not re-run and the previous message's
    // transcript would stay attached to a different voice note.
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-id']
    });
    observed = target;
    scheduleScan();
  }

  function retarget() {
    // #main does not exist until a chat is open, and is removed/recreated on
    // every chat switch: without a watchdog the observer would stay attached to
    // a detached node and never fire again.
    observe(document.querySelector(SELECTORS.main) || document.body);
  }

  retarget();
  setInterval(retarget, RETARGET_MS);
})();
