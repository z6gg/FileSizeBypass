/**
 * FileSizeBypass
 *
 * Catches drag-and-drop, copy-paste, and file selection events before
 * Discord's upload pipeline gets them. Files over the configured threshold
 * get uploaded to a third-party host (through the Electron main process,
 * since that's the only way to get around Discord's renderer CSP), and the
 * resulting link gets pasted into the chat box, with a small progress
 * indicator while the upload runs.
 */


import { definePluginSettings } from "@api/Settings";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

const settings = definePluginSettings({
    sizeThresholdMB: {
        type: OptionType.NUMBER,
        description: "Files larger than this (in MB) get rerouted instead of attached directly",
        default: 10,
    },
    uploadAllFiles: {
        type: OptionType.BOOLEAN,
        description: "Reroute every file through the upload host, ignoring the size threshold above",
        default: false,
    },
    uploadHost: {
        type: OptionType.SELECT,
        description: "Where to upload rerouted files",
        options: [
            { label: "Catbox - permanent, 200MB limit", value: "catbox", default: true },
            { label: "Litterbox - temporary, no account needed, 1GB limit", value: "litterbox" },
        ],
    },
    litterboxDuration: {
        type: OptionType.SELECT,
        description: "How long Litterbox keeps the file (only applies when Upload Host = Litterbox)",
        options: [
            { label: "1 hour", value: "1h" },
            { label: "12 hours", value: "12h" },
            { label: "24 hours", value: "24h", default: true },
            { label: "72 hours", value: "72h" },
        ],
    },
    userhash: {
        type: OptionType.STRING,
        description: "Optional catbox.moe userhash (makes uploads deletable/manageable later). Leave blank for anonymous uploads. Only used when Upload Host = Catbox.",
        default: "",
    },
    linkMaskMode: {
        type: OptionType.SELECT,
        description: "Hide the raw URL behind clean clickable text. The embed still shows underneath, this only hides the link text above it.",
        options: [
            { label: "Off - paste the raw link", value: "off", default: true },
            { label: "Only for videos (.mp4, .mov, .webm, .mkv, .m4v, .avi)", value: "videos" },
            { label: "Always", value: "always" },
        ],
    },
    maskLinkLabel: {
        type: OptionType.STRING,
        description: "Text shown instead of the raw link when masking is enabled. Use {filename} as a placeholder.",
        default: "{filename}",
    },
});

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"];

