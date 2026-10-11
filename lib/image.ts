/** Minimal header sniffing for uploaded images: format + pixel dimensions, no decoding. */
export interface ImageInfo { format: "webp" | "jpeg" | "png"; width: number; height: number }

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  return parseWebp(bytes) ?? parseJpeg(bytes) ?? parsePng(bytes);
}

export const extensionFor = (format: ImageInfo["format"]) => (format === "webp" ? ".webp" : format === "png" ? ".png" : ".jpg");
export const mimeFor = (format: ImageInfo["format"]) => (format === "webp" ? "image/webp" : format === "png" ? "image/png" : "image/jpeg");
export const mimeForKey = (key: string) => (/\.webp$/i.test(key) ? "image/webp" : /\.png$/i.test(key) ? "image/png" : "image/jpeg");

export function parseWebp(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 30) return null;
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") return null;
  const chunk = ascii(12, 4);
  const u16 = (o: number) => bytes[o] | (bytes[o + 1] << 8);
  const u24 = (o: number) => bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { format: "webp", width: u16(26) & 0x3fff, height: u16(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
    return {
      format: "webp",
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8X") return { format: "webp", width: 1 + u24(24), height: 1 + u24(27) };
  return null;
}

export function parsePng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => bytes[i] === b)) return null;
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { format: "png", width: u32(16), height: u32(20) };
}

/** JPEG: walk the marker segments until a SOFn frame header, which carries the dimensions. */
export function parseJpeg(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < bytes.length) {
    if (bytes[o] !== 0xff) { o++; continue; }
    const marker = bytes[o + 1];
    if (marker === 0xff) { o++; continue; }                 // padding
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { o += 2; continue; } // no payload
    const len = (bytes[o + 2] << 8) | bytes[o + 3];
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      return { format: "jpeg", height: (bytes[o + 5] << 8) | bytes[o + 6], width: (bytes[o + 7] << 8) | bytes[o + 8] };
    }
    if (marker === 0xda) break; // start of scan: no SOF seen, give up
    o += 2 + len;
  }
  return null;
}
