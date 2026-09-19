# WA Voice Transcribe

A Chrome MV3 extension that adds a **Transcribe** link to every voice message on
WhatsApp Web. The transcript appears inside the same bubble, styled to match
WhatsApp's own transcript UI.

No build step, no npm dependencies. Load the folder as an unpacked extension and
it runs.

![The Transcribe link and a finished transcript inside a WhatsApp Web bubble](docs/screenshot.png)

*The conversation is a mock-up — no real messages. The transcript panel, the
links and the styling are rendered by the extension itself.*

> **Not affiliated with, endorsed by, or sponsored by WhatsApp or Meta.**
> This is an independent, unofficial project. "WhatsApp" is a trademark of its
> respective owner and is used here only to describe what the extension works
> with.

## How it works

WhatsApp media is end-to-end encrypted. The only place the audio exists in the
clear is in the page's memory, inside the `Blob` that WhatsApp passes to
`URL.createObjectURL` to feed the `<audio>` element.

`inject.js` runs in the **MAIN world** and installs two complementary hooks.

**1. `URL.createObjectURL`** — keeps every `audio/*` `Blob` in a `Map` (50
entries, FIFO). `revokeObjectURL` is patched to **not** drop the entry: WhatsApp
revokes the URL almost immediately, and after that the blob can no longer be
fetched.

**2. `HTMLMediaElement.prototype`** (the `src` setter and the `play` method) —
tells us *which* blob URL starts playing and *when*.

The second hook is not optional. **WhatsApp never inserts the audio element into
the DOM.** It uses a detached `new Audio()`, which no `querySelector` can reach —
`document.querySelectorAll('audio').length` stays `0` even during playback.
Looking for an `<audio>` inside the bubble is a dead end; hooking the prototype
is the only way to see it.

So the flow looks for no element at all: it starts playback and asks `inject.js`
for the first audio blob that started playing **after that instant**. The causal
link with the click is what guarantees it is that message's audio, with no risk of
grabbing the wrong voice note.

The forced playback is *armed*: `inject.js` mutes it, stops it on the first tick
and rewinds it, so nothing is audible and the voice note is not marked as played.

Consequences:

- no file is ever written to disk;
- no request is ever made to WhatsApp's servers;
- the only network request is the POST to Groq.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder
4. Open the extension's options and paste your Groq API key
5. Reload `https://web.whatsapp.com`

Requires Chrome 111 or later (`"world": "MAIN"` in content scripts).

## API key

Create one for free at <https://console.groq.com/keys>. It is never hardcoded: it
lives only in `chrome.storage.local`, on your computer, and never passes through
anyone else.

Free tier limits: 20 requests/minute, 2,000/day, 7,200 seconds of audio/hour,
28,800/day, 25 MB per file.

## Options

| setting | default |
|---|---|
| Groq API key | — |
| Voice note language | empty (automatic detection) |
| Model | `whisper-large-v3-turbo` |
| Keep transcripts | forever |

## Interface

Inside the bubble, a row of up to three links appears:

| link | when | what it does |
|---|---|---|
| **Transcribe** | always | starts the transcription ("Show transcript" when collapsed) |
| **Copy** | once a transcript exists | copies the text to the clipboard |
| **Hide** | once a transcript exists | collapses the panel without touching the cache |

**Hide** deletes nothing: the text stays in memory and **Show transcript** reopens
it instantly, with no network call.

Colours are not fixed values: they come from the design tokens WhatsApp Web
exposes on `:root`, so the UI follows the light and dark themes on its own.

| token | used for |
|---|---|
| `--WDS-accent` | the green links |
| `--message-primary` | the transcript text |
| `--WDS-systems-bubble-content-deemphasized` | dimmed text |
| `--WDS-secondary-negative` | errors |

When the transcript appears — whether the transcription just finished or you
pressed **Show transcript** — it is brought into view with
`scrollIntoView({ block: 'nearest' })`, which scrolls the minimum necessary and
does nothing if it is already visible. Scrolling is tied **only** to user
actions: the automatic re-render from the cache, which fires when an already
transcribed row scrolls back into view, never moves the conversation.

