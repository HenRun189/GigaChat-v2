export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (l: Listener) => {
  unauthorizedListeners.add(l);
  return () => unauthorizedListeners.delete(l);
};

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'gigachat', accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'network', 'Keine Verbindung. Bitte prüfe dein Netzwerk.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = json?.error ?? {};
    if (res.status === 401 && !url.startsWith('/api/auth/login')) {
      for (const l of unauthorizedListeners) l();
    }
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? `Fehler ${res.status}`, err.details);
  }
  return json as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
  async blob(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, 'error', `Fehler ${res.status}`);
    return res.arrayBuffer();
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unbekannter Fehler';
}
