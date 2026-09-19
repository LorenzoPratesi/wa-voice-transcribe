/**
 * WA Voice Transcribe — options.js
 */
'use strict';

const CACHE_PREFIX = 't:';

const DEFAULTS = {
  engine: 'groq',
  apiKey: '',
  // Empty = Whisper's automatic detection. A fixed default would force speakers
  // of any other language to discover the option before it works for them.
  language: '',
  model: 'whisper-large-v3-turbo',
  ttlDays: 0
};

const $ = (id) => document.getElementById(id);

/** Localized text, falling back to the key. */
function t(key, subs) {
  try { return chrome.i18n.getMessage(key, subs) || key; } catch (_) { return key; }
}

/**
 * `__MSG_…__` substitution works in the manifest and in CSS, but not in
 * arbitrary HTML: static text is marked with `data-i18n` and resolved here.
 */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const text = t(el.getAttribute('data-i18n'));
    if (text) el.textContent = text;
  });
}

function flash(el, message, isError) {
  el.textContent = message;
  el.classList.toggle('err', !!isError);
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2500);
}

async function cacheKeys() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
}

async function refreshCacheCount() {
  const keys = await cacheKeys();
  $('cacheCount').textContent =
    keys.length === 0 ? t('optCacheCountNone')
    : keys.length === 1 ? t('optCacheCountOne')
    : t('optCacheCountMany', [String(keys.length)]);
}

async function load() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  $('apiKey').value = cfg.apiKey || '';
  $('language').value = cfg.language || '';
  $('model').value = cfg.model || DEFAULTS.model;
  $('ttlDays').value = String(cfg.ttlDays || 0);
  await refreshCacheCount();
}

$('save').addEventListener('click', async () => {
  const apiKey = $('apiKey').value.trim();
  try {
    await chrome.storage.local.set({
      engine: DEFAULTS.engine,
      apiKey,
      language: $('language').value.trim(),
      model: $('model').value,
      ttlDays: Number($('ttlDays').value) || 0
    });
    // Apply the new retention right away instead of waiting for the next sweep.
    try { await chrome.runtime.sendMessage({ type: 'SWEEP' }); } catch (_) { /* non blocking */ }
    await refreshCacheCount();
    flash($('status'), apiKey ? t('optSaved') : t('optSavedNoKey'), !apiKey);
  } catch (err) {
    flash($('status'), t('optSaveFailed', [err.message]), true);
  }
});

$('clear').addEventListener('click', async () => {
  try {
    // Removes transcripts only (the "t:" prefix), never the settings.
    const keys = await cacheKeys();
    if (!keys.length) {
      flash($('cacheStatus'), t('optCacheAlreadyEmpty'));
      return;
    }
    await chrome.storage.local.remove(keys);
    flash($('cacheStatus'), t('optCacheCleared', [String(keys.length)]));
    await refreshCacheCount();
  } catch (err) {
    flash($('cacheStatus'), t('optClearFailed', [err.message]), true);
  }
});

applyI18n();
load();
