# Chrome Web Store listing

Copy for the submission form. Nothing here is uploaded automatically — paste it
into the Developer Dashboard.

Build the package first:

```bash
./scripts/package.sh
```

---

## Name

```
WA Voice Transcribe
```

Deliberately avoids the full "WhatsApp" wordmark in the name. Meta regularly has
extensions removed over trademark use, and the product name is the first thing a
reviewer looks at.

## Short description (132 characters max)

The dashboard pre-fills this from the manifest's `description`, which currently
reads (88 characters):

```
Transcribe WhatsApp Web voice messages in the bubble. Groq, OpenAI or your own endpoint.
```

Changing it here does not change the manifest; to keep the two in sync, edit
`extDesc` in `_locales/*/messages.json`.

## Category

Productivity

## Languages

The listing can declare: English (default), Italian, Spanish, French, German,
Portuguese. The UI is translated in all six; `_locales/en` is the source of truth.

## Detailed description

```
Voice messages are hard to read, impossible to search, and awkward when you
cannot listen. WA Voice Transcribe adds a "Transcribe" link to every voice note
on WhatsApp Web and shows the text inside the same bubble, styled to match
WhatsApp's own look in both light and dark themes.

HOW IT WORKS

The audio never leaves your browser except to be transcribed. The extension
reads the already-decrypted audio out of the page, sends it to the provider you
chose using YOUR OWN API key, and shows the result. No file is written to disk,
and no request is ever made to WhatsApp's servers.

CHOOSE YOUR PROVIDER

Groq, OpenAI, OpenRouter, or any server that speaks the OpenAI audio
transcription API — including one running on your own machine, in which case the
audio never leaves it at all. Each provider keeps its own key, so switching does
not lose the other.

Only Groq's domain is requested when you install. Any other provider is an
optional permission, asked for when you pick it, one origin at a time.

BRING YOUR OWN KEY

You supply the API key (a free one from console.groq.com/keys works). It is
stored only on your computer and is never sent anywhere except to the provider
you selected. The developer of this extension has no server, receives no data,
and cannot see your keys, your audio or your transcripts.

FEATURES

• One click per voice note — nothing is transcribed automatically
• The transcript appears inside the bubble, not in a popup
• Copy the text, or hide the panel without losing it
• Transcripts are cached, so reopening a chat costs no API call
• Optional expiry: delete transcripts after 7, 30, 90 days or a year
• Automatic language detection, or pin a specific language
• Use a local model for full privacy: point it at your own endpoint
• Works in any WhatsApp interface language — detection does not rely on
  translated labels
• Open source: github.com/LorenzoPratesi/wa-voice-transcribe

PRIVACY

The audio of the voice notes you choose to transcribe is sent to the provider you
configured — or to nobody but your own machine, if that is what you point it at.
Transcripts are stored in plain text in your browser's local storage, and you can
clear them at any time from the options page. Full details in the privacy policy.

NOT AFFILIATED WITH WHATSAPP

This is an independent, unofficial project. It is not affiliated with, endorsed by,
or sponsored by WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of
its respective owner and is used only to describe what the extension works with.
```

## Privacy policy URL

```
https://github.com/LorenzoPratesi/wa-voice-transcribe/blob/main/PRIVACY.md
```

## Screenshots (1280x800)

| file | shows |
|---|---|
| `docs/store/01-transcript-in-bubble.png` | a finished transcript with Copy / Hide |
| `docs/store/02-idle-and-progress.png` | the idle link and the in-progress state |
| `docs/store/03-options.png` | the options page, with the provider selector and the permission prompt |

The conversations in them are mock-ups: no real messages. The transcript UI is
rendered by the extension itself, so what is shown is what it does.

---

## Permission justifications

The dashboard asks for one per permission. Keep them factual — a vague
justification is a common reason for a review round-trip.

**`storage`**
```
Stores the user's own Groq API key, their preferences (language, model, retention
period), and the cache of transcripts already produced, so that reopening a chat
does not re-send audio to the API.
```

**`alarms`**
```
Runs the periodic cleanup that deletes transcripts older than the retention period
the user chose. Without it, a transcript in a conversation the user never reopens
would stay in local storage indefinitely.
```

**`clipboardWrite`**
```
Backs the "Copy" action that copies a transcript to the clipboard, used as a
fallback when the asynchronous Clipboard API is unavailable because the document
has lost focus.
```

