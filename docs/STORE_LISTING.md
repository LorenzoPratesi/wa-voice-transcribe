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
reads (78 characters):

```
Transcribe WhatsApp Web voice messages with Groq Whisper, right in the bubble.
```

That is fine as-is. If you want the key requirement visible up front, paste this
instead — it stays within the limit:

```
Transcribe WhatsApp Web voice messages with Groq Whisper, right in the bubble. Bring your own API key.
```

101 characters. Changing it here does not change the manifest; to keep the two in
sync, edit `extDesc` in `_locales/*/messages.json`.

## Category

Productivity

## Detailed description

```
Voice messages are hard to read, impossible to search, and awkward when you
cannot listen. WA Voice Transcribe adds a "Transcribe" link to every voice note
on WhatsApp Web and shows the text inside the same bubble, styled to match
WhatsApp's own look in both light and dark themes.

HOW IT WORKS

The audio never leaves your browser except to be transcribed. The extension
reads the already-decrypted audio out of the page, sends it to the Groq Whisper
API using YOUR OWN API key, and shows the result. No file is written to disk, and
no request is ever made to WhatsApp's servers.

BRING YOUR OWN KEY

You need a free Groq API key (console.groq.com/keys). It is stored only on your
computer and is never sent anywhere except to Groq. The developer of this
extension has no server, receives no data, and cannot see your key, your audio or
your transcripts.

FEATURES

• One click per voice note — nothing is transcribed automatically
• The transcript appears inside the bubble, not in a popup
• Copy the text, or hide the panel without losing it
• Transcripts are cached, so reopening a chat costs no API call
• Optional expiry: delete transcripts after 7, 30, 90 days or a year
• Automatic language detection, or pin a specific language
• Works in any WhatsApp interface language — detection does not rely on
  translated labels
• Open source: github.com/LorenzoPratesi/wa-voice-transcribe

PRIVACY

The audio of the voice notes you choose to transcribe is sent to Groq. Transcripts
are stored in plain text in your browser's local storage, and you can clear them
at any time from the options page. Full details in the privacy policy.

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
| `docs/store/03-options.png` | the options page |

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

**Content scripts on `https://web.whatsapp.com/*`**
```
The extension only works on WhatsApp Web. It reads the message list to find voice
notes and to place its own UI inside the bubble, and reads the decrypted audio
from the page. The single write interaction is a play/pause on the voice note the
user asked to transcribe, which is what makes the page decrypt the audio; that
playback is muted and stopped immediately.
```

## Data usage disclosures

Declare honestly. Voice message content is **personal communications**, a
sensitive category — under-declaring it is what gets a listing taken down.

| question | answer |
|---|---|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | **Yes** — the user's own Groq API key, stored locally |
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

Note on the third-party transfer: the audio is sent to Groq solely to produce the
transcript the user requested, using the user's own credentials. This is the
single purpose of the extension, not an unrelated use.

## Single purpose statement

```
Transcribing WhatsApp Web voice messages into text, shown inside the conversation.
```

---

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
