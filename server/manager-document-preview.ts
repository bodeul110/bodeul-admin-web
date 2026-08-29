import {PDFDocument, PDFName, StandardFonts, degrees, rgb} from "pdf-lib";
import sharp from "sharp";

import type {InlineManagerDocumentContentType} from "./manager-document-response.ts";

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_PDF_PAGES = 50;
const MIN_IMAGE_EDGE_PIXELS = 64;
const MIN_PDF_PAGE_POINTS = 72;
const MAX_PDF_PAGE_POINTS = 20_000;

export type ManagerDocumentPreview = {
  readonly bytes: Uint8Array;
  readonly contentType: "application/pdf" | "image/webp";
  readonly fileName: "manager-document-preview.pdf" | "manager-document-preview.webp";
};

export async function createManagerDocumentPreview(
  bytes: Uint8Array,
  declaredContentType: InlineManagerDocumentContentType,
  watermarkText: string,
): Promise<ManagerDocumentPreview> {
  const detectedContentType = await detectManagerDocumentContentType(bytes);
  if (detectedContentType !== declaredContentType) {
    throw codedError("P0004", "문서 metadata와 실제 파일 형식이 다릅니다.");
  }
  if (detectedContentType === "application/pdf") {
    return createPdfPreview(bytes, watermarkText);
  }
  return createImagePreview(bytes, watermarkText);
}

export async function detectManagerDocumentContentType(
  bytes: Uint8Array,
): Promise<InlineManagerDocumentContentType> {
  if (isPdf(bytes)) {
    return "application/pdf";
  }
  const signatureType = imageSignatureType(bytes);
  if (!signatureType) {
    throw codedError("P0004", "PDF, JPEG, PNG, WebP 파일만 미리볼 수 있습니다.");
  }
  try {
    const metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    }).metadata();
    const decodedType = metadata.format === "jpeg"
      ? "image/jpeg"
      : metadata.format === "png"
        ? "image/png"
        : metadata.format === "webp"
          ? "image/webp"
          : null;
    if (!decodedType || decodedType !== signatureType || !metadata.width || !metadata.height
        || metadata.width < MIN_IMAGE_EDGE_PIXELS || metadata.height < MIN_IMAGE_EDGE_PIXELS) {
      throw new Error("이미지 형식 또는 크기를 확인하지 못했습니다.");
    }
    return decodedType;
  } catch {
    throw codedError("P0004", "이미지 바이트를 안전하게 해석하지 못했습니다.");
  }
}

async function createImagePreview(bytes: Uint8Array, watermarkText: string): Promise<ManagerDocumentPreview> {
  try {
    const normalized = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .toColourspace("srgb")
      .toBuffer({resolveWithObject: true});
    const width = normalized.info.width;
    const height = normalized.info.height;
    if (!width || !height) {
      throw new Error("이미지 크기를 확인하지 못했습니다.");
    }
    const overlay = watermarkSvg(width, height, watermarkText);
    const output = await sharp(normalized.data, {limitInputPixels: MAX_IMAGE_PIXELS})
      .composite([{input: Buffer.from(overlay, "utf8"), blend: "over"}])
      .webp({quality: 84, effort: 4})
      .toBuffer();
    return {
      bytes: new Uint8Array(output),
      contentType: "image/webp",
      fileName: "manager-document-preview.webp",
    };
  } catch (error) {
    if (hasCode(error, "P0004")) throw error;
    throw codedError("P0004", "이미지 미리보기 파생본을 만들지 못했습니다.");
  }
}

