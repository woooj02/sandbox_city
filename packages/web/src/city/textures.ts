import { Texture } from 'pixi.js';

function canvas(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const el = document.createElement('canvas');
  el.width = el.height = size;
  const c = el.getContext('2d')!;
  draw(c, size);
  return Texture.from(el);
}

export function makeTextures() {
  const backgrounds: Texture[] = [];
  const glow = canvas(64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  });
  const dot = canvas(16, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  });
  const ring = canvas(128, (c, s) => {
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 10;
    c.beginPath(); c.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,1)'; c.lineWidth = 3;
    c.beginPath(); c.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2); c.stroke();
  });
  const hex = canvas(128, (c, s) => {
    const r = s / 2 - 10;
    const path = () => { c.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; c.lineTo(s / 2 + r * Math.cos(a), s / 2 + r * Math.sin(a)); } c.closePath(); };
    c.fillStyle = 'rgba(255,255,255,0.12)'; path(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 9; path(); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,1)'; c.lineWidth = 3; path(); c.stroke();
  });
  const spark = canvas(64, (c, s) => {
    const g = c.createLinearGradient(0, s / 2, s, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g; c.fillRect(0, s / 2 - 2, s, 4);
  });
  const cross = canvas(64, (c, s) => {
    c.strokeStyle = 'white'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(14, 14); c.lineTo(s - 14, s - 14); c.moveTo(s - 14, 14); c.lineTo(14, s - 14); c.stroke();
  });
  const diamond = canvas(64, (c, s) => {
    c.fillStyle = 'rgba(255,255,255,0.15)'; c.strokeStyle = 'white'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(s / 2, 6); c.lineTo(s - 6, s / 2); c.lineTo(s / 2, s - 6); c.lineTo(6, s / 2); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(s / 2, 20); c.lineTo(s - 20, s / 2); c.lineTo(s / 2, s - 20); c.lineTo(20, s / 2); c.closePath(); c.stroke();
  });
  const dashRing = canvas(128, (c, s) => {
    c.strokeStyle = 'white'; c.lineWidth = 2.5; c.setLineDash([10, 9]);
    c.beginPath(); c.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2); c.stroke();
  });
  const lock = canvas(64, (c, s) => {
    c.strokeStyle = 'white'; c.lineWidth = 5; c.fillStyle = 'rgba(255,255,255,0.25)';
    c.beginPath(); c.arc(s / 2, s / 2 - 6, 11, Math.PI, 0); c.stroke();
    c.fillRect(s / 2 - 17, s / 2 - 4, 34, 26); c.strokeRect(s / 2 - 17, s / 2 - 4, 34, 26);
  });
  const bg = (w: number, h: number) => {
    const el = document.createElement('canvas');
    el.width = w; el.height = h;
    const c = el.getContext('2d')!;
    const g = c.createRadialGradient(w * 0.5, h * 0.45, 50, w * 0.5, h * 0.5, w * 0.75);
    g.addColorStop(0, '#0d1030'); g.addColorStop(0.6, '#070818'); g.addColorStop(1, '#03030a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    // fine grid
    c.strokeStyle = 'rgba(90,120,255,0.07)'; c.lineWidth = 1;
    for (let x = 0; x < w; x += 25) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 0; y < h; y += 25) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.strokeStyle = 'rgba(120,150,255,0.12)';
    for (let x = 0; x < w; x += 100) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 0; y < h; y += 100) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    // noise speckle
    for (let i = 0; i < 2400; i++) { c.fillStyle = `rgba(160,180,255,${Math.random() * 0.08})`; c.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
    const texture = Texture.from(el);
    backgrounds.push(texture);
    return texture;
  };
  return { glow, dot, ring, hex, spark, cross, diamond, dashRing, lock, bg,
    destroy: () => { for (const texture of [glow, dot, ring, hex, spark, cross, diamond, dashRing, lock, ...backgrounds]) texture.destroy(true); backgrounds.length = 0; },
  };
}
export type Textures = ReturnType<typeof makeTextures>;
