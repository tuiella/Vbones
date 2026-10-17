export type M = [number, number, number, number, number, number];
export const I: M = [1, 0, 0, 1, 0, 0];
export const D2R = Math.PI / 180;

export function mul(m: M, n: M): M {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function fromTRS(x: number, y: number, rotDeg: number, sx: number, sy: number): M {
  const r = rotDeg * D2R;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c * sx, s * sx, -s * sy, c * sy, x, y];
}

export function inv(m: M): M {
  const [a, b, c, d, e, f] = m;
  let det = a * d - b * c;
  if (Math.abs(det) < 1e-12) det = 1e-12;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

export function apply(m: M, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function applyVec(m: M, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
}

export function decompose(m: M) {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b) || 1e-9;
  const rot = Math.atan2(b, a) / D2R;
  const sy = (a * d - b * c) / sx;
  return { x: e, y: f, rotation: rot, scaleX: sx, scaleY: sy };
}

export const angleOf = (m: M) => Math.atan2(m[1], m[0]) / D2R;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const r4 = (v: number) => Math.round(v * 10000) / 10000;
export const uid = () => Math.random().toString(36).slice(2, 10);
export function normDeg(d: number) {
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
