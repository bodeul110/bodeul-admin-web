import assert from "node:assert/strict";
import test from "node:test";

import {PDFDocument, PDFName} from "pdf-lib";
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

test("PDF는 위험한 catalog와 page action을 제거한 새 문서의 모든 페이지에 워터마크를 추가한다", async () => {
  const source = await PDFDocument.create();
  const first = source.addPage([500, 700]);
  const second = source.addPage([500, 700]);
  source.catalog.set(PDFName.of("OpenAction"), source.context.obj({S: "JavaScript", JS: "app.alert('x')"}));
  source.catalog.set(PDFName.of("Names"), source.context.obj({JavaScript: {Names: []}, EmbeddedFiles: {Names: []}}));
  source.catalog.set(PDFName.of("AcroForm"), source.context.obj({Fields: []}));
  first.node.set(PDFName.of("AA"), source.context.obj({O: {S: "JavaScript", JS: "app.alert('x')"}}));
  second.node.set(PDFName.of("Annots"), source.context.obj([]));
  const sourceBytes = await source.save();

  const preview = await createManagerDocumentPreview(sourceBytes, "application/pdf", "BoDeul Preview Test");
  const parsed = await PDFDocument.load(preview.bytes, {updateMetadata: false});

  assert.equal(preview.contentType, "application/pdf");
  assert.equal(preview.fileName, "manager-document-preview.pdf");
  assert.equal(parsed.getPageCount(), 2);
  assert.equal(parsed.catalog.has(PDFName.of("OpenAction")), false);
  assert.equal(parsed.catalog.has(PDFName.of("Names")), false);
  assert.equal(parsed.catalog.has(PDFName.of("AcroForm")), false);
  parsed.getPages().forEach((page) => {
    assert.equal(page.node.has(PDFName.of("AA")), false);
    assert.equal(page.node.has(PDFName.of("Annots")), false);
    assert.ok(page.node.get(PDFName.of("Contents")));
  });
  assert.notDeepEqual(preview.bytes, sourceBytes);
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
  const tinyPdf = await PDFDocument.create();
  tinyPdf.addPage([32, 32]);
  const tinyPdfBytes = await tinyPdf.save();
  await assert.rejects(() => createManagerDocumentPreview(
    tinyPdfBytes,
    "application/pdf",
    "BoDeul Preview Test",
  ));
});
