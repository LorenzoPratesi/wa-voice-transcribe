/**
 * WA Voice Transcribe — options.js
 *
 * Loaded as a module so it can share `providers.js` and `settings.js` with the
 * service worker: the provider list and the storage shape exist in one place.
 */

import { PROVIDERS, providerOf, normalizeBaseUrl, originFor } from './providers.js';
import { normalizeSettings, writeSettings } from './settings.js';

const CACHE_PREFIX = 't:';

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

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

// The whole settings object is kept in memory while the page is open. That is
// what lets every provider hold on to its own key: switching the selector swaps
// which one is displayed, it does not overwrite the others.
let settings = null;

function currentProvider() {
  return providerOf($('provider').value);
}

/** Copies what is on screen back into the in-memory provider entry. */
function captureProvider(id) {
  const entry = settings.providers[id];
  if (!entry) return;
  entry.apiKey = $('apiKey').value.trim();
  entry.model = PROVIDERS[id].models.length ? $('model').value : $('modelCustom').value.trim();
  if (id === 'custom') entry.baseUrl = $('baseUrl').value.trim();
}

/** Renders the fields for the selected provider. */
function showProvider(id) {
  const provider = providerOf(id);
  const entry = settings.providers[id] || { apiKey: '', model: '', baseUrl: '' };
  const isCustom = !provider.models.length;

  $('apiKey').value = entry.apiKey || '';

  // The key link points at the chosen provider's console; a self-hosted server
  // has none, so the whole line goes away rather than linking somewhere wrong.
  if (provider.keysUrl) {
    $('apiKeyHelp').hidden = false;
    $('keysLink').href = provider.keysUrl;
    $('keysLink').textContent = provider.keysUrl.replace(/^https?:\/\//, '');
  } else {
    $('apiKeyHelp').hidden = true;
  }

  $('baseUrlRow').hidden = id !== 'custom';
  $('baseUrl').value = entry.baseUrl || '';

  $('model').hidden = isCustom;
  $('modelCustom').hidden = !isCustom;
  if (isCustom) {
    $('modelCustom').value = entry.model || '';
    $('modelCustom').placeholder = t('optModelPlaceholder');
  } else {
    $('model').innerHTML = '';
    for (const name of provider.models) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      $('model').appendChild(option);
    }
    $('model').value = provider.models.includes(entry.model) ? entry.model : provider.defaultModel;
  }

  refreshPermission();
}

// -----------------------------------------------------------------------------
// Host permission
// -----------------------------------------------------------------------------

/**
 * Providers other than the default are optional host permissions, so the
 * extension cannot reach them until the user grants access. Without this notice
 * a wrong provider would just fail with a network error and no explanation.
 */
async function refreshPermission() {
  const id = $('provider').value;
  const origin = originFor(id, $('baseUrl').value);

  if (!origin) {
    // Custom provider with no usable URL yet: nothing to ask for.
    $('permRow').hidden = true;
    return;
  }

  let granted = false;
  try {
    granted = await chrome.permissions.contains({ origins: [origin] });
  } catch (_) { /* treated as not granted */ }

  $('permRow').hidden = granted;
  if (!granted) $('permText').textContent = t('optAccessNeeded') + ' ' + origin.replace(/\/\*$/, '');
}

$('grant').addEventListener('click', async () => {
  const id = $('provider').value;
  const origin = originFor(id, $('baseUrl').value);
  if (!origin) return;

  try {
    // Must be called straight from the click: Chrome requires a user gesture.
    const granted = await chrome.permissions.request({ origins: [origin] });
    flash($('status'), granted ? t('optAccessGranted') : t('optAccessDenied'), !granted);
  } catch (err) {
    flash($('status'), err.message, true);
  }
  await refreshPermission();
});

// -----------------------------------------------------------------------------
// Cache
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Load and save
// -----------------------------------------------------------------------------

async function load() {
  const raw = await chrome.storage.local.get(null);
  settings = normalizeSettings(raw);

  $('provider').innerHTML = '';
  for (const id of Object.keys(PROVIDERS)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = PROVIDERS[id].label;   // a proper name, not translated
    $('provider').appendChild(option);
  }
  $('provider').value = settings.engine;

  $('language').value = settings.language || '';
  $('ttlDays').value = String(settings.ttlDays || 0);

  showProvider(settings.engine);
  await refreshCacheCount();
}

$('provider').addEventListener('change', (e) => {
  // Keep what was typed for the provider being left, so switching back finds it.
  captureProvider(settings.engine);
  settings.engine = e.target.value;
  showProvider(settings.engine);
});

$('baseUrl').addEventListener('input', () => {
  $('baseUrlHelp').classList.remove('err');
  $('baseUrlHelp').textContent = t('optBaseUrlHelp');
  refreshPermission();
});

$('save').addEventListener('click', async () => {
  const id = $('provider').value;
  captureProvider(id);

  // A custom provider with an unusable URL would fail later with an opaque
  // network error, so it is refused here where the field is in front of the user.
  if (id === 'custom') {
    const result = normalizeBaseUrl(settings.providers.custom.baseUrl);
    if (result.error) {
      $('baseUrlHelp').classList.add('err');
      $('baseUrlHelp').textContent =
        result.error === 'empty' ? t('optBaseUrlEmpty')
        : result.error === 'insecure' ? t('optBaseUrlInsecure')
        : t('optBaseUrlMalformed');
      $('baseUrl').focus();
      return;
    }
    settings.providers.custom.baseUrl = result.url;
    $('baseUrl').value = result.url;
  }

  settings.language = $('language').value.trim();
  settings.ttlDays = Number($('ttlDays').value) || 0;

  try {
    await writeSettings(settings);
    // Apply the new retention right away instead of waiting for the next sweep.
    try { await chrome.runtime.sendMessage({ type: 'SWEEP' }); } catch (_) { /* non blocking */ }
    await refreshCacheCount();
    await refreshPermission();

    const hasKey = !!settings.providers[id].apiKey;
    flash($('status'), hasKey ? t('optSaved') : t('optSavedNoKey'), !hasKey);
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
