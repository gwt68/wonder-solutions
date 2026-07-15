import React, { useEffect, useRef, useState } from 'react';
import { api, audioUrl } from '../api.js';
import { trimAudioToWav } from '../audioTrim.js';
import SendModal from '../components/SendModal.jsx';

const TYPE_LABELS = { sms: 'Text', call: 'Phone call', voice_note: 'Voice note' };
const TYPE_ICONS = { sms: 'ti-message', call: 'ti-phone', voice_note: 'ti-microphone' };

export default function Messages() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [newTextOpen, setNewTextOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sendingMessage, setSendingMessage] = useState(null);
  const fileInputRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      setMessages(await api.messages.list());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id) {
    if (!confirm('Delete this message?')) return;
    try {
      await api.messages.remove(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      await api.messages.uploadAudio(file, file.name.replace(/\.[^/.]+$/, ''));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function openNewText() {
    setNewTitle('');
    setNewBody('');
    setNewTextOpen(true);
  }

  async function handleSaveNewText(e) {
    e.preventDefault();
    setSavingText(true);
    setError('');
    try {
      await api.messages.create({ type: 'sms', title: newTitle || null, text_content: newBody });
      setNewTextOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingText(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Messages</h1>
          <p>Texts and recordings, ready to send</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />
          <button className="btn secondary" onClick={handleUploadClick} disabled={uploading}>
            <i className="ti ti-upload" /> {uploading ? 'Uploading...' : 'Upload audio'}
          </button>
          <button className="btn" onClick={openNewText}><i className="ti ti-plus" /> New text</button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {loading ? (
        <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
      ) : messages.length === 0 ? (
        <div className="card empty-state">
          <h3>No messages yet</h3>
          <p>Write a text, upload audio, or call your Wonder Solutions line and press 1 to record one.</p>
        </div>
      ) : (
        <div className="list">
          {messages.map((m) => (
            <div className="row" key={m.id}>
              <div className="row-main">
                <span className="row-title">
                  <i className={`ti ${TYPE_ICONS[m.type] || 'ti-file'}`} style={{ marginRight: 6, color: 'var(--ink-faint)' }} />
                  {m.title || 'Untitled message'}
                </span>
                <span className="row-sub">
                  {new Date(m.created_at).toLocaleString()} · <span className="pill">{TYPE_LABELS[m.type] || m.type}</span>
                </span>
                {m.text_content && <p style={{ margin: '6px 0 0', fontSize: 14 }}>{m.text_content}</p>}
                {(m.audio_url || m.has_uploaded_audio) && (
                  <audio controls src={audioUrl(m.id)} style={{ marginTop: 6 }} />
                )}
              </div>
              <div className="row-actions">
                <button className="icon-btn" onClick={() => setSendingMessage(m)} aria-label="Send message"><i className="ti ti-send" /></button>
                <button className="icon-btn" onClick={() => setEditing(m)} aria-label="Edit message"><i className="ti ti-edit" /></button>
                <button className="icon-btn danger" onClick={() => handleDelete(m.id)} aria-label="Delete message"><i className="ti ti-trash" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {newTextOpen && (
        <div className="modal-overlay" onClick={() => setNewTextOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New text</h2>
            <form onSubmit={handleSaveNewText}>
              <div className="field">
                <label>Title (for your reference only)</label>
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Optional" />
              </div>
              <div className="field">
                <label>Message</label>
                <textarea
                  required
                  rows={5}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="What should this text say?"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setNewTextOpen(false)}>Cancel</button>
                <button type="submit" className="btn" disabled={savingText}>{savingText ? 'Saving...' : 'Save text'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && editing.type === 'sms' && (
        <EditTextModal message={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {editing && editing.type !== 'sms' && (
        <EditRecordingModal message={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}

      {sendingMessage && (
        <SendModal message={sendingMessage} onClose={() => setSendingMessage(null)} />
      )}
    </div>
  );
}

function EditTextModal({ message, onClose, onSaved }) {
  const [title, setTitle] = useState(message.title || '');
  const [body, setBody] = useState(message.text_content || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.messages.editText(message.id, title, body);
      onSaved();
    } catch (err) {
      setError(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit text</h2>
        {error && <div className="banner error">{error}</div>}
        <form onSubmit={handleSave}>
          <div className="field">
            <label>Title (for your reference only)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
          </div>
          <div className="field">
            <label>Message</label>
            <textarea required rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditRecordingModal({ message, onClose, onSaved }) {
  const [title, setTitle] = useState(message.title || '');
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef(null);
  const src = audioUrl(message.id);

  function handleLoadedMetadata() {
    const d = audioRef.current.duration;
    setDuration(d);
    setEnd(d);
  }

  function handlePreviewTrim() {
    if (!audioRef.current) return;
    audioRef.current.currentTime = start;
    audioRef.current.play();
    const stopAt = () => {
      if (audioRef.current.currentTime >= end) {
        audioRef.current.pause();
        audioRef.current.removeEventListener('timeupdate', stopAt);
      }
    };
    audioRef.current.addEventListener('timeupdate', stopAt);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      if (title !== (message.title || '')) {
        await api.messages.rename(message.id, title);
      }
      const isTrimmed = duration > 0 && (start > 0.05 || end < duration - 0.05);
      if (isTrimmed) {
        const wavBlob = await trimAudioToWav(src, start, end);
        await api.messages.replaceAudio(message.id, wavBlob);
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit recording</h2>
        {error && <div className="banner error">{error}</div>}

        <div className="field">
          <label>Name</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled message" />
        </div>

        <div className="field">
          <label>Preview</label>
          <audio
            ref={audioRef}
            controls
            src={src}
            style={{ width: '100%' }}
            onLoadedMetadata={handleLoadedMetadata}
          />
        </div>

        {duration > 0 && (
          <>
            <div className="field">
              <label>Trim start: {start.toFixed(1)}s</label>
              <input
                type="range"
                min="0"
                max={duration}
                step="0.1"
                value={start}
                onChange={(e) => setStart(Math.min(parseFloat(e.target.value), end - 0.1))}
                style={{ width: '100%' }}
              />
            </div>
            <div className="field">
              <label>Trim end: {end.toFixed(1)}s (full length: {duration.toFixed(1)}s)</label>
              <input
                type="range"
                min="0"
                max={duration}
                step="0.1"
                value={end}
                onChange={(e) => setEnd(Math.max(parseFloat(e.target.value), start + 0.1))}
                style={{ width: '100%' }}
              />
            </div>
            <button type="button" className="btn secondary" onClick={handlePreviewTrim} style={{ marginBottom: 8 }}>
              <i className="ti ti-player-play" /> Preview trimmed section
            </button>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
