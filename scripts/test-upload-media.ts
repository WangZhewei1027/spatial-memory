import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openAsBlob } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { ContentError } from "../lib/content-model/errors";
import { generateVideoThumbnail, processUploadMedia } from "../lib/upload/media-processing.server";
import { STORED_FILE_MAX_BYTES, VIDEO_MAX_DURATION_SECONDS } from "../lib/upload/policy";

const file = (buffer: Uint8Array, name: string, type: string) => new File([Uint8Array.from(buffer)], name, { type });
const invalid = (status = 400) => (error: unknown) => error instanceof ContentError && error.status === status;

function wav(seconds: number, channels = 1, sampleRate = 44100): Buffer {
  const frames = Math.floor(seconds * sampleRate), dataBytes = frames * channels * 2;
  const result = Buffer.alloc(44 + dataBytes);
  result.write("RIFF"); result.writeUInt32LE(36 + dataBytes, 4); result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(channels, 22);
  result.writeUInt32LE(sampleRate, 24); result.writeUInt32LE(sampleRate * channels * 2, 28);
  result.writeUInt16LE(channels * 2, 32); result.writeUInt16LE(16, 34); result.write("data", 36); result.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < channels; channel++)
    result.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * (440 + channel * 110) / sampleRate) * 10000), 44 + (i * channels + channel) * 2);
  return result;
}

test("server audio conversion makes deterministic 32 kbps mono MP3 and preserves duration", async () => {
  const source = wav(2);
  const input = file(source, "voice.WAV", "audio/wav");
  const first = await processUploadMedia(input, "audio");
  const second = await processUploadMedia(input, "audio");
  assert.equal(first.fileName, "voice.mp3"); assert.equal(first.mimeType, "audio/mpeg");
  assert.ok(first.buffer.length < source.length / 5);
  assert.deepEqual(first.buffer, second.buffer, "dedup hashes are based on reproducible final bytes");
  const directory = await mkdtemp(join(tmpdir(), "upload-media-test-"));
  try {
    const output = join(directory, "result.mp3"); await writeFile(output, first.buffer);
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { encoding: "utf8" }));
    assert.equal(info.streams[0].codec_name, "mp3"); assert.equal(info.streams[0].bit_rate, "32000");
    assert.equal(info.streams[0].sample_rate, "24000"); assert.equal(info.streams[0].channels, 1);
    const decoded = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"], { maxBuffer: 1024 * 1024 });
    assert.equal(decoded.length / 2 / 24000, 2, "MP3 encoder padding is compensated and the full recording survives");
    assert.equal(info.format.tags, undefined, "private source metadata is not retained");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("AAC/M4A and Opus/WebM inputs normalize to the same mono MP3 contract from stereo inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "upload-media-test-"));
  try {
    const input = join(directory, "input.wav"); await writeFile(input, wav(0.5, 2));
    for (const [extension, encoder, mime] of [["m4a", "aac", "audio/mp4"], ["webm", "libopus", "audio/webm"]]) {
      const encoded = join(directory, `source.${extension}`);
      execFileSync("ffmpeg", ["-v", "error", "-i", input, "-c:a", encoder, "-metadata", "title=private title", encoded]);
      const normalized = await processUploadMedia(file(await readFile(encoded), `source.${extension}`, mime), "audio");
      const output = join(directory, `${extension}.mp3`); await writeFile(output, normalized.buffer);
      const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", output], { encoding: "utf8" }));
      assert.equal(normalized.mimeType, "audio/mpeg"); assert.equal(info.streams[0].channels, 1);
      assert.ok(Math.abs(Number(info.streams[0].duration) - 0.5) < 0.1);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid audio, playlists and overlong audio fail without leaving processing files", async () => {
  const before = (await readdir(tmpdir())).filter(name => name.startsWith(`spatial-memory-upload-${process.pid}-`)).sort();
  await assert.rejects(processUploadMedia(file(Buffer.from("not audio"), "broken.mp3", "audio/mpeg"), "audio"), invalid());
  await assert.rejects(processUploadMedia(file(Buffer.from("#EXTM3U\n#EXTINF:5,\nhttp://127.0.0.1/private.wav\n"), "list.mp3", "audio/mpeg"), "audio"), invalid());
  await assert.rejects(processUploadMedia(file(wav(601, 1, 8000), "long.wav", "audio/wav"), "audio"), invalid(413));
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith(`spatial-memory-upload-${process.pid}-`)).sort(), before);
});

