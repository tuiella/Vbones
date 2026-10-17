import { importFiles } from './importer';

const S = 512;
const INK = '#2b2233';
const SKIN = '#ffe0c8';
const HAIR = '#7a4a2e';
const SHIRT = '#4f7fd8';
const PANTS = '#3a3f58';

type Draw = (c: CanvasRenderingContext2D) => void;

function part(name: string, draw: Draw): Promise<File> {
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d')!;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = INK;
  c.lineWidth = 6;
  draw(c);
  return new Promise((res) => cv.toBlob((b) => res(new File([b!], name + '.png', { type: 'image/png' })), 'image/png'));
}

const fs = (c: CanvasRenderingContext2D, fill: string) => {
  c.fillStyle = fill;
  c.fill();
  c.stroke();
};

function limb(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, fill: string) {
  c.lineWidth = w + 12;
  c.strokeStyle = INK;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.lineWidth = w;
  c.strokeStyle = fill;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.lineWidth = 6;
  c.strokeStyle = INK;
}

function eyes(c: CanvasRenderingContext2D, kind: 'normal' | 'blink' | 'angry') {
  for (const x of [218, 294]) {
    if (kind === 'blink') {
      c.beginPath(); c.arc(x, 200, 16, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
      continue;
    }
    c.beginPath(); c.ellipse(x, 202, 13, 21, 0, 0, Math.PI * 2); c.fillStyle = INK; c.fill();
    c.beginPath(); c.arc(x + 4, 194, 5, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
    if (kind === 'angry') {
      const d = x < 256 ? 1 : -1;
      c.beginPath(); c.moveTo(x - 20 * d, 166); c.lineTo(x + 18 * d, 178); c.stroke();
    }
  }
}

export async function loadDemo() {
  const files = await Promise.all([
    part('Hair_Back', (c) => {
      c.beginPath(); c.ellipse(256, 190, 122, 118, 0, 0, Math.PI * 2); fs(c, HAIR);
      c.beginPath(); c.moveTo(150, 220); c.quadraticCurveTo(130, 300, 165, 330); c.lineTo(200, 260); c.closePath(); fs(c, HAIR);
      c.beginPath(); c.moveTo(362, 220); c.quadraticCurveTo(382, 300, 347, 330); c.lineTo(312, 260); c.closePath(); fs(c, HAIR);
    }),
    part('Leg_L', (c) => {
      limb(c, 236, 372, 234, 440, 26, PANTS);
      c.beginPath(); c.ellipse(228, 452, 22, 12, 0, 0, Math.PI * 2); fs(c, '#5a3a2a');
    }),
    part('Leg_R', (c) => {
      limb(c, 276, 372, 278, 440, 26, PANTS);
      c.beginPath(); c.ellipse(284, 452, 22, 12, 0, 0, Math.PI * 2); fs(c, '#5a3a2a');
    }),
    part('Body', (c) => {
      c.beginPath();
      c.moveTo(222, 288); c.lineTo(290, 288); c.quadraticCurveTo(310, 330, 306, 384);
      c.lineTo(206, 384); c.quadraticCurveTo(202, 330, 222, 288); c.closePath(); fs(c, SHIRT);
      c.beginPath(); c.moveTo(206, 360); c.lineTo(306, 360); c.stroke();
    }),
    part('Arm_L', (c) => {
      limb(c, 218, 304, 190, 362, 22, SHIRT);
      c.beginPath(); c.arc(186, 370, 14, 0, Math.PI * 2); fs(c, SKIN);
    }),
    part('Arm_R', (c) => {
      limb(c, 294, 304, 322, 362, 22, SHIRT);
      c.beginPath(); c.arc(326, 370, 14, 0, Math.PI * 2); fs(c, SKIN);
    }),
    part('Sword', (c) => {
      c.beginPath(); c.rect(320, 196, 14, 160); fs(c, '#dfe6ee');
      c.beginPath(); c.moveTo(320, 196); c.lineTo(327, 176); c.lineTo(334, 196); c.closePath(); fs(c, '#dfe6ee');
      c.beginPath(); c.rect(304, 352, 46, 10); fs(c, '#c9a227');
      c.beginPath(); c.rect(321, 362, 12, 30); fs(c, '#6b3f22');
    }),
    part('Head', (c) => {
      c.beginPath(); c.ellipse(256, 196, 106, 98, 0, 0, Math.PI * 2); fs(c, SKIN);
      c.beginPath(); c.ellipse(196, 236, 14, 8, 0, 0, Math.PI * 2); c.fillStyle = '#ffb3a7'; c.fill();
      c.beginPath(); c.ellipse(316, 236, 14, 8, 0, 0, Math.PI * 2); c.fill();
    }),
    part('Eye', (c) => eyes(c, 'normal')),
    part('Eye@Blink', (c) => eyes(c, 'blink')),
    part('Eye@Angry', (c) => eyes(c, 'angry')),
    part('Mouth', (c) => { c.beginPath(); c.moveTo(246, 250); c.lineTo(266, 250); c.stroke(); }),
    part('Mouth@Open', (c) => { c.beginPath(); c.ellipse(256, 254, 13, 15, 0, 0, Math.PI * 2); fs(c, '#a33a3a'); }),
    part('Mouth@Smile', (c) => { c.beginPath(); c.arc(256, 240, 16, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke(); }),
    part('Hair_Front', (c) => {
      c.beginPath();
      c.moveTo(146, 190);
      c.bezierCurveTo(140, 80, 372, 80, 366, 190);
      c.lineTo(340, 150); c.lineTo(318, 172); c.lineTo(296, 140); c.lineTo(268, 168);
      c.lineTo(244, 138); c.lineTo(218, 170); c.lineTo(194, 146); c.lineTo(172, 176);
      c.closePath(); fs(c, HAIR);
    }),
  ]);
  await importFiles(files);
}
