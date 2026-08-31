function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32(8 + payload.length), new TextEncoder().encode(type), payload);
}

function fullBox(type: string, payload: Uint8Array): Uint8Array {
  return box(type, concat(new Uint8Array(4), payload));
}

function nal(type: number, length = 8): Uint8Array {
  const payload = new Uint8Array(length);
  payload[0] = type & 0x1f;
  payload.fill(0x80, 1);
  return concat(u32(payload.length), payload);
}

function sampleEntryAvc1(): Uint8Array {
  const visual = new Uint8Array(78);
  visual[7] = 1;
  const avccPayload = new Uint8Array([
    0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x00, 0x01, 0x00, 0x00,
  ]);
  return box('avc1', concat(visual, box('avcC', avccPayload)));
}

export function buildAvcMp4(options: {
  idrAt: number[];
  stss: number[];
  extraPFrames?: number;
}): Uint8Array {
  const extra = options.extraPFrames ?? 0;
  const sampleCount = Math.max(...options.stss, ...options.idrAt, 1) + extra;
  const samples: Uint8Array[] = [];
  const sizes: number[] = [];
  for (let i = 1; i <= sampleCount; i++) {
    const body = options.idrAt.includes(i) ? nal(5) : nal(1);
    samples.push(body);
    sizes.push(body.length);
  }
  const mdat = box('mdat', concat(...samples));

  const stsd = fullBox('stsd', concat(u32(1), sampleEntryAvc1()));
  const stts = fullBox('stts', concat(u32(1), u32(sampleCount), u32(1)));
  const stss = fullBox('stss', concat(u32(options.stss.length), ...options.stss.map(u32)));
  const stsc = fullBox('stsc', concat(u32(1), u32(1), u32(sampleCount), u32(1)));
  const stsz = fullBox('stsz', concat(u32(0), u32(sampleCount), ...sizes.map(u32)));

  const buildWithOffset = (chunkOffset: number) => {
    const stco = fullBox('stco', concat(u32(1), u32(chunkOffset)));
    const stbl = box('stbl', concat(stsd, stts, stss, stsc, stsz, stco));
    const minf = box('minf', stbl);
    const mdia = box('mdia', minf);
    const trak = box('trak', mdia);
    return box('moov', trak);
  };

  const ftyp = box(
    'ftyp',
    concat(new TextEncoder().encode('mp42'), u32(0), new TextEncoder().encode('isom')),
  );
  let moov = buildWithOffset(0);
  const chunkOffset = ftyp.length + moov.length + 8;
  moov = buildWithOffset(chunkOffset);
  return concat(ftyp, moov, mdat);
}

export function buildBrokenAvcMp4(): Uint8Array {
  return buildAvcMp4({ idrAt: [1, 5], stss: [1, 2, 3, 4, 5, 6], extraPFrames: 1 });
}
