import { NOTES_MAX } from '@gigachat/shared';
import { useEffect, useRef, useState } from 'react';
import { PageFrame } from '../../app/Shell';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';

export function NotesPage() {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<'loading' | 'saved' | 'dirty' | 'saving' | 'error'>('loading');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef('');

  useEffect(() => {
    api
      .get<{ content: string; updatedAt: string | null }>('/api/notes')
      .then((r) => {
        setContent(r.content);
        latest.current = r.content;
        setUpdatedAt(r.updatedAt);
        setStatus('saved');
      })
      .catch((e) => {
        setError(errorMessage(e));
        setStatus('error');
      });
  }, []);

  const save = async (value: string) => {
    setStatus('saving');
    try {
      const r = await api.put<{ updatedAt: string }>('/api/notes', { content: value });
      latest.current = value;
      setUpdatedAt(r.updatedAt);
      setStatus(value === latestTyped.current ? 'saved' : 'dirty');
    } catch (e) {
      setError(errorMessage(e));
      setStatus('error');
    }
  };
  const latestTyped = useRef('');

  const onChange = (v: string) => {
    setContent(v);
    latestTyped.current = v;
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(v), 800);
  };

  useEffect(() => {
    const flush = () => {
      if (latestTyped.current && latestTyped.current !== latest.current) {
        navigator.sendBeacon?.('/api/notes', new Blob([JSON.stringify({ content: latestTyped.current })], { type: 'application/json' }));
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const label =
    status === 'loading' ? 'Lädt…' : status === 'saving' ? 'Speichert…' : status === 'dirty' ? 'Ungespeichert' : status === 'error' ? 'Fehler' : updatedAt ? `Gespeichert · ${fmtDateTime(updatedAt)}` : 'Gespeichert';

  return (
    <PageFrame title="Notizen" actions={<span className={`tag ${status === 'saved' ? 'ok' : status === 'error' ? 'danger' : ''}`}>{label}</span>}>
      <p className="lead">Privat, nur für dich. Praktisch, um Text zwischen Geräten zu übertragen. Wird automatisch gespeichert.</p>
      {error ? <div className="form-error" style={{ marginBottom: 12 }}>{error} <button className="btn btn-sm" onClick={() => save(content)}>Erneut speichern</button></div> : null}
      <textarea
        className="input"
        style={{ minHeight: '55dvh', fontSize: '1rem' }}
        value={content}
        maxLength={NOTES_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Schreib etwas auf…"
        disabled={status === 'loading'}
        aria-label="Notizen"
      />
      <p className="hint num" style={{ textAlign: 'right', marginTop: 6 }}>{content.length.toLocaleString('de-DE')} / {NOTES_MAX.toLocaleString('de-DE')}</p>
    </PageFrame>
  );
}
