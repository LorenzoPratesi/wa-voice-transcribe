# Privacy

WA Voice Transcribe is a browser extension that transcribes WhatsApp Web voice
messages. This document describes exactly what it does with your data.

## What leaves your computer

**The audio of the voice notes you choose to transcribe**, and nothing else.

When you click **Transcribe** on a voice message, the extension reads the already
decrypted audio from the page's memory and sends it to the Groq API
(`https://api.groq.com/openai/v1/audio/transcriptions`) for transcription. The
response — the text — comes back and is shown in the bubble.

This happens only for voice notes you explicitly click. Nothing is transcribed
automatically, and no other message, contact, chat name or metadata is ever read
or transmitted.

Groq's handling of that audio is governed by their own terms and privacy policy:
<https://groq.com/privacy-policy/>

## What stays on your computer

**Your API key.** It is stored in `chrome.storage.local` and is used only as the
`Authorization` header of the request to Groq. It is never sent anywhere else.

**The transcripts.** Each one is stored in `chrome.storage.local` under
`t:<message-id>`, so that clicking the same voice note again costs no network
request.

> Transcripts are stored **in plain text**. Anyone with access to your Chrome
> profile can read them. The original voice notes remain end-to-end encrypted and
> are never written to disk, but their transcribed text is not protected.

You can delete all transcripts at any time with **Clear transcript cache** in the
extension's options, or set an automatic retention period (7, 30, 90 days or
1 year) after which they are deleted on their own. The default is to keep them
forever.

Uninstalling the extension removes everything it stored.

## What the author receives

**Nothing.** There is no analytics, no telemetry, no error reporting, and no
server operated by this project. Each user supplies their own Groq API key, so the
audio goes directly from your browser to Groq. The author has no access to your
key, your audio, or your transcripts.

## What the extension does on the page

It runs only on `https://web.whatsapp.com/*`. It reads the message list to find
voice notes and to place its own UI. The only thing it writes to WhatsApp's
interface is a play/pause click on the voice note you asked to transcribe — which
is what makes WhatsApp decrypt the audio. That playback is muted and stopped
immediately.

It never sends messages, never modifies your conversations, and never contacts
WhatsApp's servers.

## Permissions

| permission | why |
|---|---|
| `storage` | to save your settings and the transcript cache |
| `alarms` | to run the periodic cleanup of expired transcripts |
| `clipboardWrite` | for the **Copy** button's fallback path |
| `https://api.groq.com/*` | to send the audio for transcription |
| content scripts on `https://web.whatsapp.com/*` | to add the UI and read the audio |
