/**
 * WA Voice Transcribe — background.js (MV3 service worker)
 *
 * Receives the base64 audio from the content script and forwards it to the
 * configured transcription engine. A Blob does not survive the JSON
 * serialization of chrome.runtime.sendMessage, which is why the transport is
 * base64.
 *
 * Declared as a module in the manifest so it can share `providers.js` with the
 * options page without a build step.
 */

import { DEFAULT_PROVIDER, providerOf, normalizeBaseUrl } from './providers.js';
import { readSettings } from './settings.js';

/** Localized text, falling back to the key. */
function t(key, subs) {
  try { return chrome.i18n.getMessage(key, subs) || key; } catch (_) { return key; }
}

const CACHE_PREFIX = 't:';
const DAY_MS = 86400000;
const SWEEP_ALARM = 'wa-vt-sweep';

// -----------------------------------------------------------------------------
// Pluggable interface
// -----------------------------------------------------------------------------

/**
 * Contract for a transcription engine.
 * Adding one means implementing this class and registering it in ENGINES: the
 * content script needs no changes.
 */
export class TranscriptionEngine {
  constructor(config) {
    this.config = config;
  }

  /** @returns {Promise<string>} the transcribed text */
  async transcribe({ base64, mime, language }) { // eslint-disable-line no-unused-vars
    throw new Error(t('errEngineNotImplemented'));
  }
}

/**
 * Anything that speaks the OpenAI audio transcription API: Groq, OpenAI, and any
 * self-hosted compatible server. The only difference between them is the base
 * URL, so there is one class rather than one per provider.
 *
 * `config` carries { baseUrl, apiKey, model, language, maxBytes }.
 */
export class OpenAICompatibleEngine extends TranscriptionEngine {
  async transcribe({ base64, mime, language }) {
    const apiKey = (this.config.apiKey || '').trim();
    if (!apiKey) throw keyError(t('errNoApiKey'));

    const baseUrl = (this.config.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) throw new Error(t('errNoBaseUrl'));

    const maxBytes = this.config.maxBytes || 25 * 1024 * 1024;
    const bytes = base64ToBytes(base64);
    if (bytes.byteLength > maxBytes) {
      throw new Error(t('errAudioTooLargeLocal', [mb(bytes.byteLength), mb(maxBytes)]));
    }

    // WhatsApp voice notes are native OGG/Opus, accepted by the API as-is: no
    // conversion needed. Billing has a 10 second minimum per request, so a voice
    // note is always sent whole and never split into chunks.
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime || 'audio/ogg' }), 'audio.ogg');
    form.append('model', this.config.model || '');
    // Empty language = no `language` field at all, i.e. automatic detection.
    const lang = (language !== undefined ? language : this.config.language) || '';
    if (lang) form.append('language', lang);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    let res;
    try {
      res = await fetch(baseUrl + '/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey },
        body: form
      });
    } catch (_) {
      // A missing host permission also surfaces here, as a failed fetch.
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

// Every preset speaks the same protocol today. The registry stays because it is
// the documented place to plug in a provider that does not — Deepgram and
// AssemblyAI have their own request and response shapes.
const ENGINES = {
  groq: OpenAICompatibleEngine,
  openai: OpenAICompatibleEngine,
  openrouter: OpenAICompatibleEngine,
  custom: OpenAICompatibleEngine
};

/** Flattens the stored settings into the config the active engine expects. */
export function engineConfig(settings) {
  const id = settings.engine;
  const provider = providerOf(id);
  const stored = settings.providers[id] || {};
  const baseUrl = provider.baseUrl || normalizeBaseUrl(stored.baseUrl).url || '';

  return {
    id,
    baseUrl,
    apiKey: stored.apiKey || '',
    model: stored.model || provider.defaultModel,
    language: settings.language || '',
    maxBytes: provider.maxBytes
  };
}

async function getEngine() {
  const settings = await readSettings();
  const Engine = ENGINES[settings.engine] || ENGINES[DEFAULT_PROVIDER];
  return new Engine(engineConfig(settings));
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

function keyError(message) {
  const err = new Error(message);
  err.needsKey = true;
  return err;
}

export async function httpError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = (body && body.error && body.error.message) ? body.error.message : '';
  } catch (_) { /* body was not JSON */ }

  if (res.status === 401 || res.status === 403) {
    return keyError(t('errBadApiKey'));
  }
  if (res.status === 429) {
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
export async function sweepCache() {
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

chrome.runtime.onInstalled.addListener(function () {
  scheduleSweep();
  // Migrate as soon as the update lands, not on the first transcription.
  readSettings().catch(function () { /* ignore */ });
  sweepCache();
});
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
