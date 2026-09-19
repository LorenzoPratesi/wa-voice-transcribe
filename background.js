/**
 * WA Voice Transcribe — background.js (MV3 service worker)
 *
 * Receives the base64 audio from the content script and forwards it to the
 * configured transcription engine. A Blob does not survive the JSON
 * serialization of chrome.runtime.sendMessage, which is why the transport is
 * base64.
 */
'use strict';

var GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
var MAX_BYTES = 25 * 1024 * 1024; // Groq free tier limit

var DEFAULTS = {
  engine: 'groq',
  apiKey: '',
  // Empty = Whisper's automatic detection. A fixed default would force speakers
  // of any other language to discover the option before it works for them.
  language: '',
  model: 'whisper-large-v3-turbo'
};

/** Localized text, falling back to the key. */
function t(key, subs) {
  try { return chrome.i18n.getMessage(key, subs) || key; } catch (_) { return key; }
}

var CACHE_PREFIX = 't:';
var DAY_MS = 86400000;
var SWEEP_ALARM = 'wa-vt-sweep';

// -----------------------------------------------------------------------------
// Pluggable interface
// -----------------------------------------------------------------------------

/**
 * Contract for a transcription engine.
 * Adding one (a local engine, say) means implementing this class and registering
 * it in ENGINES: the content script needs no changes.
 */
class TranscriptionEngine {
  constructor(config) {
    this.config = config;
  }

  /** @returns {Promise<string>} the transcribed text */
  async transcribe({ base64, mime, language }) { // eslint-disable-line no-unused-vars
    throw new Error(t('errEngineNotImplemented'));
  }
}

class GroqEngine extends TranscriptionEngine {
  async transcribe({ base64, mime, language }) {
    const apiKey = (this.config.apiKey || '').trim();
    if (!apiKey) throw keyError(t('errNoApiKey'));

    const bytes = base64ToBytes(base64);
    if (bytes.byteLength > MAX_BYTES) {
      throw new Error(t('errAudioTooLargeLocal', [mb(bytes.byteLength)]));
    }

    // WhatsApp voice notes are native OGG/Opus, accepted by the API as-is: no
    // conversion needed. Billing has a 10 second minimum per request, so a voice
    // note is always sent whole and never split into chunks.
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime || 'audio/ogg' }), 'audio.ogg');
    form.append('model', this.config.model || DEFAULTS.model);
    // Empty language = no `language` field at all, i.e. Whisper auto-detection.
    const lang = (language !== undefined ? language : this.config.language) || '';
    if (lang) form.append('language', lang);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    let res;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey },
        body: form
      });
    } catch (_) {
      throw new Error(t('errNetwork'));
    }

    if (!res.ok) throw await httpError(res);

    let data;
    try {
      data = await res.json();
    } catch (_) {
      throw new Error(t('errBadResponse'));
    }

    const text = (data && typeof data.text === 'string') ? data.text.trim() : '';
    if (!text) throw new Error(t('errEmptyTranscription'));
    return text;
  }
}

const ENGINES = { groq: GroqEngine };

async function getEngine() {
  const config = await chrome.storage.local.get(DEFAULTS);
  const Engine = ENGINES[config.engine] || ENGINES[DEFAULTS.engine];
  return new Engine(config);
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

function keyError(message) {
  const err = new Error(message);
  err.needsKey = true;
  return err;
}

async function httpError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = (body && body.error && body.error.message) ? body.error.message : '';
  } catch (_) { /* body was not JSON */ }

  if (res.status === 401 || res.status === 403) {
    return keyError(t('errBadApiKey'));
  }
  if (res.status === 429) {
    // Free tier: 20 requests/minute, 2,000/day, 7,200 s audio/hour, 28,800 s/day.
    return new Error(t('errRateLimit'));
  }
  if (res.status === 413) {
    return new Error(t('errAudioTooLarge'));
  }
  return new Error(t('errHttp', [String(res.status), detail ? ': ' + detail : '.']));
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function base64ToBytes(base64) {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

// -----------------------------------------------------------------------------
// Transcript expiry
// -----------------------------------------------------------------------------

/**
 * Removes transcripts older than the configured retention (`ttlDays`, where
 * 0 means keep forever).
 *
 * The content script already discards expired entries when it meets them, but
 * only on read: an entry in a chat that is never reopened would sit in storage
 * forever. This sweep removes it anyway.
 *
 * Entries written before expiry existed are bare strings with no timestamp: they
 * get stamped now rather than thrown away.
 */
async function sweepCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const ttlDays = Number(all.ttlDays) || 0;
    const now = Date.now();
    const toRemove = [];
    const toStamp = {};

    for (const key of Object.keys(all)) {
      if (key.indexOf(CACHE_PREFIX) !== 0) continue;
      const v = all[key];

      if (typeof v === 'string') { toStamp[key] = { text: v, at: now }; continue; }
      if (!v || typeof v.text !== 'string') { toRemove.push(key); continue; }
      if (ttlDays > 0 && v.at && (now - v.at) > ttlDays * DAY_MS) toRemove.push(key);
    }

    if (Object.keys(toStamp).length) await chrome.storage.local.set(toStamp);
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
    return { removed: toRemove.length, stamped: Object.keys(toStamp).length };
  } catch (_) {
    return { removed: 0, stamped: 0 };
  }
}

function scheduleSweep() {
  try { chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 720 }); } catch (_) { /* ignore */ }
}

chrome.runtime.onInstalled.addListener(function () { scheduleSweep(); sweepCache(); });
chrome.runtime.onStartup.addListener(function () { scheduleSweep(); sweepCache(); });
chrome.alarms.onAlarm.addListener(function (a) { if (a.name === SWEEP_ALARM) sweepCache(); });

// -----------------------------------------------------------------------------
// Messaging
// -----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return undefined;

  // chrome.runtime.openOptionsPage() cannot be called from a content script:
  // it has to go through here.
  if (msg.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return undefined;
  }

  // Used by the options page after a retention change, to apply it immediately.
  if (msg.type === 'SWEEP') {
    sweepCache().then(sendResponse);
    return true;
  }

  if (msg.type === 'TRANSCRIBE') {
    (async () => {
      try {
        const engine = await getEngine();
        const text = await engine.transcribe({ base64: msg.base64, mime: msg.mime });
        sendResponse({ ok: true, text });
      } catch (err) {
        sendResponse({
          ok: false,
          error: (err && err.message) ? err.message : t('errBadResponse'),
          needsKey: !!(err && err.needsKey)
        });
      }
    })();
    return true; // keep the response channel open: the call is asynchronous
  }

  return undefined;
});
