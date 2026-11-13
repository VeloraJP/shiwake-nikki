// Shift-JIS (CP932) encoder. Uses the generated mapping table in sjis-table.js.
// Characters that cannot be represented are replaced with '?' (0x3F).
import { SJIS_TABLE } from './sjis-table.js?v=11';

export function encodeSJIS(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) {
      bytes.push(cp);
      continue;
    }
    const b = SJIS_TABLE[cp];
    if (b) {
      for (const x of b) bytes.push(x);
    } else {
      bytes.push(0x3f);
    }
  }
  return new Uint8Array(bytes);
}

// Approximate Shift-JIS byte length (ASCII / halfwidth = 1 byte, others = 2 bytes).
// Used only for truncation decisions, not for encoding.
export function sjisByteLength(text) {
  let n = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80 || (cp >= 0xff61 && cp <= 0xff9f)) n += 1;
    else n += 2;
  }
  return n;
}

export function truncateBySjisBytes(text, maxBytes) {
  let out = '';
  let n = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    const w = cp < 0x80 || (cp >= 0xff61 && cp <= 0xff9f) ? 1 : 2;
    if (n + w > maxBytes) break;
    out += ch;
    n += w;
  }
  return out;
}
