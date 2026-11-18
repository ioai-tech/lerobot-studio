// Reference: camera spread of 4 plain <video> elements started together (no viewer).
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://127.0.0.1:4877/manifest/f22.json');
const r = await p.evaluate(async () => {
  const files = await (await fetch('/manifest/f22.json')).json();
  document.body.innerHTML = '';
  const els = files
    .filter((f) => f.logicalPath.endsWith('.mp4'))
    .map((f) => {
      const v = document.createElement('video');
      v.muted = true;
      v.crossOrigin = 'anonymous';
      v.src = f.presignedUrl;
      v.style.width = '600px';
      document.body.append(v);
      return v;
    });
  await Promise.all(
    els.map((v) => new Promise((r) => v.addEventListener('canplaythrough', r, { once: true }))),
  );
  els.forEach((v) => (v.currentTime = 600));
  await Promise.all(
    els.map((v) => new Promise((r) => v.addEventListener('canplaythrough', r, { once: true }))),
  );
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 480;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const dec = (v) => {
    ctx.drawImage(v, 0, 0, 640, 480);
    const d = ctx.getImageData(0, 436, 640, 1).data;
    let x = 0;
    for (let k = 0; k < 16; k++) if (d[(8 + k * 39 + 16) * 4] > 128) x |= 1 << k;
    return x;
  };
  els.forEach((v) => v.play());
  const spreads = [];
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const vals = els.map(dec);
    spreads.push(Math.max(...vals) - Math.min(...vals));
  }
  spreads.sort((a, b) => a - b);
  return {
    p50: spreads[60],
    p95: spreads[114],
    max: spreads[119],
    dropped: els.map((v) => v.getVideoPlaybackQuality().droppedVideoFrames),
  };
});
console.log(JSON.stringify(r));
await b.close();
