/**
 * WA Voice Transcribe — providers.js
 *
 * Single source of truth for the transcription providers, imported by both the
 * service worker and the options page so the list cannot drift apart.
 *
 * Every entry here speaks the OpenAI audio transcription API. That is not a
 * simplification: Groq's endpoint really is OpenAI-compatible
 * (`/openai/v1/audio/transcriptions`) — same multipart body, same bearer token,
 * same JSON response. Supporting another compatible service means adding a row,
 * not a class.
 *
 * `custom` has no fixed baseUrl or origin: the user supplies both, which is what
 * makes self-hosted servers (whisper.cpp, LM Studio, vLLM) work.
 */

export const PROVIDERS = {
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    origin: 'https://api.groq.com/*',
    keysUrl: 'https://console.groq.com/keys',
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    defaultModel: 'whisper-large-v3-turbo',
    maxBytes: 25 * 1024 * 1024
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    origin: 'https://api.openai.com/*',
    keysUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
    defaultModel: 'gpt-4o-mini-transcribe',
    maxBytes: 25 * 1024 * 1024
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    origin: 'https://openrouter.ai/*',
    keysUrl: 'https://openrouter.ai/keys',
    // Deliberately empty: OpenRouter routes to dozens of models and the catalogue
    // moves, so the field is free text pre-filled with the default rather than a
    // dropdown that would go stale. Any slug from openrouter.ai/models works.
    models: [],
    // whisper-large-v3 rather than whisper-1: the latter does not list ogg among
    // its accepted formats, and WhatsApp voice notes are ogg/opus.
    defaultModel: 'openai/whisper-large-v3',
    maxBytes: 25 * 1024 * 1024
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    baseUrl: null,
    origin: null,
    keysUrl: null,
    models: [],
    defaultModel: '',
    maxBytes: 25 * 1024 * 1024
  }
};

export const DEFAULT_PROVIDER = 'groq';

/** The provider entry, falling back to the default for an unknown id. */
export function providerOf(id) {
  return PROVIDERS[id] || PROVIDERS[DEFAULT_PROVIDER];
}

/**
 * Validates a user-supplied base URL and normalizes it.
 *
 * Plain http is refused except on the loopback host: sending an API key in the
 * clear over the network would be a real leak, while a local server has no
 * network hop to intercept.
 *
 * @returns {{ url: string } | { error: 'empty' | 'malformed' | 'insecure' }}
 */
export function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return { error: 'empty' };

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    return { error: 'malformed' };
  }

  const local = parsed.hostname === 'localhost' ||
                parsed.hostname === '127.0.0.1' ||
                parsed.hostname === '[::1]';

  if (parsed.protocol === 'http:' && !local) return { error: 'insecure' };
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'malformed' };

  // Trailing slashes are stripped so joining the path never doubles them.
  return { url: (parsed.origin + parsed.pathname).replace(/\/+$/, '') };
}

/**
 * The host permission to request for a provider. Presets carry a fixed origin;
 * `custom` derives one from whatever base URL the user entered.
 */
export function originFor(id, baseUrl) {
  const provider = providerOf(id);
  if (provider.origin) return provider.origin;

  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.error) return null;
  try {
    return new URL(normalized.url).origin + '/*';
  } catch (_) {
    return null;
  }
}