test("streamed MediaRecorder-style WebM without Duration transcodes fully and still enforces ten minutes", async () => {
  const before = (await readdir(tmpdir())).filter(name => name.startsWith(`spatial-memory-upload-${process.pid}-`)).sort();
  const streamedWebm = (seconds: number) => execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `anullsrc=r=8000:cl=mono:d=${seconds}`,
    "-c:a", "libopus", "-b:a", "6k", "-f", "webm", "pipe:1"], { maxBuffer: 16 * 1024 * 1024 });
  const directory = await mkdtemp(join(tmpdir(), "upload-media-test-"));
  try {
    const source = streamedWebm(0.5), input = join(directory, "streamed.webm");
    await writeFile(input, source);
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=duration:format=duration", "-of", "json", input], { encoding: "utf8" }));
    assert.equal(info.streams[0].duration, undefined); assert.equal(info.format.duration, undefined);
    const normalized = await processUploadMedia(file(source, "recording.webm", "audio/webm;codecs=opus"), "audio");
    assert.equal(normalized.mimeType, "audio/mpeg");
    const output = join(directory, "result.mp3"); await writeFile(output, normalized.buffer);
    const decoded = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"], { maxBuffer: 1024 * 1024 });
    assert.equal(decoded.length / 2 / 24000, 0.5, "the entire recording survives even without source duration metadata");
    const tooLong = streamedWebm(601);
    await assert.rejects(processUploadMedia(file(tooLong, "long-recording.webm", "audio/webm"), "audio"),
      (error: unknown) => invalid(413)(error) && error instanceof Error && error.message.includes("10 分钟"));
  } finally { await rm(directory, { recursive: true, force: true }); }
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith(`spatial-memory-upload-${process.pid}-`)).sort(), before);
});

test("photos compress on the server, are correctly oriented and lose EXIF metadata", async () => {
  const width = 2100, height = 1400, pixels = Buffer.alloc(width * height * 3);
  let seed = 1;
  for (let i = 0; i < pixels.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[i] = seed >>> 24; }
  const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const normalized = await processUploadMedia(file(source, "photo.png", "image/png"), "image");
  assert.equal(normalized.mimeType, "image/jpeg"); assert.equal(normalized.fileName, "photo.jpg");
  assert.ok(normalized.buffer.length <= 80 * 1024);
  const metadata = await sharp(normalized.buffer).metadata();
  assert.ok(metadata.width! <= 1024 && metadata.height! <= 1024);
  const anchor = await processUploadMedia(file(source, "anchor.png", "image/png"), "anchor");
  assert.ok(anchor.buffer.length <= 256 * 1024 && anchor.buffer.length > normalized.buffer.length, "reference images keep a larger quality budget than display images");
  const anchorInfo = await sharp(anchor.buffer).metadata();
  assert.ok(anchorInfo.width! <= 1280 && anchorInfo.height! <= 1280);
  const portrait = await sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotated = await processUploadMedia(file(portrait, "portrait.jpeg", "image/jpeg"), "image");
  const rotatedInfo = await sharp(rotated.buffer).metadata();
  assert.equal(rotatedInfo.width, 40); assert.equal(rotatedInfo.height, 80);
  assert.equal(rotatedInfo.orientation, undefined); assert.equal(rotatedInfo.exif, undefined);
  assert.deepEqual((await processUploadMedia(file(portrait, "portrait.jpeg", "image/jpeg"), "image")).buffer, rotated.buffer);
});

