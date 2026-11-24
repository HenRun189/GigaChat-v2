import { PLACE_COOLDOWN_SECONDS, PLACE_PALETTE, PLACE_SIZE, type PlaceLeaderboardEntry } from '@gigachat/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { BackIcon, StarIcon } from '../../components/icons';
import { Sheet } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useStore } from '../../lib/store';
import { onPlacePixel } from '../../lib/ws';

interface View {
  scale: number;
  x: number;
  y: number;
}

export function PlacePage() {
  const navigate = useNavigate();
  const toast = useStore((s) => s.toast);
  const me = useStore((s) => s.me)!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ scale: 3, x: 0, y: 0 });
  const [color, setColor] = useState<string>(PLACE_PALETTE[4]);
  const [cooldown, setCooldown] = useState(0);
  const [pixelsSet, setPixelsSet] = useState(me.pixelsSet);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [board, setBoard] = useState<PlaceLeaderboardEntry[] | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; startDist: number; startScale: number; last: { x: number; y: number } } | null>(null);

  const applyView = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const v = viewRef.current;
    c.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
  }, []);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { width, height } = stage.getBoundingClientRect();
    const scale = Math.max(1, Math.floor((Math.min(width, height) - 24) / PLACE_SIZE * 10) / 10);
    viewRef.current = { scale, x: (width - PLACE_SIZE * scale) / 2, y: (height - PLACE_SIZE * scale) / 2 };
    applyView();
  }, [applyView]);

  // Load canvas + initial data.
  useEffect(() => {
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PLACE_SIZE, PLACE_SIZE);
    fit();
    api
      .blob('/api/place/canvas')
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        const img = ctx.createImageData(PLACE_SIZE, PLACE_SIZE);
        for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4) {
          img.data[j] = bytes[i];
          img.data[j + 1] = bytes[i + 1];
          img.data[j + 2] = bytes[i + 2];
          img.data[j + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      })
      .catch((e) => toast(errorMessage(e), 'error'));
    api.get<{ pixelsSet: number; cooldown: number }>('/api/place/me').then((r) => { setPixelsSet(r.pixelsSet); setCooldown(r.cooldown); }).catch(() => {});
    const unsub = onPlacePixel((e) => {
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x, e.y, 1, 1);
    });
    window.addEventListener('resize', fit);
    return () => {
      unsub();
      window.removeEventListener('resize', fit);
    };
  }, [fit, toast]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const toPixel = (clientX: number, clientY: number) => {
    const rect = stageRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    const px = Math.floor((clientX - rect.left - v.x) / v.scale);
    const py = Math.floor((clientY - rect.top - v.y) / v.scale);
    return px >= 0 && py >= 0 && px < PLACE_SIZE && py < PLACE_SIZE ? { x: px, y: py } : null;
  };

  const place = async (p: { x: number; y: number }) => {
    if (cooldown > 0) return toast(`Noch ${cooldown}s warten`);
    try {
      const r = await api.post<{ pixelsSet: number; cooldown: number }>('/api/place/pixel', { ...p, color });
      setPixelsSet(r.pixelsSet);
      setCooldown(r.cooldown);
      const ctx = canvasRef.current!.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(p.x, p.y, 1, 1);
      navigator.vibrate?.(8);
    } catch (e) {
      const err = e as { details?: { seconds?: number } };
      if (err.details?.seconds) setCooldown(err.details.seconds);
      toast(errorMessage(e), 'error');
    }
  };

  // --- pointer handling: tap = place, drag = pan, pinch/wheel = zoom ---
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = {
      moved: false,
      startDist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      startScale: viewRef.current.scale,
      last: { x: e.clientX, y: e.clientY },
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!pointers.current.has(e.pointerId)) {
      setHover(toPixel(e.clientX, e.clientY));
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (g.startDist === 0) g.startDist = dist;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      zoomAt(mid.x, mid.y, (g.startScale * dist) / g.startDist);
      g.moved = true;
      return;
    }
    const dx = e.clientX - g.last.x;
    const dy = e.clientY - g.last.y;
    if (Math.abs(dx) + Math.abs(dy) > 3 || g.moved) {
      g.moved = true;
      viewRef.current.x += dx;
      viewRef.current.y += dy;
      applyView();
    }
    g.last = { x: e.clientX, y: e.clientY };
    setHover(toPixel(e.clientX, e.clientY));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      if (g && !g.moved) {
        const p = toPixel(e.clientX, e.clientY);
        if (p) void place(p);
      }
      gesture.current = null;
    } else if (g) {
      g.startDist = 0;
      g.startScale = viewRef.current.scale;
      const rest = [...pointers.current.values()][0];
      g.last = rest;
    }
  };

  const zoomAt = (cx: number, cy: number, next: number) => {
    const rect = stageRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    const scale = Math.min(40, Math.max(1, next));
    const wx = (cx - rect.left - v.x) / v.scale;
    const wy = (cy - rect.top - v.y) / v.scale;
    viewRef.current = { scale, x: cx - rect.left - wx * scale, y: cy - rect.top - wy * scale };
    applyView();
  };

  useEffect(() => {
    const stage = stageRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, viewRef.current.scale * Math.exp(-e.deltaY * 0.0015));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openBoard = () => {
    setBoard([]);
    api.get<{ leaderboard: PlaceLeaderboardEntry[] }>('/api/place/leaderboard').then((r) => setBoard(r.leaderboard)).catch(() => {});
  };

  const ringR = 14;
  const ringC = 2 * Math.PI * ringR;

  return (
    <div className="place">
      <div
        className="place-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} width={PLACE_SIZE} height={PLACE_SIZE} />
        <div className="place-hud">
          <button className="icon-btn" style={{ background: 'rgba(10,14,22,.8)', color: '#fff' }} aria-label="Zurück" onClick={() => navigate('/')}>
            <BackIcon />
          </button>
          <span className="pill">r/place · {PLACE_SIZE}×{PLACE_SIZE}</span>
          <span className="pill num">{pixelsSet} Pixel</span>
          {hover ? <span className="pill num">{hover.x}, {hover.y}</span> : null}
          <button className="pill" style={{ border: 0, cursor: 'pointer' }} onClick={openBoard}><StarIcon width={14} height={14} /> Top 10</button>
        </div>
        <div className="cooldown">
          {cooldown > 0 ? (
            <span className="pill num" style={{ height: 40, paddingLeft: 6 }}>
              <svg width="32" height="32" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="16" cy="16" r={ringR} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="3" />
                <circle cx="16" cy="16" r={ringR} fill="none" stroke="var(--gold)" strokeWidth="3" strokeLinecap="round" strokeDasharray={ringC} strokeDashoffset={ringC * (cooldown / PLACE_COOLDOWN_SECONDS)} />
              </svg>
              Nächster Pixel in {cooldown}s
            </span>
          ) : (
            <span className="pill" style={{ background: 'rgba(70,211,154,.85)', color: '#03261a' }}>Bereit – tippe auf ein Feld</span>
          )}
        </div>
      </div>
      <div className="palette" role="radiogroup" aria-label="Farbe">
        {PLACE_PALETTE.map((c) => (
          <button key={c} role="radio" aria-checked={color === c} aria-pressed={color === c} aria-label={c} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>
      {board ? (
        <Sheet title="Top Pixel-Künstler" onClose={() => setBoard(null)}>
          <ul className="rank-list">
            {board.map((u, i) => (
              <li key={u.id}><span className="rank num">{i + 1}</span><span className="n">{u.username}</span><span className="num muted">{u.pixelsSet}</span></li>
            ))}
            {board.length === 0 ? <li className="muted">Noch keine Pixel gesetzt.</li> : null}
          </ul>
        </Sheet>
      ) : null}
    </div>
  );
}
