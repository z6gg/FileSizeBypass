# FileSizeBypass

vencord plugin that allows you to bypass discord's file upload limit without nitro, by using an external host

catbox might not support some file types

## Features/Settings

- works seamlessly with files uploaded by drag & drop or files uploaded with the file picker
- configurable file size threshold to choose the minimum file size needed to utilize the plugin
- a toggle to route all uploaded files to catbox, ignoring the threshold
- two host options:
  - [catbox.moe](https://catbox.moe/) - permanent hosting, no account needed, 200mb limit, optional userhash if you want to manage your uploads later
  - [litterbox.catbox.moe](https://litterbox.catbox.moe/) - temporary hosting, no account needed, 1gb limit, with configurable file expiry time
- a little panel that displays your upload progress where you can also stop it
- a toggle to mask the link, so you can hide the raw URL behind clean text (like just the filename) either always or only for video files

## How it works

1. file gets caught in the renderer before discord's own handlers see it
2. files that meet the threshold are pulled out and are then sent to the plugin's main process helper through `VencordNative.pluginHelpers`
3. the file is streamed to the host as multipart form data, chunked through `fetch`/undici so progress can be tracked and aborted any time
4. upload status is updated every 300ms by the renderer
5. after it's done, the link gets inserted in the chat box

## Installation
### Auto Install (Recommended)
1. download the installer script in the releases, place it somewhere you will keep vencord in
2. run it, the first run might take a few minutes,
3. wait until you get prompted to choose which discord version you wanna patch, if you don't know just click enter

discord will then close if it was open, and you're done

go to your plugins then click "Show All" in the filters section and choose "Show Userplugins" where you'll find the plugin

don't move or delete the created folder

### Manual Install
1. choose where you want vencord to be and run a command prompt there
2. install needed tools:
```
winget install --id Git.Git -e --source winget
winget install --id OpenJS.NodeJS.LTS -e --source winget
```
3. restart cmd
4. install another needed tool:
```
npm install -g pnpm
```
5. run the following commands in order:
```
mkdir VencordBuild
cd VencordBuild
git clone https://github.com/Vendicated/Vencord.git
cd Vencord
pnpm install
mkdir src\userplugins\
cd src\userplugins\
git clone https://github.com/z6gg/FileSizeBypass.git
cd ../..
pnpm build && pnpm inject
```
6. you will reach a point where it prompts you which discord version you wanna patch, choose your desired one
7. discord will close if it was open, open it back up and go to your plugins then click "Show All" in the filters and choose "Show Userplugins" where you'll find the plugin

don't move or delete the created folder

if the plugin ever gets updated, cd into your `src\userplugins\FileSizeBypass` and repeat the following commands:
```
git pull
cd ../../..
pnpm build && pnpm inject
```


## Disclaimer

this plugin uploads your files to a third party host (Catbox) Vencord isn't affiliated with. uploaded files are subject to those hosts' terms, size limits, and retention policies, so don't upload anything you wouldn't be comfortable having sit on a third-party server

---

*Vibecoded with Claude Sonnet 5 and Gemini 3.6 Thinking.*