async function createPdfPreview(bytes: Uint8Array, watermarkText: string): Promise<ManagerDocumentPreview> {
  try {
    const sourceDocument = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    const sourcePages = sourceDocument.getPages();
    if (sourcePages.length < 1 || sourcePages.length > MAX_PDF_PAGES) {
      throw new Error("PDF 페이지 수를 허용 범위에서 확인하지 못했습니다.");
    }
    for (const key of ["OpenAction", "AA", "Names", "AcroForm", "Outlines", "Metadata", "Perms"]) {
      sourceDocument.catalog.delete(PDFName.of(key));
    }
    for (const page of sourcePages) {
      page.node.delete(PDFName.of("Annots"));
      page.node.delete(PDFName.of("AA"));
      page.node.delete(PDFName.of("Metadata"));
    }

    // 새 문서로 페이지만 복사해 원본 catalog, 첨부, 메타데이터 객체가 파생본에 남지 않게 한다.
    const document = await PDFDocument.create();
    const copiedPages = await document.copyPages(
      sourceDocument,
      sourcePages.map((_, index) => index),
    );
    copiedPages.forEach((page) => {
      document.addPage(page);
      page.node.delete(PDFName.of("Annots"));
      page.node.delete(PDFName.of("AA"));
      page.node.delete(PDFName.of("Metadata"));
    });
    const pages = document.getPages();
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (const page of pages) {
      const {width, height} = page.getSize();
      if (!Number.isFinite(width) || !Number.isFinite(height)
          || width < MIN_PDF_PAGE_POINTS || height < MIN_PDF_PAGE_POINTS
          || width > MAX_PDF_PAGE_POINTS || height > MAX_PDF_PAGE_POINTS) {
        throw new Error("PDF 페이지 크기를 허용 범위에서 확인하지 못했습니다.");
      }
      const fontSize = Math.max(11, Math.min(22, width / 28));
      const stepY = Math.max(90, height / 6);
      for (let y = 30; y < height; y += stepY) {
        page.drawText(watermarkText, {
          x: 24,
          y,
          size: fontSize,
          font,
          color: rgb(0.2, 0.25, 0.32),
          opacity: 0.28,
          rotate: degrees(-24),
        });
      }
    }
    document.setTitle("BoDeul protected manager document preview");
    document.setAuthor("BoDeul Admin Server");
    document.setCreator("BoDeul Admin Server");
    document.setProducer("BoDeul Admin Server");
    document.setSubject("Watermarked preview derivative");
    document.setKeywords(["BoDeul", "protected-preview"]);
    document.getPages().forEach((page) => {
      page.node.delete(PDFName.of("Annots"));
      page.node.delete(PDFName.of("AA"));
      page.node.delete(PDFName.of("Metadata"));
    });
    const output = await document.save({useObjectStreams: true, addDefaultPage: false});
    return {
      bytes: output,
      contentType: "application/pdf",
      fileName: "manager-document-preview.pdf",
    };
  } catch (error) {
    if (hasCode(error, "P0004")) throw error;
    throw codedError("P0004", "PDF 미리보기 파생본을 만들지 못했습니다.");
  }
}

function isPdf(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const header = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 8))).toString("ascii");
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 2048))).toString("latin1");
  return header.startsWith("%PDF-") && tail.includes("%%EOF");
}

function imageSignatureType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 12
      && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
      && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function watermarkSvg(width: number, height: number, text: string): string {
  const safeText = escapeXml(text);
  const fontSize = Math.max(12, Math.min(24, Math.floor(width / 25)));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    "<defs>",
    `<pattern id="wm" width="360" height="150" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">`,
    `<text x="12" y="76" font-family="sans-serif" font-size="${fontSize}" font-weight="600"`,
    " fill=\"white\" fill-opacity=\"0.42\" stroke=\"#172033\" stroke-opacity=\"0.28\" stroke-width=\"1\">",
    `${safeText}</text></pattern></defs>`,
    '<rect width="100%" height="100%" fill="url(#wm)"/>',
    "</svg>",
  ].join("");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function hasCode(value: unknown, code: string): boolean {
  return value !== null && typeof value === "object" && "code" in value
    && (value as {readonly code?: unknown}).code === code;
}

function codedError(code: string, message: string): Error & {readonly code: string} {
  return Object.assign(new Error(message), {code});
}
