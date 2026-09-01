import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  createManagerDocumentPreview,
  detectManagerDocumentContentType,
} from "./manager-document-preview.ts";

test("래스터 원본은 실제 워터마크가 포함된 WebP 파생본으로만 반환한다", async () => {
  const source = await sharp({
    create: {width: 640, height: 360, channels: 3, background: {r: 210, g: 30, b: 30}},
  }).png().toBuffer();
  const preview = await createManagerDocumentPreview(source, "image/png", "BoDeul Preview Test");
  const stats = await sharp(preview.bytes).stats();

  assert.equal(preview.contentType, "image/webp");
  assert.equal(preview.fileName, "manager-document-preview.webp");
  assert.equal(await detectManagerDocumentContentType(preview.bytes), "image/webp");
  assert.notDeepEqual(preview.bytes, new Uint8Array(source));
  assert.ok(stats.channels.some((channel) => channel.max > channel.min));
});

test("PDF는 격리 래스터화 런타임이 없으므로 원본 구조를 복사하지 않고 fail-closed한다", async () => {
  const sourceBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\nstartxref\n0\n%%EOF");
  assert.equal(await detectManagerDocumentContentType(sourceBytes), "application/pdf");
  await assert.rejects(
    () => createManagerDocumentPreview(sourceBytes, "application/pdf", "BoDeul Preview Test"),
    /격리 렌더러/u,
  );
});

test("확장자나 metadata만 허용 형식인 위장 파일은 파생본 생성 전에 거부한다", async () => {
  await assert.rejects(() => createManagerDocumentPreview(
    new TextEncoder().encode("<html><script>alert(1)</script></html>"),
    "application/pdf",
    "BoDeul Preview Test",
  ));
  await assert.rejects(() => createManagerDocumentPreview(
    new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]),
    "image/jpeg",
    "BoDeul Preview Test",
  ));
  const tinyImage = await sharp({
    create: {width: 32, height: 32, channels: 3, background: {r: 0, g: 0, b: 0}},
  }).png().toBuffer();
  await assert.rejects(() => createManagerDocumentPreview(tinyImage, "image/png", "BoDeul Preview Test"));
  await assert.rejects(() => createManagerDocumentPreview(
    new TextEncoder().encode("%PDF-1.4\n%%EOF"),
    "application/pdf",
    "BoDeul Preview Test",
  ));
});
