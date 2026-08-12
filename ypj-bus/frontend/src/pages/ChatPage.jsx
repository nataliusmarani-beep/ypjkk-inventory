import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

/**
 * Parent/Driver/Helper/etc ↔ Transport Team chat.
 *
 * Three rooms, not one:
 *  - Pesan Pribadi: everyone's own 1:1 thread with the Transport Team — no
 *    recipient to choose, because with two staff accounts picking one would
 *    only mean messaging whoever is on leave.
 *  - Group Tim Transportasi (Driver/Helper only): internal day-to-day
 *    coordination that doesn't belong in a parent-facing channel.
 *  - Ruang Chat (everyone): a public room where Tim Transportasi posts and
 *    any parent may reply, and — unlike the 1:1 thread — every reply is
 *    visible to the whole room. For the "does anyone else have this same
 *    question" kind of thing a private thread hides from everyone else.
 * Polled rather than websockets: a school bus conversation is not a live
 * chat room, and polling survives the patchy signal this app is built around.
 *
 * Formal complaints stay on their own screen: those are tracked to resolution
 * and emailed to the whole team, this is for quick questions.
 */
export default function ChatPage({ user }) {
  const navigate = useNavigate();
  // Contractor/Leader/Admin Sekolah see the group room too (view-only — see
  // canPostGroup in backend/routes/chat.js), same access as Driver/Helper
  // just without the ability to post into it.
  const showGroupTab = ['driver', 'helper', 'contractor', 'leader', 'admin'].includes(user?.role);
  const [tab, setTab] = useState('personal');

  return (
    <div className="page">
      <h1>Chat Tim Transportasi</h1>
      <p className="muted">
        Pertanyaan singkat seputar layanan bis. Untuk keluhan resmi yang perlu
        ditindaklanjuti, gunakan menu{' '}
        <button className="link" style={{ padding: 0 }} onClick={() => navigate('/keluhan')}>
          Laporkan Keluhan
        </button>.
      </p>

      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'room' ? 'on' : ''} onClick={() => setTab('room')}>
          Ruang Chat
        </button>
        <button className={tab === 'personal' ? 'on' : ''} onClick={() => setTab('personal')}>
          Pesan Pribadi
        </button>
        {showGroupTab && (
          <button className={tab === 'group' ? 'on' : ''} onClick={() => setTab('group')}>
            Group Tim Transportasi
          </button>
        )}
      </div>

      {tab === 'personal' && <PersonalThread />}
      {tab === 'group' && <GroupThread user={user} />}
      {tab === 'room' && <RoomThread user={user} />}

      <button className="ghost block" style={{ marginTop: 12 }}
              onClick={() => navigate('/')}>Kembali ke Beranda</button>
    </div>
  );
}

