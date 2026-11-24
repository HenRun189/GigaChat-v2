import { useEffect, useRef, useState } from 'react';
import { SearchIcon } from '../../components/icons';
import { Sheet, Spinner } from '../../components/ui';
import { useStore } from '../../lib/store';

interface Gif {
  id: string;
  title: string;
  preview: string;
  full: string;
}

export function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const key = useStore((s) => s.config?.giphyApiKey ?? '');
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!key) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const url = q.trim()
          ? `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(q.trim())}&limit=24&rating=pg-13&lang=de`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=24&rating=pg-13`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Giphy nicht erreichbar');
        const data = (await res.json()) as { data: Array<{ id: string; title: string; images: Record<string, { url: string }> }> };
        setGifs(
          data.data.map((g) => ({
            id: g.id,
            title: g.title,
            preview: g.images.fixed_width_small?.url ?? g.images.fixed_width?.url,
            full: g.images.fixed_height?.url ?? g.images.original.url,
          })),
        );
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, q ? 300 : 0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, key]);

  return (
    <Sheet title="GIF senden" onClose={onClose}>
      {!key ? (
        <p className="muted">Die GIF-Suche ist auf diesem Server nicht eingerichtet (GIPHY_API_KEY fehlt).</p>
      ) : (
        <>
          <label className="search" style={{ marginBottom: 12 }}>
            <SearchIcon />
            <input type="search" placeholder="GIFs suchen" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          {loading && gifs.length === 0 ? <div className="loading-more"><Spinner /></div> : null}
          <div className="gif-grid">
            {gifs.map((g) => (
              <button key={g.id} onClick={() => onPick(g.full)} aria-label={g.title || 'GIF'}>
                <img src={g.preview} alt={g.title} loading="lazy" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
          <p className="faint small" style={{ marginTop: 10, textAlign: 'center' }}>Powered by GIPHY</p>
        </>
      )}
    </Sheet>
  );
}
