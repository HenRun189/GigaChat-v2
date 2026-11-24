import { MESSAGE_MAX, UPLOAD_MAX_BYTES, type Message } from '@gigachat/shared';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PaperclipIcon, SendIcon } from '../../components/icons';
import { api, errorMessage } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sendTyping } from '../../lib/ws';
import { GifPicker } from './GifPicker';

const drafts = new Map<number, string>();

export function Composer({ conversationId, disabled }: { conversationId: number; disabled: boolean }) {
  const [text, setText] = useState(() => drafts.get(conversationId) ?? '');
  const [gif, setGif] = useState(false);
  const [uploading, setUploading] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    drafts.set(conversationId, text);
  }, [conversationId, text]);

  const resize = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, []);
  useEffect(resize, [text, resize]);

  const send = async () => {
    const body = text.trim();
    if (!body || disabled) return;
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const s = useStore.getState();
    s.addPending(conversationId, { clientId, body, createdAt: new Date().toISOString() });
    setText('');
    requestAnimationFrame(() => ta.current?.focus());
    try {
      const r = await api.post<{ message: Message }>(`/api/conversations/${conversationId}/messages`, { kind: 'text', body, clientId });
      const st = useStore.getState();
      st.resolvePending(conversationId, clientId);
      st.addMessage(r.message); // no-op if the websocket was faster
    } catch (e) {
      useStore.getState().resolvePending(conversationId, clientId, true);
      toast(errorMessage(e), 'error');
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
      // Enter sends on keyboards; on touch devices the on-screen "return" also sends,
      // Shift/Ctrl+Enter inserts a line break.
      e.preventDefault();
      void send();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setText((t) => `${t}\n`);
    }
  };

  const upload = async (file: File) => {
    if (file.size > UPLOAD_MAX_BYTES) return toast(`Datei zu groß (max. ${UPLOAD_MAX_BYTES / 1024 / 1024} MB)`, 'error');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      await api.post(`/api/conversations/${conversationId}/upload`, fd);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const sendGif = async (url: string) => {
    setGif(false);
    try {
      await api.post(`/api/conversations/${conversationId}/messages`, { kind: 'gif', gifUrl: url });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <>
      <div className="composer">
        <input
          ref={fileInput}
          type="file"
          hidden
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <button className="icon-btn" aria-label="Datei oder Bild senden" title="Datei oder Bild" disabled={disabled || uploading} onClick={() => fileInput.current?.click()}>
          <PaperclipIcon />
        </button>
        <button className="icon-btn gif-btn" aria-label="GIF senden" title="GIF" disabled={disabled} onClick={() => setGif(true)}>
          GIF
        </button>
        <div className="box">
          <textarea
            ref={ta}
            rows={1}
            value={text}
            placeholder={uploading ? 'Wird hochgeladen…' : 'Nachricht'}
            maxLength={MESSAGE_MAX}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim()) sendTyping(conversationId);
            }}
            onKeyDown={onKey}
            onPaste={(e) => {
              const file = [...e.clipboardData.files][0];
              if (file && file.type.startsWith('image/')) {
                e.preventDefault();
                void upload(file);
              }
            }}
            aria-label="Nachricht schreiben"
            enterKeyHint="send"
            autoCapitalize="sentences"
          />
        </div>
        <button className="icon-btn send" aria-label="Senden" disabled={disabled || !text.trim()} onClick={() => void send()}>
          <SendIcon />
        </button>
      </div>
      {gif ? <GifPicker onPick={sendGif} onClose={() => setGif(false)} /> : null}
    </>
  );
}