**Host permission `https://api.groq.com/*`**
```
The transcription endpoint. The extension sends the audio of the voice note the
user explicitly asked to transcribe, authenticated with the user's own API key,
and receives the text back. This is the only remote host the extension contacts.
```

**Optional host permissions (`https://api.openai.com/*`, `https://openrouter.ai/*`,
`https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`)**
```
The extension transcribes through a provider the user chooses and pays for with
their own API key. Only the default provider's domain is a required permission;
every other one is optional and requested at runtime, from the options page, for
the single origin the user selected.

The broad https pattern exists because the user can point the extension at a
self-hosted, OpenAI-compatible transcription server — its address cannot be known
in advance and cannot be enumerated in the manifest. The extension never requests
that pattern: it requests exactly the one origin derived from the URL the user
typed, so Chrome's prompt names that host and nothing else. No page content is
read from these hosts, and no request is made to any host the user has not
configured.

The localhost patterns cover a transcription model running on the user's own
machine, which is the configuration where no audio leaves the device at all.
```

**Content scripts on `https://web.whatsapp.com/*`**
```
The extension only works on WhatsApp Web. It reads the message list to find voice
notes and to place its own UI inside the bubble, and reads the decrypted audio
from the page. The single write interaction is a play/pause on the voice note the
user asked to transcribe, which is what makes the page decrypt the audio; that
playback is muted and stopped immediately.
```

**Remote code use**
```
No. The extension does not use remote code.

Every line of JavaScript it runs is contained in the uploaded package. There is
no eval, no new Function, no dynamically imported module, and no script loaded
from a network location — the only <script> tag is a relative reference to a
bundled file.

The extension makes exactly two kinds of fetch: one to the transcription
endpoint the user configured, which sends audio and receives text, and one to a
blob: URL that exists only in the page's own memory. Both carry data, never code,
and neither result is executed.
```

## Data usage disclosures

Declare honestly. Voice message content is **personal communications**, a
sensitive category — under-declaring it is what gets a listing taken down.

| question | answer |
|---|---|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | **Yes** — the user's own API keys, one per provider, stored locally |
| Personal communications | **Yes** — the audio of voice notes the user chooses to transcribe, and the resulting text |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | **Yes** — the audio of the selected voice notes is read from the page |

Certifications to tick:

- Data is **not** sold to third parties
- Data is **not** used or transferred for purposes unrelated to the single
  purpose of the item
- Data is **not** used or transferred to determine creditworthiness or for
  lending purposes

Note on the third-party transfer: the audio is sent to the transcription provider
the user chose, solely to produce the transcript they requested, using their own
credentials. This is the single purpose of the extension, not an unrelated use.
When the configured endpoint is on the user's own machine, no transfer to a third
party happens at all.

## Single purpose statement

```
Transcribing WhatsApp Web voice messages into text, shown inside the conversation.
```

---

## Test instructions for the reviewer

The extension does nothing without an API key, so a reviewer who installs it and
clicks Transcribe sees only an error. These instructions go in the *Account →
Test instructions* field.

```
The extension requires a transcription API key, which each user supplies
themselves. Without one it shows "API key not configured" and does nothing else.

TO TEST

1. Get a free API key at https://console.groq.com/keys (no payment details
   required for the free tier).
2. Open the extension's options page, leave the provider on "Groq", paste the key
   and click Save.
3. Open https://web.whatsapp.com and sign in. Open any conversation that contains
   a voice message.
4. A green "Transcribe" link appears under the voice note player, inside the
   bubble. Click it. The text appears in the same bubble within a few seconds,
   with "Copy" and "Hide" underneath.

WHAT TO EXPECT

- Nothing is transcribed automatically; only the voice note you click is sent.
- Clicking the same voice note again serves the text from the local cache and
  makes no network request.
- No file is downloaded, and no request is ever made to WhatsApp's servers. The
  only outbound request is the POST to the transcription provider.

If you prefer not to create an account, contact us and we will supply a
short-lived test key.
```

## Before submitting

- [ ] Developer account registered (one-time 5 USD fee)
- [ ] `./scripts/package.sh` run, ZIP under `build/`
- [ ] `PRIVACY.md` reachable at the URL above on the default branch
- [ ] Screenshots uploaded (at least one, up to five)
- [ ] Permission justifications filled in
- [ ] Data usage form completed
- [ ] Disclaimer present in the description

Review usually takes a few days, and longer for items handling sensitive data.
Expect at least one round-trip on the data usage form.