test("transparent images keep alpha, anchors use server validation and small images are not enlarged", async () => {
  const rgba = Buffer.from([255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 255]);
  const source = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  const normalized = await processUploadMedia(file(source, "label.png", "image/png"), "image");
  assert.equal(normalized.mimeType, "image/png");
  const decoded = await sharp(normalized.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 2); assert.equal(decoded.info.height, 2);
  assert.equal(decoded.data[3], 0); assert.equal(decoded.data[7], 128); assert.equal(decoded.data[11], 255);
  // A many-colour soft edge catches palette optimizations that preserve a few
  // test pixels but quantize real semi-transparent artwork.
  const gradient = Buffer.alloc(256 * 16 * 4);
  for (let i = 0; i < gradient.length; i += 4) {
    gradient[i] = (i / 4) % 256; gradient[i + 1] = Math.floor(i / 1024) * 16;
    gradient[i + 2] = 255 - gradient[i]; gradient[i + 3] = (i / 4) % 256;
  }
  const gradientPng = await sharp(gradient, { raw: { width: 256, height: 16, channels: 4 } }).png().toBuffer();
  const preserved = await processUploadMedia(file(gradientPng, "edge.png", "image/png"), "image");
  const preservedPixels = await sharp(preserved.buffer).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < gradient.length; i += 4) assert.equal(preservedPixels[i], gradient[i], "PNG keeps every alpha value without resizing");
  assert.ok((await processUploadMedia(file(source, "anchor.png", "image/png"), "anchor")).buffer.length < 1024 * 1024);
  await assert.rejects(processUploadMedia(file(Buffer.from("broken"), "photo.jpg", "image/jpeg"), "image"), invalid());
  await assert.rejects(processUploadMedia(file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), "photo.svg", "image/svg+xml"), "image"), invalid());
  const gif = await sharp(source).gif().toBuffer();
  await assert.rejects(processUploadMedia(file(gif, "fake.png", "image/png"), "anchor"), invalid());
  // A valid PNG header claiming 64 MP must be rejected before pixel allocation.
  const oversized = Buffer.from(source);
  oversized.writeUInt32BE(8000, 16); oversized.writeUInt32BE(8000, 20);
  let crc = 0xffffffff;
  for (const byte of oversized.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  oversized.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  await assert.rejects(processUploadMedia(file(oversized, "huge.png", "image/png"), "image"), invalid());
});

