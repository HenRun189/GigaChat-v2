import type { ConversationDetail } from '@gigachat/shared';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useStore } from '../../lib/store';
import { ChatView } from './ChatView';

export function ChatRoute() {
  const { id } = useParams();
  const conversationId = Number(id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) return <Navigate to="/" replace />;
  return <ChatView key={conversationId} conversationId={conversationId} />;
}

/** /u/:userId -> finds (or creates) the dm and redirects to /c/:id */
export function DmResolver() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const toast = useStore((s) => s.toast);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api
      .get<{ conversation: ConversationDetail }>(`/api/conversations/with/${userId}`)
      .then((r) => {
        void useStore.getState().loadContacts().catch(() => {});
        navigate(`/c/${r.conversation.id}`, { replace: true });
      })
      .catch((e) => {
        toast(errorMessage(e), 'error');
        setFailed(true);
      });
  }, [userId, navigate, toast]);
  if (failed) return <Navigate to="/" replace />;
  return (
    <div className="pane chat-pane" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Spinner size={28} />
    </div>
  );
}
