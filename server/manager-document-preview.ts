import sharp from "sharp";

import type {InlineManagerDocumentContentType} from "./manager-document-response.ts";

const MAX_IMAGE_PIXELS = 40_000_000;
const MIN_IMAGE_EDGE_PIXELS = 64;

export type ManagerDocumentPreview = {
  readonly bytes: Uint8Array;
  readonly contentType: "image/webp";
  readonly fileName: "manager-document-preview.webp";
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
    throw codedError(
      "P0004",
      "PDF는 안전한 격리 렌더러가 준비될 때까지 관리자 웹 미리보기를 지원하지 않습니다. 이미지로 다시 제출해 주세요.",
    );
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
