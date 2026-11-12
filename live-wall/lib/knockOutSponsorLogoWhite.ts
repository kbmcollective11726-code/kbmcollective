/**
 * Flood-fill light plate from image edges → transparent PNG data URL.
 * Clears white and light-gray paper backgrounds so logos sit on the dark live wall.
 * Falls back to the original URL if canvas/CORS fails.
 */

function isPlatePixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 8) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max >= 205 && max - min <= 36;
}

export async function knockOutSponsorLogoWhite(src: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('logo load failed'));
    el.src = src;
  });

  const cw = Math.max(1, img.naturalWidth || img.width);
  const ch = Math.max(1, img.naturalHeight || img.height);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return src;

  ctx.drawImage(img, 0, 0, cw, ch);
  const image = ctx.getImageData(0, 0, cw, ch);
  const { data } = image;
  const visited = new Uint8Array(cw * ch);
  const stack: number[] = [];

  const pushIfPlate = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= cw || y >= ch) return;
    const i = y * cw + x;
    if (visited[i]) return;
    const o = i * 4;
    if (!isPlatePixel(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0, data[o + 3] ?? 0)) return;
    visited[i] = 1;
    stack.push(i);
  };

  for (let x = 0; x < cw; x += 1) {
    pushIfPlate(x, 0);
    pushIfPlate(x, ch - 1);
  }
  for (let y = 0; y < ch; y += 1) {
    pushIfPlate(0, y);
    pushIfPlate(cw - 1, y);
  }

  while (stack.length) {
    const i = stack.pop()!;
    const o = i * 4;
    data[o + 3] = 0;
    const x = i % cw;
    const y = (i / cw) | 0;
    pushIfPlate(x + 1, y);
    pushIfPlate(x - 1, y);
    pushIfPlate(x, y + 1);
    pushIfPlate(x, y - 1);
  }

  // Clear fringe next to knocked-out plate.
  for (let y = 1; y < ch - 1; y += 1) {
    for (let x = 1; x < cw - 1; x += 1) {
      const i = y * cw + x;
      const o = i * 4;
      if ((data[o + 3] ?? 0) === 0) continue;
      if (!isPlatePixel(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0, 255)) continue;
      let touchClear = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if ((data[((y + dy) * cw + (x + dx)) * 4 + 3] ?? 0) === 0) {
          touchClear = true;
          break;
        }
      }
      if (touchClear) data[o + 3] = 0;
    }
  }

  ctx.putImageData(image, 0, 0);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return src;
  }
}
