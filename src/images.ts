export interface Loaded {
  img: HTMLImageElement;
  blob: Blob;
  alpha: Uint8Array;
  w: number;
  h: number;
  bbox: { x: number; y: number; w: number; h: number };
}

const reg = new Map<string, Loaded>();

export const getImg = (id: string | null | undefined) => (id ? reg.get(id) : undefined);

export function loadImage(id: string, blob: Blob): Promise<Loaded> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true })!;
      x.drawImage(img, 0, 0);
      const data = x.getImageData(0, 0, w, h).data;
      const alpha = new Uint8Array(w * h);
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let i = 0, p = 3; i < w * h; i++, p += 4) {
        const a = data[p];
        alpha[i] = a;
        if (a > 8) {
          const xx = i % w;
          const yy = (i / w) | 0;
          if (xx < minX) minX = xx;
          if (xx > maxX) maxX = xx;
          if (yy < minY) minY = yy;
          if (yy > maxY) maxY = yy;
        }
      }
      const bbox = maxX < 0 ? { x: 0, y: 0, w, h } : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
      const L: Loaded = { img, blob, alpha, w, h, bbox };
      reg.set(id, L);
      resolve(L);
    };
    img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다'));
    img.src = url;
  });
}