test("concurrent media uploads are bounded and the slot is released after a failure", async () => {
  const input = file(wav(1), "voice.wav", "audio/wav");
  const results = await Promise.allSettled([processUploadMedia(input, "audio"), processUploadMedia(input, "audio"), processUploadMedia(input, "audio")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
  const rejected = results.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && invalid(429)(rejected.reason));
  const raw = Buffer.from("document data");
  const document = await processUploadMedia(file(raw, "notes.txt", "text/plain"), "document");
  assert.deepEqual(document.buffer, raw); assert.equal(document.thumbnail, undefined);
  assert.equal((await processUploadMedia(input, "audio")).mimeType, "audio/mpeg");
});

test("videos normalize to small H.264/AAC MP4 with the index before media for progressive playback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "upload-media-test-"));
  try {
    const input = join(directory, "source.mov");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-c:v", "libx264", "-preset", "ultrafast",
      "-crf", "12", "-c:a", "pcm_s16le", "-metadata", "title=private video", input]);
    const source = await readFile(input);
    const normalized = await processUploadMedia(file(source, "source.mov", "video/quicktime"), "video");
    assert.equal(normalized.fileName, "source.mp4"); assert.equal(normalized.mimeType, "video/mp4");
    assert.ok(normalized.buffer.length < source.length / 4);
    const repeated = await processUploadMedia(file(source, "source.mov", "video/quicktime"), "video");
    assert.deepEqual(repeated.buffer, normalized.buffer);
    assert.ok(normalized.thumbnail);
    assert.equal(normalized.thumbnail.fileName, "source.thumbnail.jpg");
    assert.equal(normalized.thumbnail.mimeType, "image/jpeg");
    assert.deepEqual(repeated.thumbnail?.buffer, normalized.thumbnail.buffer, "thumbnail dedup is deterministic too");
    const thumbnailInfo = await sharp(normalized.thumbnail.buffer).metadata();
    assert.equal(thumbnailInfo.format, "jpeg"); assert.equal(thumbnailInfo.width, 512); assert.equal(thumbnailInfo.height, 288);
    assert.equal(thumbnailInfo.exif, undefined);
    const thumbnailStats = await sharp(normalized.thumbnail.buffer).stats();
    assert.ok(thumbnailStats.channels.some(channel => channel.stdev > 20), "cover contains the video picture");
    const output = join(directory, "result.mp4"); await writeFile(output, normalized.buffer);
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { encoding: "utf8" }));
    const video = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
    const audio = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
    assert.equal(video.codec_name, "h264"); assert.equal(video.pix_fmt, "yuv420p");
    assert.equal(video.width, 640); assert.equal(video.height, 360); assert.equal(video.avg_frame_rate, "24/1");
    assert.equal(audio.codec_name, "aac"); assert.equal(audio.channels, 1); assert.equal(audio.sample_rate, "24000");
    assert.ok(Math.abs(Number(info.format.duration) - 2) < 0.15);
    assert.equal(info.format.tags?.title, undefined);
    // Walk top-level MP4 boxes rather than searching arbitrary encoded bytes.
    const boxes: string[] = [];
    for (let offset = 0; offset + 8 <= normalized.buffer.length;) {
      const size = normalized.buffer.readUInt32BE(offset);
      assert.ok(size >= 8 && offset + size <= normalized.buffer.length);
      boxes.push(normalized.buffer.toString("ascii", offset + 4, offset + 8)); offset += size;
    }
    assert.ok(boxes.includes("moov") && boxes.includes("mdat"));
    assert.ok(boxes.indexOf("moov") < boxes.indexOf("mdat"), "faststart makes metadata available before the video payload");
    execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("silent and portrait videos remain valid without enlarging small inputs or changing their aspect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "upload-media-test-"));
  try {
    for (const [width, height, rate, sar] of [[180, 320, 12, "1"], [720, 1280, 30, "1"], [720, 576, 24, "64/45"]] as const) {
      const input = join(directory, `source-${width}-${height}.mp4`);
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=blue:size=${width}x${height}:rate=${rate}:duration=0.5`, "-vf", `setsar=${sar}`,
        "-c:v", "libx264", "-preset", "ultrafast", input]);
      const normalized = await processUploadMedia(file(await readFile(input), "portrait.mp4", "video/mp4"), "video");
      const output = join(directory, `result-${width}-${height}.mp4`); await writeFile(output, normalized.buffer);
      const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", output], { encoding: "utf8" }));
      assert.equal(info.streams.length, 1); const video = info.streams[0];
      assert.ok(video.width <= width && video.height <= height && video.height <= 640);
      assert.equal(video.width / video.height, sar === "1" ? width / height : 16 / 9);
      assert.equal(video.sample_aspect_ratio, "1:1");
      assert.equal(video.avg_frame_rate, `${Math.min(rate, 24)}/1`);
      assert.ok(normalized.thumbnail);
      const thumbnail = await sharp(normalized.thumbnail.buffer).metadata();
      assert.ok(thumbnail.width! <= Math.min(width, 512) && thumbnail.height! <= Math.min(height, 512));
      assert.ok(Math.abs(thumbnail.width! / thumbnail.height! - video.width / video.height) < 0.01);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("video covers sample beyond a black opening and backfill preserves the same final picture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "upload-media-test-"));
  try {
    const input = join(directory, "opening.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=black:size=320x180:rate=24:duration=2",
      "-vf", "drawbox=color=red:t=fill:enable='gte(t,0.1)'", "-c:v", "libx264", "-preset", "ultrafast", input]);
    const normalized = await processUploadMedia(file(await readFile(input), "opening.mp4", "video/mp4"), "video");
    assert.ok(normalized.thumbnail);
    const { channels } = await sharp(normalized.thumbnail.buffer).stats();
    assert.ok(channels[0].mean > 200 && channels[1].mean < 20 && channels[2].mean < 20, "cover skips the initial black frame");
    const original = file(normalized.buffer, "existing.mp4", "video/mp4");
    Object.defineProperty(original, "arrayBuffer", { value: () => { throw new Error("Backfill must stream the video"); } });
    assert.deepEqual(await generateVideoThumbnail(original), normalized.thumbnail.buffer);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("single-frame low-rate videos still receive a non-empty thumbnail and backfill failures clean up", async () => {
  const before = (await readdir(tmpdir())).filter(name => name.startsWith(`spatial-memory-upload-${process.pid}-`)).sort();
  const directory = await mkdtemp(join(tmpdir(), "upload-media-test-"));
  try {
    const input = join(directory, "single-frame.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=blue:size=32x48:rate=2", "-frames:v", "1", "-c:v", "libx264", input]);
    const normalized = await processUploadMedia(file(await readFile(input), "single-frame.mp4", "video/mp4"), "video");
    assert.ok(normalized.thumbnail);
    const thumbnail = await sharp(normalized.thumbnail.buffer).metadata();
    assert.equal(thumbnail.width, 32); assert.equal(thumbnail.height, 48);
    const stats = await sharp(normalized.thumbnail.buffer).stats();
    assert.ok(stats.channels[2].mean > 200);
    assert.deepEqual(await generateVideoThumbnail(file(normalized.buffer, "old.mp4", "video/mp4")), normalized.thumbnail.buffer);
    await assert.rejects(generateVideoThumbnail(file(Buffer.from("broken"), "bad.mp4", "video/mp4")), invalid());
    await assert.rejects(generateVideoThumbnail(file(Buffer.from("#EXTM3U\nhttp://127.0.0.1/private.mp4\n"), "playlist.mp4", "video/mp4")), invalid());
  } finally { await rm(directory, { recursive: true, force: true }); }
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith(`spatial-memory-upload-${process.pid}-`)).sort(), before);
});

test("five-minute disk-backed videos retain their full soundtrack with a low bitrate even above 5 MiB", async () => {
  assert.equal(VIDEO_MAX_DURATION_SECONDS, 300);
  const directory = await mkdtemp(join(tmpdir(), "upload-media-test-"));
  try {
    const input = join(directory, "five-minutes.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=300",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=300",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-c:a", "aac", "-b:a", "64k", input]);
    const source = new File([await openAsBlob(input)], "five-minutes.mp4", { type: "video/mp4" });
    Object.defineProperty(source, "arrayBuffer", { value: () => { throw new Error("Large video originals must not be buffered in memory"); } });
    const normalized = await processUploadMedia(source, "video");
    assert.ok(normalized.buffer.length > STORED_FILE_MAX_BYTES, "valid video outputs are no longer rejected by the generic 5 MiB limit");
    assert.ok(normalized.buffer.length < (512_000 + 32_000) * 300 / 8 + 1024 * 1024, "file size follows low video/audio bitrates plus container/buffer overhead");
    assert.equal(normalized.mimeType, "video/mp4");
    const output = join(directory, "result.mp4"); await writeFile(output, normalized.buffer);
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { encoding: "utf8" }));
    const video = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
    const audio = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
    assert.ok(Math.abs(Number(info.format.duration) - 300) < 0.15, "five minutes are accepted without size-based truncation");
    assert.ok(Math.abs(Number(video.duration) - 300) < 0.15);
    assert.ok(Math.abs(Number(audio.duration) - 300) < 0.15);
    assert.ok(Number(video.bit_rate) < 530_000, "long clips retain the same low bitrate cap as short clips");
    assert.equal(audio.codec_name, "aac");
    execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("video processing rejects invalid, playlist and overlong sources and cleans up every temporary file", async () => {
  const before = (await readdir(tmpdir())).filter(name => name.startsWith(`spatial-memory-upload-${process.pid}-`)).sort();
  await assert.rejects(processUploadMedia(file(Buffer.from("broken"), "bad.mp4", "video/mp4"), "video"), invalid());
  await assert.rejects(processUploadMedia(file(wav(0.1), "audio.mp4", "video/mp4"), "video"), invalid());
  await assert.rejects(processUploadMedia(file(Buffer.from("#EXTM3U\n#EXTINF:5,\nhttp://127.0.0.1/private.mp4\n"), "list.mp4", "video/mp4"), "video"), invalid());
  const directory = await mkdtemp(join(tmpdir(), "upload-media-test-"));
  try {
    const input = join(directory, "long.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:size=16x16:rate=2:duration=301", "-c:v", "libx264", input]);
    await assert.rejects(processUploadMedia(file(await readFile(input), "long.mp4", "video/mp4"), "video"), invalid(413));
    const historicalCover = await generateVideoThumbnail(file(await readFile(input), "historical-long.mp4", "video/mp4"));
    assert.equal((await sharp(historicalCover).metadata()).format, "jpeg", "cover backfill accepts existing videos beyond the current upload duration limit");
    assert.ok((await sharp(historicalCover).stats()).channels[0].mean > 200);
    // Non-seekable WebM has no duration metadata. It must also be bounded and
    // rejected after decoding instead of being silently cut to an accepted clip.
    for (const seconds of [0.5, 301]) {
      const source = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=red:size=16x16:rate=2:duration=${seconds}`,
        "-c:v", "libvpx", "-f", "webm", "pipe:1"]);
      if (seconds > VIDEO_MAX_DURATION_SECONDS) await assert.rejects(processUploadMedia(file(source, "stream.webm", "video/webm"), "video"), invalid(413));
      else assert.equal((await processUploadMedia(file(source, "stream.webm", "video/webm"), "video")).mimeType, "video/mp4");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith(`spatial-memory-upload-${process.pid}-`)).sort(), before);
});
