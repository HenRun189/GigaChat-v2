import { ROLE_LABELS, type StatsOverview } from '@gigachat/shared';
import { useEffect, useState } from 'react';
import { PageFrame } from '../../app/Shell';
import { Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fmtLastSeen, fmtNumber } from '../../lib/format';

function BarChart({ data }: { data: Array<{ day: string; count: number }> }) {
  const w = 620;
  const h = 150;
  const pad = 18;
  const max = Math.max(1, ...data.map((d) => d.count));
  const bw = (w - pad * 2) / data.length;
  return (
    <div className="chart" role="img" aria-label="Nachrichten pro Tag, letzte 31 Tage">
      <svg viewBox={`0 0 ${w} ${h + 24}`} preserveAspectRatio="none">
        {data.map((d, i) => {
          const bh = (d.count / max) * h;
          return (
            <g key={d.day}>
              <rect x={pad + i * bw + 1} y={h - bh} width={Math.max(2, bw - 2)} height={bh} rx="2">
                <title>{`${d.day}: ${d.count} Nachrichten`}</title>
              </rect>
              {i % 5 === 0 ? (
                <text x={pad + i * bw + bw / 2} y={h + 16} textAnchor="middle">{d.day.slice(8, 10)}.{d.day.slice(5, 7)}.</text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function StatsPage() {
  const [data, setData] = useState<StatsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.get<StatsOverview>('/api/stats').then(setData).catch((e) => setError(errorMessage(e)));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <PageFrame title="Statistik" wide>
      {error ? <div className="form-error">{error}</div> : null}
      {!data ? (
        <div className="loading-more"><Spinner /></div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="v num" style={{ color: 'var(--ok)' }}>{data.onlineNow}</div><div className="l">gerade online</div></div>
            <div className="kpi gold"><div className="v num">{fmtNumber(data.messagesToday)}</div><div className="l">Nachrichten heute</div></div>
            <div className="kpi"><div className="v num">{fmtNumber(data.messagesTotal)}</div><div className="l">Nachrichten gesamt</div></div>
            <div className="kpi"><div className="v num">{fmtNumber(data.accountsTotal)}</div><div className="l">Konten</div></div>
            <div className="kpi"><div className="v num">{fmtNumber(data.viewsToday)}</div><div className="l">Aufrufe heute</div></div>
            <div className="kpi"><div className="v num">{fmtNumber(data.uniqueToday)}</div><div className="l">Besucher heute</div></div>
            <div className="kpi"><div className="v num">{fmtNumber(data.viewsTotal)}</div><div className="l">Aufrufe gesamt</div></div>
            <div className="kpi"><div className="v num">{fmtNumber(data.uniqueTotal)}</div><div className="l">Besucher gesamt</div></div>
          </div>

          <section>
            <h2>Nachrichten pro Tag</h2>
            <p className="muted small" style={{ marginBottom: 8 }}>Letzte 31 Tage, privat und Gruppen zusammen.</p>
            <BarChart data={data.messagesPerDay} />
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            <section>
              <h2>Gerade online</h2>
              {data.onlineUsers.length === 0 ? <p className="muted">Niemand außer dir.</p> : null}
              <ul className="rank-list group-list">
                {data.onlineUsers.map((u) => (
                  <li key={u.id}><span className="pill-online" /><span className="n">{u.username}</span><span className="faint small">{fmtLastSeen(u.lastSeen, true)}</span></li>
                ))}
              </ul>
            </section>
            <section>
              <h2>Top 10 Schreiber</h2>
              <ul className="rank-list group-list">
                {data.topSenders.map((u, i) => (
                  <li key={u.id}><span className="rank num">{i + 1}</span><span className="n">{u.username}</span><span className="num muted">{fmtNumber(u.count)}</span></li>
                ))}
                {data.topSenders.length === 0 ? <li className="muted">Noch keine Nachrichten.</li> : null}
              </ul>
            </section>
          </div>

          <section>
            <h2>Letzte 14 Tage</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Tag</th><th className="num">Aufrufe</th><th className="num">Besucher</th><th className="num">Nachrichten</th></tr></thead>
                <tbody>
                  {data.dailyTable.map((d) => (
                    <tr key={d.day}><td className="num">{d.day}</td><td className="num">{d.views}</td><td className="num">{d.unique}</td><td className="num">{d.messages}</td></tr>
                  ))}
                  {data.dailyTable.length === 0 ? <tr><td colSpan={4} className="muted">Noch keine Daten.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          {data.extended ? (
            <section>
              <h2>Zuletzt online (Admin)</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Name</th><th>Rolle</th><th>Zuletzt</th></tr></thead>
                  <tbody>
                    {data.extended.lastOnline.map((u) => (
                      <tr key={u.id}><td>{u.username}</td><td className="muted">{ROLE_LABELS[u.role]}</td><td className="muted">{fmtLastSeen(u.lastSeen, false)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </PageFrame>
  );
}
