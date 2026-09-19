/**
 * WA Voice Transcribe — settings.js
 *
 * Shared by the service worker and the options page, so both read and write the
 * stored settings through exactly one implementation.
 *
 * It lives apart from `background.js` on purpose: importing the service worker
 * from the options page would re-register its event listeners.
 */

import { PROVIDERS, DEFAULT_PROVIDER } from './providers.js';

/**
 * Brings stored settings into the current shape.
 *
 * Pure and exported so it can be tested on its own: a mistake here silently
 * drops the API key of someone who already had the extension installed, and they
 * would just see it stop working.
 *
 * Before 2.1 the layout was flat and Groq-only — `apiKey` and `model` sat at the
 * top level. Those values are copied into `providers.groq`; the old keys are
 * left where they are rather than deleted, so a downgrade still finds them.
 */
export function normalizeSettings(raw) {
  const source = raw || {};
  const providers = {};

  for (const id of Object.keys(PROVIDERS)) {
    const stored = (source.providers && source.providers[id]) || {};
    providers[id] = {
      apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
      model: (typeof stored.model === 'string' && stored.model) ? stored.model : PROVIDERS[id].defaultModel,
      baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : ''
    };
  }

  // No `providers` object at all means this storage predates the multi-provider
  // layout. Anything at the top level belongs to Groq, the only provider then.
  const migrated = !source.providers;
  if (migrated) {
    if (typeof source.apiKey === 'string' && source.apiKey) providers.groq.apiKey = source.apiKey;
    if (typeof source.model === 'string' && source.model) providers.groq.model = source.model;
  }

  const engine = Object.prototype.hasOwnProperty.call(PROVIDERS, source.engine)
    ? source.engine
    : DEFAULT_PROVIDER;

  return {
    engine,
    language: typeof source.language === 'string' ? source.language : '',
    ttlDays: Number(source.ttlDays) || 0,
    providers,
    migrated
  };
}

/** Reads the settings, persisting the normalized shape the first time. */
export async function readSettings() {
  const raw = await chrome.storage.local.get(null);
  const settings = normalizeSettings(raw);
  if (settings.migrated) {
    await chrome.storage.local.set({ providers: settings.providers, engine: settings.engine });
  }
  return settings;
}

/** Writes back everything except the transcript cache, which uses its own keys. */
export async function writeSettings(settings) {
  await chrome.storage.local.set({
    engine: settings.engine,
    language: settings.language,
    ttlDays: settings.ttlDays,
    providers: settings.providers
  });
}