function isVideoFile(name: string): boolean {
    const lower = name.toLowerCase();
    return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ensureContainer(): HTMLElement {
    let el = document.getElementById("fsb-progress-container");
    if (el) return el;

    el = document.createElement("div");
    el.id = "fsb-progress-container";
    el.style.cssText = `
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 9999;
        display: flex;
        flex-direction: column-reverse;
        gap: 8px;
    `;
    document.body.appendChild(el);
    return el;
}

interface ProgressUI {
    row: HTMLElement;
    bar: HTMLElement;
    status: HTMLElement;
    cancelBtn: HTMLElement;
}

function createProgressRow(fileName: string, uploadId: string): ProgressUI {
    const row = document.createElement("div");
    row.id = `fsb-row-${uploadId}`;
    row.style.cssText = `
        background: var(--background-secondary, #2b2d31);
        color: var(--text-normal, #dbdee1);
        border-radius: 8px;
        padding: 10px 12px;
        width: 260px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.35);
        font-size: 13px;
        font-family: var(--font-primary, sans-serif);
    `;

    const label = document.createElement("div");
    label.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:8px;";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = fileName;
    nameSpan.style.cssText = "overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";

    const cancelBtn = document.createElement("span");
    cancelBtn.textContent = "✕";
    cancelBtn.title = "Cancel upload";
    cancelBtn.style.cssText = "cursor:pointer; opacity:0.7; flex-shrink:0; user-select:none;";
    cancelBtn.onmouseenter = () => (cancelBtn.style.opacity = "1");
    cancelBtn.onmouseleave = () => (cancelBtn.style.opacity = "0.7");
    cancelBtn.onclick = () => VencordNative.pluginHelpers.FileSizeBypass.cancelUpload(uploadId);

    label.append(nameSpan, cancelBtn);

    const track = document.createElement("div");
    track.style.cssText = "background: var(--background-tertiary, #1e1f22); border-radius: 4px; height: 6px; overflow:hidden;";

    const bar = document.createElement("div");
    bar.style.cssText = "background: var(--brand-experiment, #5865f2); height:100%; width:0%; transition: width 0.15s linear;";
    track.appendChild(bar);

    const status = document.createElement("div");
    status.style.cssText = "margin-top:6px; opacity:0.75; font-size:11px;";
    status.textContent = "Starting...";

    row.append(label, track, status);
    ensureContainer().appendChild(row);

    return { row, bar, status, cancelBtn };
}

function buildLinkText(url: string, fileName: string): string {
    const mode = settings.store.linkMaskMode;
    const shouldMask = mode === "always" || (mode === "videos" && isVideoFile(fileName));
    if (!shouldMask) return url;

    const label = settings.store.maskLinkLabel.replace("{filename}", fileName);
    return `[${label}](${url})`;
}

function finishRow(ui: ProgressUI) {
    ui.cancelBtn.style.display = "none";
    setTimeout(() => ui.row.remove(), 4000);
}

const activePolls = new Set<ReturnType<typeof setInterval>>();

function pollUpload(uploadId: string, fileName: string, ui: ProgressUI) {
    const interval = setInterval(async () => {
        const state = await VencordNative.pluginHelpers.FileSizeBypass.getUploadStatus(uploadId);

        const pct = state.total ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : 0;
        ui.bar.style.width = `${pct}%`;

        if (state.status === "uploading") {
            ui.status.textContent = `${pct}% - ${formatBytes(state.loaded)} / ${formatBytes(state.total)}`;
            return;
        }

        activePolls.delete(interval);
        clearInterval(interval);

        if (state.status === "done" && state.url) {
            ui.bar.style.width = "100%";
            ui.status.textContent = "Done";
            insertTextIntoChatInputBox(`${buildLinkText(state.url, fileName)} `);
            showToast(`Uploaded ${fileName}`, Toasts.Type.SUCCESS);
        } else if (state.status === "cancelled") {
            ui.status.textContent = "Cancelled";
            showToast(`Cancelled upload of ${fileName}`, Toasts.Type.MESSAGE);
        } else {
            ui.status.textContent = `Failed: ${state.error ?? "Unknown error"}`;
            showToast(`Failed to upload ${fileName}: ${state.error ?? "Unknown error"}`, Toasts.Type.FAILURE);
        }

        VencordNative.pluginHelpers.FileSizeBypass.clearUpload(uploadId);
        finishRow(ui);
    }, 300);

    activePolls.add(interval);
}

async function handleLargeFile(file: File) {
    const uploadId = crypto.randomUUID();
    const ui = createProgressRow(file.name, uploadId);

    try {
        const buffer = await file.arrayBuffer();
        await VencordNative.pluginHelpers.FileSizeBypass.startUpload(
            uploadId,
            buffer,
            file.name,
            settings.store.userhash.trim(),
            settings.store.uploadHost,
            settings.store.litterboxDuration
        );
    } catch (err) {
        ui.status.textContent = `Failed to start upload: ${(err as Error).message}`;
        finishRow(ui);
        return;
    }

    pollUpload(uploadId, file.name, ui);
}

function processFiles(files: FileList | File[]): boolean {
    const thresholdBytes = settings.store.sizeThresholdMB * 1024 * 1024;
    const list = Array.from(files);
    const bigFiles = settings.store.uploadAllFiles ? list : list.filter(f => f.size > thresholdBytes);

    if (bigFiles.length === 0) return false;

    for (const file of bigFiles) handleLargeFile(file);

    return true;
}

function stopEvent(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}

function onDrop(e: DragEvent) {
    if (e.dataTransfer?.files?.length && processFiles(e.dataTransfer.files)) stopEvent(e);
}

function onPaste(e: ClipboardEvent) {
    if (e.clipboardData?.files?.length && processFiles(e.clipboardData.files)) stopEvent(e);
}

function onChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target?.tagName !== "INPUT" || target.type !== "file" || !target.files?.length) return;

    if (processFiles(target.files)) {
        stopEvent(e);
        target.value = "";
    }
}

export default definePlugin({
    name: "FileSizeBypass",
    description: "Reroutes file uploads over a size threshold to catbox.moe (or an alternate host) and pastes the link instead of attaching",
    authors: [{ name: "you", id: 0n }],
    settings,

    start() {
        window.addEventListener("drop", onDrop, true);
        window.addEventListener("paste", onPaste, true);
        window.addEventListener("change", onChange, true);
    },

    stop() {
        window.removeEventListener("drop", onDrop, true);
        window.removeEventListener("paste", onPaste, true);
        window.removeEventListener("change", onChange, true);
        activePolls.forEach(clearInterval);
        activePolls.clear();
        document.getElementById("fsb-progress-container")?.remove();
    },
});
