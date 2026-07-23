# FileSizeBypass

A Vencord plugin that reroutes large file uploads to an external host instead of letting them get blocked or compressed by Discord's own upload limits.

When a file goes over your configured size threshold, it gets intercepted before Discord's upload pipeline even sees it, sent off to catbox.moe or litterbox.catbox.moe, and the link comes back and gets pasted straight into your chat box. There's a small progress indicator so you can see how the upload is going.

## Features

- Catches drag-and-drop, paste, and file-picker uploads before Discord touches them
- Configurable size threshold, so only files bigger than you want gets rerouted
- An "upload all files" mode if you'd rather skip the threshold and route everything through the external host
- Two host options:
  - Catbox - permanent hosting, 200MB limit, optional userhash if you want to manage your uploads later
  - Litterbox - temporary hosting, no account needed, 1GB limit, with configurable retention (1h / 12h / 24h / 72h)
- A live progress indicator with a cancel button, shown as a small floating panel
- Optional link masking, so you can hide the raw URL behind clean clickable text (like just the filename) either always or only for video files
- Uploads run through Electron's main process rather than the renderer, since that's the only way to get around Discord's CSP and actually talk to a third-party host

## Settings

| Setting | Description |
|---|---|
| Size threshold (MB) | Files larger than this get rerouted instead of attached directly |
| Upload all files | Ignore the threshold and reroute everything |
| Upload host | Catbox or Litterbox |
| Litterbox duration | How long Litterbox retains the file (Litterbox only) |
| Catbox userhash | Optional, ties uploads to your Catbox account so they're manageable/deletable later |
| Link mask mode | Off / Videos only / Always |
| Mask link label | Text shown instead of the raw link when masking is on (`{filename}` placeholder supported) |

## How it works

1. A drop, paste, or file-select event gets caught in the renderer before Discord's own handlers see it.
2. Files over the threshold get pulled out and their raw bytes are sent to the plugin's main-process helper through `VencordNative.pluginHelpers`.
3. The main process streams the file to the selected host as multipart form data, chunked through `fetch`/undici so progress can be tracked and the upload can be aborted mid-flight.
4. The renderer polls upload status every 300ms and updates the progress bar.
5. Once it's done, the returned link gets inserted directly into the chat input box.

## Installation

Drop the plugin folder into your Vencord `userplugins` directory and rebuild:

```
src/userplugins/FileSizeBypass/
├── index.ts
└── native.ts
```

Then run Vencord's build process as usual and enable FileSizeBypass in the plugin list.

## Disclaimer

This plugin uploads your files to a third-party host (Catbox/Litterbox) that Anthropic and Vencord aren't affiliated with. Uploaded files are subject to those hosts' terms, size limits, and retention policies, so don't upload anything you wouldn't be comfortable having sit on a third-party server.

---

*Vibecoded with Claude Sonnet 5 and Gemini 3.6 Thinking.*