### Anchoring

The block is attached by climbing from the playback control to the ancestor that
holds both the waveform (`<canvas>`) and the avatar (`<img>`), then inserting into
that element's parent. This is a *structural* criterion, which is why it is the
primary one: it works even on a row that has not been laid out yet.

Both conditions matter. Stopping at the `<canvas>` is not enough: the avatar sits
in an outer container, beside a column holding the player and the duration, so the
transcript would end up *inside* that column — narrow text with the avatar
vertically centred next to it. Climbing until the avatar is included lets the text
take the full width and flow underneath it, the way the native UI does.

### Width

WhatsApp's bubble is sized by its content (shrink-to-fit), so a long text would
stretch it to its `max-width`, far beyond the player's width. The block uses
`width: 0` — contributing `0` to the container's intrinsic width — plus
`min-width: 100%`, which then makes it fill whatever width the bubble settled on
by itself. The transcript wraps inside the bubble without ever widening it.

Vertical spacing is `padding`, not `margin`: being the container's last child, a
vertical margin would collapse with the container's own and end up outside the
bubble instead of creating space.

## Cache and expiry

Every transcript is stored in `chrome.storage.local` under `t:<data-id>`, where
`data-id` is WhatsApp's own message identifier and is therefore stable. Clicking
the same voice note again serves the text from the cache with no network call, and
the transcript is re-rendered automatically when the row reappears after a scroll
or a page reload.

Retention is configurable: forever (default), 7, 30, 90 days or 1 year. The
cleanup works on two fronts, because neither is enough alone:

- **on read**, in the content script: an expired entry is not shown and is removed
  immediately;
- **on a periodic sweep**, in the service worker (`chrome.alarms`, at browser
  start and every 12 hours): needed because a transcript in a chat that is never
  reopened would never be read, and would sit in storage forever.

Entries written before expiry existed are bare strings with no timestamp: they get
stamped rather than thrown away. Corrupted entries are removed.

A voice note whose transcript has expired simply shows **Transcribe** again.

## Maintenance

WhatsApp Web's CSS classes are hashes that change often, so nothing here depends
on them. Detection is structural — a voice note is a row containing a `<canvas>`
waveform *and* a playback control — which also means it works in every interface
language.

The `aria-label` regex in `SELECTORS` (top of `content.js`) is only a **last
resort** for unexpected structures. It covers six languages, and WhatsApp ships
about sixty: relying on it was the reason the link failed to appear at all for
most users.

If something breaks, `SELECTORS` is where to start.

## Privacy

Voice note audio is sent to Groq for transcription, and transcripts are stored in
plain text in `chrome.storage.local`. See [PRIVACY.md](PRIVACY.md).

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by WhatsApp LLC or
Meta Platforms, Inc. It is an independent browser extension that runs in your own
browser, on your own session. All product names and trademarks belong to their
respective owners and are used for identification only.

The extension does not automate WhatsApp beyond the play/pause needed to decrypt
the audio you explicitly asked to transcribe. Using it is your responsibility, and
you should check it against WhatsApp's own terms of service before relying on it.

## Structure

```
manifest.json
inject.js      # MAIN world — createObjectURL + media prototype hooks, postMessage bridge
content.js     # ISOLATED world — observer, UI, orchestration
background.js  # service worker — TranscriptionEngine + GroqEngine, cache sweep
options.html
options.js
styles.css
icons/
_locales/      # en (default), it
docs/          # README assets
```

## Adding a transcription engine

In `background.js`, implement `TranscriptionEngine` and register the class in
`ENGINES`. Selection is driven by the `engine` key in `chrome.storage.local`
(default `groq`): the content script needs no changes.

```js
class LocalEngine extends TranscriptionEngine {
  async transcribe({ base64, mime, language }) { /* -> string */ }
}
const ENGINES = { groq: GroqEngine, local: LocalEngine };
```

## Translating

Message catalogs live in `_locales/<lang>/messages.json`. `en` is the default
locale; `it` is included. Adding a language means copying `_locales/en` and
translating the `message` values.
