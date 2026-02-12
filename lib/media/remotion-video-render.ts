import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TimelineSpec } from "@json-render/remotion";
import { SHARE_TIMELINE_COMPOSITION_ID } from "@/lib/media/remotion-shared";

const VIDEO_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_CACHED_VIDEOS = 64;
const VIDEO_DIR = path.join(os.tmpdir(), "json-render-share-videos");
const VIDEO_ID_RE = /^[a-f0-9]{20,64}$/;

let bundleLocationPromise: Promise<string> | null = null;

async function importAtRuntime<T>(specifier: string): Promise<T> {
  const dynamicImport = new Function("s", "return import(s);") as (
    s: string
  ) => Promise<T>;
  return dynamicImport(specifier);
}

type RenderTimelineResult = {
  id: string;
  outputPath: string;
  sizeBytes: number;
  reusedCache: boolean;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
};

function getEntryPointPath(): string {
  return path.join(process.cwd(), "lib/media/remotion-share-root.tsx");
}

function hashTimeline(spec: TimelineSpec): string {
  const payload = JSON.stringify(spec);
  return createHash("sha256").update(payload).digest("hex").slice(0, 28);
}

function toSafeComposition(spec: TimelineSpec): {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
} {
  const composition = spec.composition;
  return {
    durationInFrames: Math.max(1, Math.round(composition?.durationInFrames ?? 90)),
    fps: Math.max(1, Math.round(composition?.fps ?? 30)),
    width: Math.max(64, Math.round(composition?.width ?? 1080)),
    height: Math.max(64, Math.round(composition?.height ?? 1920)),
  };
}

async function ensureVideoDirectory(): Promise<void> {
  await fs.mkdir(VIDEO_DIR, { recursive: true });
}

async function cleanupOldVideos(): Promise<void> {
  await ensureVideoDirectory();
  const entries = await fs.readdir(VIDEO_DIR, { withFileTypes: true });
  const now = Date.now();

  const files: Array<{
    fileName: string;
    fullPath: string;
    mtimeMs: number;
  }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".mp4")) continue;
    const fullPath = path.join(VIDEO_DIR, entry.name);
    try {
      const stats = await fs.stat(fullPath);
      files.push({
        fileName: entry.name,
        fullPath,
        mtimeMs: stats.mtimeMs,
      });
      if (now - stats.mtimeMs > VIDEO_TTL_MS) {
        await fs.unlink(fullPath).catch(() => undefined);
      }
    } catch {
      // Ignore stale entries.
    }
  }

  if (files.length <= MAX_CACHED_VIDEOS) return;
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const toDelete = files.slice(0, files.length - MAX_CACHED_VIDEOS);
  await Promise.all(toDelete.map((item) => fs.unlink(item.fullPath).catch(() => undefined)));
}

async function getBundleLocation(): Promise<string> {
  if (!bundleLocationPromise) {
    bundleLocationPromise = (async () => {
      const { bundle } = await importAtRuntime<typeof import("@remotion/bundler")>(
        "@remotion/bundler"
      );
      return bundle({
        entryPoint: getEntryPointPath(),
      });
    })();
  }
  return bundleLocationPromise;
}

function getVideoOutputPath(id: string): string {
  return path.join(VIDEO_DIR, `${id}.mp4`);
}

export function isValidRenderedVideoId(id: string): boolean {
  return VIDEO_ID_RE.test(id);
}

export async function getRenderedVideoFilePath(id: string): Promise<string | null> {
  if (!isValidRenderedVideoId(id)) return null;
  const filePath = getVideoOutputPath(id);
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return null;
    return filePath;
  } catch {
    return null;
  }
}

export async function renderTimelineSpecToMp4(spec: TimelineSpec): Promise<RenderTimelineResult> {
  await ensureVideoDirectory();
  void cleanupOldVideos();

  const id = hashTimeline(spec);
  const outputPath = getVideoOutputPath(id);
  const compositionMeta = toSafeComposition(spec);

  try {
    const existing = await fs.stat(outputPath);
    if (existing.isFile()) {
      return {
        id,
        outputPath,
        sizeBytes: existing.size,
        reusedCache: true,
        ...compositionMeta,
      };
    }
  } catch {
    // Render below.
  }

  const bundleLocation = await getBundleLocation();
  const { renderMedia, selectComposition } = await importAtRuntime<
    typeof import("@remotion/renderer")
  >("@remotion/renderer");

  const inputProps = { spec };
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: SHARE_TIMELINE_COMPOSITION_ID,
    inputProps,
  });

  await renderMedia({
    serveUrl: bundleLocation,
    composition,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    imageFormat: "jpeg",
    audioCodec: null,
    crf: 20,
    colorSpace: "default",
    pixelFormat: "yuv420p",
  });

  const rendered = await fs.stat(outputPath);
  return {
    id,
    outputPath,
    sizeBytes: rendered.size,
    reusedCache: false,
    ...compositionMeta,
  };
}
