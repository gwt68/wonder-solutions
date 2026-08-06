import React, { useEffect, useRef, useState } from 'react';
import { api, audioUrl, imageUrl } from '../api.js';
import { trimAudioToWav } from '../audioTrim.js';
import SendModal from '../components/SendModal.jsx';
import { t, tf } from '../i18n.js';

function getTypeLabels() {
  return { sms: t('type_sms'), call: t('type_call'), voice_note: t('type_voice_note'), image: t('type_image') };
}
const TYPE_ICONS = { sms: 'ti-message', call: 'ti-phone', voice_note: 'ti-microphone', image: 'ti-photo' };

export default function Messages() {
  const TYPE_LABELS = getTypeLabels();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [newTextOpen, setNewTextOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sendingMessage, setSendingMessage] = useState(null);
  const [viewingText, setViewingText] = useState(null);
  const [viewingImage, setViewingImage] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);

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
    if (!confirm(t('msg_confirm_delete'))) return;
    try {
      await api.messages.remove(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleBulkDelete() {
    if (!selected.size) return;
    if (!confirm(tf('msg_confirm_bulk_delete', { n: selected.size, s: selected.size !== 1 ? 's' : '' }))) return;
    setBulkDeleting(true);
    setError('');
    try {
      await api.messages.bulkDelete([...selected]);
      clearSelection();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkDeleting(false);
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

  function handleUploadImageClick() {
    imageInputRef.current?.click();
  }

  async function handleImageFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setError('');
    try {
      await api.messages.uploadImage(file, file.name.replace(/\.[^/.]+$/, ''));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingImage(false);
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

  const texts = messages.filter((m) => m.type === 'sms');
  const recordings = messages.filter((m) => m.type === 'voice_note' || m.type === 'call');
  const photos = messages.filter((m) => m.type === 'image');

  function renderRow(m) {
    return (
      <div className="row" key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, padding: '8px 12px' }}>
        <input
          type="checkbox"
          checked={selected.has(m.id)}
          onChange={() => toggleSelected(m.id)}
          style={{ flexShrink: 0 }}
        />
        <div className="row-main" style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <span className="row-title" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
            <i className={`ti ${TYPE_ICONS[m.type] || 'ti-file'}`} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title || t('label_untitled_message')}</span>
          </span>
          <span className="row-sub" style={{ fontSize: 11 }}>
            ID {m.id} · {new Date(m.created_at).toLocaleString()} · <span className="pill" style={{ padding: '1px 7px', fontSize: 10.5 }}>{TYPE_LABELS[m.type] || m.type}</span>
          </span>
        </div>
        {m.text_content && (
          <button
            type="button"
            onClick={() => setViewingText(m)}
            title={t('click_to_view_full_text')}
            style={{
              flexShrink: 0, width: 180, textAlign: 'left', background: 'var(--bg)', border: '1px solid var(--line)',
              borderRadius: 6, padding: '5px 8px', fontSize: 11.5, color: 'var(--ink-soft)', cursor: 'pointer',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {m.text_content}
          </button>
        )}
        {(m.audio_url || m.has_uploaded_audio) && (
          <audio controls src={audioUrl(m.id)} style={{ height: 28, width: 200, flexShrink: 0 }} />
        )}
        {m.has_image && (
          <button
            type="button"
            onClick={() => setViewingImage(m)}
            title={t('click_to_view_full_size')}
            style={{ flexShrink: 0, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
          >
            <img src={imageUrl(m.id)} alt={m.title || t('type_image')} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
          </button>
        )}
        <div className="row-actions">
          <button className="icon-btn" onClick={() => setSendingMessage(m)} aria-label={t('aria_send_message')}><i className="ti ti-send" /></button>
          <button className="icon-btn" onClick={() => setEditing(m)} aria-label={t('aria_edit_message')}><i className="ti ti-edit" /></button>
          <button className="icon-btn danger" onClick={() => handleDelete(m.id)} aria-label={t('aria_delete_message')}><i className="ti ti-trash" /></button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1>{t('msg_title')}</h1>
          <p>{t('msg_subtitle')}</p>
        </div>
      </div>

      <div style={{ flexShrink: 0 }}>
      {error && <div className="banner error">{error}</div>}

      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 8,
          padding: '10px 14px', marginBottom: 16,
        }}>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--accent)' }}>
            {selected.size} {t('contacts_selected')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={clearSelection}>
              {t('msg_clear')}
            </button>
            <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: 13, background: 'var(--danger)' }} onClick={handleBulkDelete} disabled={bulkDeleting}>
              <i className="ti ti-trash" /> {bulkDeleting ? t('contacts_deleting') : `${t('contacts_delete')} ${selected.size}`}
            </button>
          </div>
        </div>
      )}
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
      {loading ? (
        <p style={{ color: 'var(--ink-soft)' }}>{t('send_loading')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
              <h3 style={{ fontSize: 15 }}>{t('msg_texts')} ({texts.length})</h3>
              <button className="btn" onClick={openNewText}><i className="ti ti-plus" /> {t('msg_new_text')}</button>
            </div>
            {texts.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <h3>{t('msg_no_texts_title')}</h3>
                <p>{t('msg_no_texts_body')}</p>
              </div>
            ) : (
              <div className="list" style={{ maxHeight: 210, overflowY: 'auto', padding: 8, border: 'none', borderRadius: 0, gap: 6 }}>
                {texts.map(renderRow)}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
              <h3 style={{ fontSize: 15 }}>{t('msg_recordings')} ({recordings.length})</h3>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  style={{ display: 'none' }}
                  onChange={handleFileSelected}
                />
                <button className="btn" onClick={handleUploadClick} disabled={uploading}>
                  <i className="ti ti-upload" /> {uploading ? t('msg_uploading') : t('msg_upload_audio')}
                </button>
              </div>
            </div>
            {recordings.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <h3>{t('msg_no_recordings_title')}</h3>
                <p>{t('msg_no_recordings_body')}</p>
              </div>
            ) : (
              <div className="list" style={{ maxHeight: 210, overflowY: 'auto', padding: 8, border: 'none', borderRadius: 0, gap: 6 }}>
                {recordings.map(renderRow)}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
              <h3 style={{ fontSize: 15 }}>{t('msg_photos')} ({photos.length})</h3>
              <div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleImageFileSelected}
                />
                <button className="btn" onClick={handleUploadImageClick} disabled={uploadingImage}>
                  <i className="ti ti-upload" /> {uploadingImage ? t('msg_uploading') : t('msg_upload_photo')}
                </button>
              </div>
            </div>
            {photos.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <h3>{t('msg_no_photos_title')}</h3>
                <p>{t('msg_no_photos_body')}</p>
              </div>
            ) : (
              <div className="list" style={{ maxHeight: 210, overflowY: 'auto', padding: 8, border: 'none', borderRadius: 0, gap: 6 }}>
                {photos.map(renderRow)}
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      {newTextOpen && (
        <div className="modal-overlay" onClick={() => setNewTextOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('modal_new_text_title')}</h2>
            <form onSubmit={handleSaveNewText}>
              <div className="field">
                <label>{t('field_title_ref_only')}</label>
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t('field_optional')} />
              </div>
              <div className="field">
                <label>{t('field_message')}</label>
                <textarea
                  required
                  rows={5}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder={t('send_message_placeholder')}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setNewTextOpen(false)}>{t('btn_cancel')}</button>
                <button type="submit" className="btn" disabled={savingText}>{savingText ? t('btn_saving') : t('btn_save_text')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && editing.type === 'sms' && (
        <EditTextModal message={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {editing && editing.type === 'image' && (
        <EditImageModal message={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {editing && editing.type !== 'sms' && editing.type !== 'image' && (
        <EditRecordingModal message={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}

      {sendingMessage && (
        <SendModal message={sendingMessage} onClose={() => setSendingMessage(null)} />
      )}

      {viewingText && (
        <div className="modal-overlay" onClick={() => setViewingText(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{viewingText.title || t('label_untitled_message')}</h2>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 14.5 }}>{viewingText.text_content}</p>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setViewingText(null)}>{t('btn_close')}</button>
            </div>
          </div>
        </div>
      )}

      {viewingImage && (
        <div className="modal-overlay" onClick={() => setViewingImage(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>{viewingImage.title || t('label_untitled_photo')}</h2>
            <img src={imageUrl(viewingImage.id)} alt={viewingImage.title || t('type_image')} style={{ width: '100%', borderRadius: 8 }} />
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setViewingImage(null)}>{t('btn_close')}</button>
            </div>
          </div>
        </div>
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
        <h2>{t('modal_edit_text')}</h2>
        {error && <div className="banner error">{error}</div>}
        <form onSubmit={handleSave}>
          <div className="field">
            <label>{t('field_title_ref_only')}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('field_optional')} />
          </div>
          <div className="field">
            <label>{t('field_message')}</label>
            <textarea required rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>{t('btn_cancel')}</button>
            <button type="submit" className="btn" disabled={saving}>{saving ? t('btn_saving') : t('btn_save_changes')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditImageModal({ message, onClose, onSaved }) {
  const [title, setTitle] = useState(message.title || '');
  const [caption, setCaption] = useState(message.text_content || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.messages.editText(message.id, title, caption);
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
        <h2>{t('modal_edit_photo')}</h2>
        {error && <div className="banner error">{error}</div>}
        <img src={imageUrl(message.id)} alt={title || t('label_untitled_photo')} style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 14 }} />
        <form onSubmit={handleSave}>
          <div className="field">
            <label>{t('field_name')}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('label_untitled_photo')} />
          </div>
          <div className="field">
            <label>{t('field_caption_photo')}</label>
            <textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={t('field_caption_photo_placeholder')} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>{t('btn_cancel')}</button>
            <button type="submit" className="btn" disabled={saving}>{saving ? t('btn_saving') : t('btn_save_changes')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditRecordingModal({ message, onClose, onSaved }) {
  const [title, setTitle] = useState(message.title || '');
  const [caption, setCaption] = useState(message.text_content || '');
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
      if (title !== (message.title || '') || caption !== (message.text_content || '')) {
        await api.messages.editText(message.id, title, caption);
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
        <h2>{t('modal_edit_recording')}</h2>
        {error && <div className="banner error">{error}</div>}

        <div className="field">
          <label>{t('field_name')}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('label_untitled_message')} />
        </div>

        <div className="field">
          <label>{t('field_caption_recording')}</label>
          <textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={t('field_caption_recording_placeholder')} />
        </div>

        <div className="field">
          <label>{t('field_preview')}</label>
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
              <label>{t('field_trim_start')} {start.toFixed(1)}s</label>
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
              <label>{t('field_trim_end')} {end.toFixed(1)}s ({t('field_full_length')} {duration.toFixed(1)}s)</label>
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
              <i className="ti ti-player-play" /> {t('btn_preview_trim')}
            </button>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>{t('btn_cancel')}</button>
          <button type="button" className="btn" onClick={handleSave} disabled={saving}>
            {saving ? t('btn_saving') : t('btn_save_changes')}
          </button>
        </div>
      </div>
    </div>
  );
}