function PersonalThread() {
  const [messages, setMessages] = useState(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  const load = useCallback(async ({ scroll = false } = {}) => {
    try {
      const d = await api.chat();
      setMessages(d.messages);
      if (scroll) {
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load({ scroll: true });
    const timer = setInterval(() => load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function send(e) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      await api.sendChat(text);
      setBody('');
      await load({ scroll: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <div className="card chat-box">
        {messages === null && <p className="muted">Memuat…</p>}

        {messages?.length === 0 && (
          <div className="center muted" style={{ padding: '28px 8px' }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>💬</div>
            Belum ada percakapan.<br />Kirim pesan pertama Anda di bawah.
          </div>
        )}

        {messages?.map((m) => (
          <div key={m.id} className={`bubble-row ${m.sender_side}`}>
            <div className={`bubble ${m.sender_side}`}>
              {m.sender_side === 'staff' && (
                <div className="who">{m.sender_name} · Tim Transportasi</div>
              )}
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
              <div className="when">{formatTime(m.created_at)}</div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="chat-compose" onSubmit={send}>
        <textarea rows={2} value={body} maxLength={2000}
                  placeholder="Tulis pesan…"
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); }
                  }} />
        <button type="submit" disabled={sending || !body.trim()}>
          {sending ? '…' : 'Kirim'}
        </button>
      </form>
    </>
  );
}

/** The internal room — bubbles are keyed by "is this me", not by a fixed side,
 * since every member here can both send and receive. */
function GroupThread({ user }) {
  const [messages, setMessages] = useState(null);
  const [canPost, setCanPost] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  const load = useCallback(async ({ scroll = false } = {}) => {
    try {
      const d = await api.groupChat();
      setMessages(d.messages);
      setCanPost(d.can_post !== false);
      if (scroll) {
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load({ scroll: true });
    const timer = setInterval(() => load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function send(e) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      await api.sendGroupChat(text);
      setBody('');
      await load({ scroll: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 13 }}>
        Terlihat oleh seluruh Tim Transportasi, Driver, dan Helper.
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <div className="card chat-box">
        {messages === null && <p className="muted">Memuat…</p>}

        {messages?.length === 0 && (
          <div className="center muted" style={{ padding: '28px 8px' }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>👥</div>
            Belum ada pesan di group ini.
          </div>
        )}

        {messages?.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <div key={m.id} className={`bubble-row ${mine ? 'staff' : 'parent'}`}>
              <div className={`bubble ${mine ? 'staff' : 'parent'}`}>
                {!mine && <div className="who">{m.sender_name}</div>}
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                <div className="when">{formatTime(m.created_at)}</div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {canPost ? (
        <form className="chat-compose" onSubmit={send}>
          <textarea rows={2} value={body} maxLength={2000}
                    placeholder="Tulis pesan ke group…"
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); }
                    }} />
          <button type="submit" disabled={sending || !body.trim()}>
            {sending ? '…' : 'Kirim'}
          </button>
        </form>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>Peran Anda hanya dapat membaca group ini.</p>
      )}
    </>
  );
}

const ROOM_ROLE_LABEL = {
  parent: 'Orang Tua', transport_admin: 'Tim Transportasi', super_admin: 'Tim Transportasi',
  leader: 'Leader', admin: 'Admin Sekolah',
};

/** The public room — Tim Transportasi posts, any parent may reply, and every
 * reply is visible to the whole room (not just staff, unlike Pesan Pribadi).
 * Every other role can read but not post — same shape as GroupThread's
 * read-only members, just a different roster. */
function RoomThread({ user }) {
  const [messages, setMessages] = useState(null);
  const [canPost, setCanPost] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  const load = useCallback(async ({ scroll = false } = {}) => {
    try {
      const d = await api.roomChat();
      setMessages(d.messages);
      setCanPost(d.can_post !== false);
      if (scroll) {
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load({ scroll: true });
    const timer = setInterval(() => load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function send(e) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      await api.sendRoomChat(text);
      setBody('');
      await load({ scroll: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 13 }}>
        Terlihat oleh semua pengguna aplikasi. Tim Transportasi mengirim, orang tua dapat membalas.
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      <div className="card chat-box">
        {messages === null && <p className="muted">Memuat…</p>}

        {messages?.length === 0 && (
          <div className="center muted" style={{ padding: '28px 8px' }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>📣</div>
            Belum ada pesan di ruang chat ini.
          </div>
        )}

        {messages?.map((m) => {
          const mine = m.sender_id === user?.id;
          const roleLabel = ROOM_ROLE_LABEL[m.sender_role] || '';
          return (
            <div key={m.id} className={`bubble-row ${mine ? 'staff' : 'parent'}`}>
              <div className={`bubble ${mine ? 'staff' : 'parent'}`}>
                {!mine && (
                  <div className="who">{m.sender_name}{roleLabel ? ` · ${roleLabel}` : ''}</div>
                )}
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                <div className="when">{formatTime(m.created_at)}</div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {canPost ? (
        <form className="chat-compose" onSubmit={send}>
          <textarea rows={2} value={body} maxLength={2000}
                    placeholder="Tulis pesan ke ruang chat…"
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); }
                    }} />
          <button type="submit" disabled={sending || !body.trim()}>
            {sending ? '…' : 'Kirim'}
          </button>
        </form>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>
          Peran Anda hanya dapat membaca ruang chat ini.
        </p>
      )}
    </>
  );
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value.replace(' ', 'T') + 'Z');
  return d.toLocaleString('id-ID', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
