/**
 * Main-process helpers for FileSizeBypass.
 *
 * Discord's renderer process enforces a CSP that blocks fetch/XHR requests to
 * arbitrary third-party domains like catbox.moe. The Electron main process
 * isn't subject to that CSP, so the actual upload happens here instead and
 * gets exposed to the renderer through VencordNative.pluginHelpers.
 *
 * Each upload is tracked by an id so the renderer can poll for progress and
 * cancel it mid-flight (see index.ts).
 */

import { IpcMainInvokeEvent } from "electron";

type UploadStatus = "uploading" | "done" | "error" | "cancelled";

interface UploadState {
    loaded: number;
    total: number;
    status: UploadStatus;
    url?: string;
    error?: string;
    controller: AbortController;
}

const uploads = new Map<string, UploadState>();

interface HostConfig {
    url: string;
    fileField: string;
    fields: Record<string, string>;
}

function getHostConfig(host: string, userhash: string, litterboxDuration: string): HostConfig {
    if (host === "litterbox") {
        return {
            url: "https://litterbox.catbox.moe/resources/internals/api.php",
            fileField: "fileToUpload",
            fields: { reqtype: "fileupload", time: litterboxDuration || "24h" },
        };
    }

    const fields: Record<string, string> = { reqtype: "fileupload" };
    if (userhash) fields.userhash = userhash;

    return {
        url: "https://catbox.moe/user/api.php",
        fileField: "fileToUpload",
        fields,
    };
}

function buildMultipart(fields: Record<string, string>, fileField: string, fileName: string, fileBuffer: Buffer) {
    const boundary = "----VencordFSB" + Math.random().toString(16).slice(2);
    const parts: Buffer[] = [];

    for (const [key, value] of Object.entries(fields)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    }

    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
    ));
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    return { body: Buffer.concat(parts), boundary };
}

function parseResultUrl(text: string): string | null {
    const trimmed = text.trim();

    try {
        const json = JSON.parse(trimmed);
        const candidate = json.url ?? json.data?.[0]?.url;
        if (candidate && String(candidate).startsWith("http")) return String(candidate);
    } catch {
        // Not JSON, that's fine. Catbox and Litterbox usually just return the raw URL as plain text.
    }

    return trimmed.startsWith("http") ? trimmed : null;
}

async function doUpload(uploadId: string, host: HostConfig, fileName: string, fileBuffer: Buffer) {
    const { body, boundary } = buildMultipart(host.fields, host.fileField, fileName, fileBuffer);
    const total = body.length;
    const controller = new AbortController();

    const state: UploadState = { loaded: 0, total, status: "uploading", controller };
    uploads.set(uploadId, state);

    // A plain https.request gets its connection reset mid-upload by Cloudflare,
    // which fronts catbox.moe. fetch (undici) doesn't run into that, so we
    // stream the body through it in chunks instead, which also gets us real
    // progress tracking and the ability to abort mid-flight.
    const CHUNK = 256 * 1024;
    let offset = 0;

    const stream = new ReadableStream<Uint8Array>({
        pull(ctrl) {
            if (offset >= total) {
                ctrl.close();
                return;
            }
            const slice = body.subarray(offset, Math.min(offset + CHUNK, total));
            offset += slice.length;
            state.loaded = offset;
            ctrl.enqueue(slice);
        },
    });

    try {
        const res = await fetch(host.url, {
            method: "POST",
            headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
            body: stream,
            // @ts-expect-error: undici needs this for streamed request bodies, but it's not in lib.dom's types yet
            duplex: "half",
            signal: controller.signal,
        });

        if (state.status === "cancelled") return;

        const text = await res.text();

        if (!res.ok) {
            state.status = "error";
            state.error = `HTTP ${res.status}: ${text.trim().slice(0, 200)}`;
            return;
        }

        const resultUrl = parseResultUrl(text);
        if (!resultUrl) {
            state.status = "error";
            state.error = text.trim().slice(0, 200) || "Host returned an unrecognized response";
            return;
        }

        state.status = "done";
        state.url = resultUrl;
    } catch (err) {
        if (state.status === "cancelled") return;
        state.status = "error";
        state.error = (err as Error).message;
    }
}

export async function startUpload(
    _event: IpcMainInvokeEvent,
    uploadId: string,
    buffer: ArrayBuffer,
    fileName: string,
    userhash: string,
    host: string,
    litterboxDuration: string
): Promise<void> {
    const hostConfig = getHostConfig(host, userhash, litterboxDuration);
    // This isn't awaited on purpose. It kicks the upload off and returns
    // right away so the renderer can start polling getUploadStatus.
    void doUpload(uploadId, hostConfig, fileName, Buffer.from(buffer));
}

export async function getUploadStatus(_event: IpcMainInvokeEvent, uploadId: string) {
    const state = uploads.get(uploadId);
    if (!state) return { status: "error" as UploadStatus, loaded: 0, total: 0, error: "Unknown upload id" };
    return { status: state.status, loaded: state.loaded, total: state.total, url: state.url, error: state.error };
}

export async function cancelUpload(_event: IpcMainInvokeEvent, uploadId: string): Promise<void> {
    const state = uploads.get(uploadId);
    if (!state || state.status !== "uploading") return;
    state.status = "cancelled";
    state.controller.abort();
}

export async function clearUpload(_event: IpcMainInvokeEvent, uploadId: string): Promise<void> {
    uploads.delete(uploadId);
}
