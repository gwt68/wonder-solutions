import React, { useEffect, useRef, useState } from 'react';
import { api, audioUrl, imageUrl } from '../api.js';
import SendForm from '../components/SendForm.jsx';
import { t } from '../i18n.js';

function getChannels() {
  return [
    { key: 'sms', label: t('channel_sms_label'), icon: 'ti-message', desc: t('channel_sms_desc') },
    { key: 'call', label: t('channel_call_label'), icon: 'ti-phone', desc: t('channel_call_desc') },
    { key: 'voice_note', label: t('channel_voice_note_label'), icon: 'ti-microphone', desc: t('channel_voice_note_desc') },
  ];
}

export default function Send() {
  const CHANNELS = getChannels();
  const [step, setStep] = useState('channel'); // 'channel' | 'compose' | 'recipients'
  const [channel, setChannel] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');

  function chooseChannel(c) {
    setChannel(c);
    setStep('compose');
    setError('');
  }

  function backToChannels() {
    setStep('channel');
    setChannel(null);
    setMessage(null);
  }

  async function handleComposed(newMessage) {
    setMessage(newMessage);
    setStep('recipients');
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('send_title')}</h1>
          <p>{t('send_subtitle')}</p>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {step === 'channel' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, maxWidth: 720 }}>
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              type="button"
              className="card"
              onClick={() => chooseChannel(c.key)}
              style={{ textAlign: 'left', padding: 20, cursor: 'pointer', border: '1px solid var(--line)' }}
            >
              <div style={{
                width: 38, height: 38, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, marginBottom: 12,
              }}>
                <i className={`ti ${c.icon}`} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{c.desc}</div>
            </button>
          ))}
        </div>
      )}

      {step === 'compose' && (
        <ComposeForm
          channel={channel}
          onBack={backToChannels}
          onComposed={handleComposed}
          setError={setError}
        />
      )}

      {step === 'recipients' && message && (
        <div className="card" style={{ padding: 22, maxWidth: 660 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 2px' }}>{t('send_sending_label')}</p>
              <p style={{ fontWeight: 600, fontSize: 15.5 }}>{message.title || t('label_untitled_message')}</p>
            </div>
            <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={backToChannels}>
              {t('send_start_over')}
            </button>
          </div>

          {message.text_content && (
            <p style={{ fontSize: 14, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', marginBottom: 14, whiteSpace: 'pre-wrap' }}>
              {message.text_content}
            </p>
          )}
          {(message.audio_url || message.has_uploaded_audio) && (
            <audio controls src={audioUrl(message.id)} style={{ width: '100%', marginBottom: 14 }} />
          )}
          {message.has_image && (
            <img src={imageUrl(message.id)} alt={message.title || t('type_image')} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, marginBottom: 14, display: 'block' }} />
          )}

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <SendForm key={message.id} message={message} channel={channel} />
          </div>
        </div>
      )}
    </div>
  );
}

// Lets the user upload a new audio file, record one live via microphone, or
// reuse an existing saved recording — for the Call and Voice note channels.
function AudioSourcePicker({ onFileChosen, onExistingChosen, existingId }) {
  const [mode, setMode] = useState('upload'); // 'upload' | 'library' | 'record'
  const [library, setLibrary] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState(null);
  const [micError, setMicError] = useState('');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  useEffect(() => {
    if (mode === 'library' && library.length === 0 && !libraryLoading) {
      setLibraryLoading(true);
      api.messages.list()
        .then((all) => setLibrary(all.filter((m) => m.type === 'voice_note' && (m.has_uploaded_audio || m.audio_url))))
        .catch(() => {})
        .finally(() => setLibraryLoading(false));
    }
  }, [mode]);

  async function startRecording() {
    setMicError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecordedUrl(URL.createObjectURL(blob));
        const stamp = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        onFileChosen(new File([blob], `Recording ${stamp}.webm`, { type: 'audio/webm' }));
        streamRef.current?.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      setRecording(true);
    } catch (err) {
      setMicError(t('send_mic_error'));
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  function reRecord() {
    setRecordedUrl(null);
    onFileChosen(null);
  }

  return (
    <div className="field">
      <label>{t('send_audio')}</label>
      <div className="chip-select" style={{ marginBottom: 10 }}>
        <button type="button" className={`chip-toggle ${mode === 'upload' ? 'active' : ''}`} onClick={() => setMode('upload')}>{t('send_upload_file')}</button>
        <button type="button" className={`chip-toggle ${mode === 'library' ? 'active' : ''}`} onClick={() => setMode('library')}>{t('send_saved_recordings')}</button>
        <button type="button" className={`chip-toggle ${mode === 'record' ? 'active' : ''}`} onClick={() => setMode('record')}>{t('send_record_now')}</button>
      </div>

      {mode === 'upload' && (
                <div>
          <input
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
            onChange={(e) => onFileChosen(e.target.files?.[0] || null)}
          />
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
            MP3 or WAV only — other formats won't play on phone calls.
          </div>
        </div>
      )}

      {mode === 'library' && (
        libraryLoading ? (
          <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{t('send_loading')}</p>
        ) : library.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{t('send_no_saved_recordings')}</p>
        ) : (
          <select
            value={existingId || ''}
            onChange={(e) => {
              const found = library.find((m) => String(m.id) === e.target.value);
              onExistingChosen(found || null);
            }}
          >
            <option value="">{t('send_choose_saved_recording')}</option>
            {library.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title || t('label_untitled')} — {new Date(m.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })} (ID {m.id})
              </option>
            ))}
          </select>
        )
      )}

      {mode === 'record' && (
        <div>
          {micError && <div className="banner error" style={{ marginBottom: 8 }}>{micError}</div>}
          {!recording && !recordedUrl && (
            <button type="button" className="btn secondary" onClick={startRecording}>
              <i className="ti ti-microphone" /> {t('send_start_recording')}
            </button>
          )}
          {recording && (
            <button type="button" className="btn" style={{ background: 'var(--danger)' }} onClick={stopRecording}>
              <i className="ti ti-player-stop" /> {t('send_stop_recording')}
            </button>
          )}
          {recordedUrl && !recording && (
            <div>
              <audio controls src={recordedUrl} style={{ width: '100%', marginBottom: 8 }} />
              <button type="button" className="btn secondary" onClick={reRecord}>{t('send_rerecord')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ComposeForm({ channel, onBack, onComposed, setError }) {
  const CHANNELS = getChannels();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [existingAudio, setExistingAudio] = useState(null); // full message object, if reusing a saved recording
  const [imageFile, setImageFile] = useState(null);
  const [mediaKind, setMediaKind] = useState('audio'); // for voice_note: 'audio' | 'image'
  const [saving, setSaving] = useState(false);

  function handleAudioFileChosen(file) {
    setAudioFile(file);
    setExistingAudio(null);
  }

  function handleExistingAudioChosen(msg) {
    setExistingAudio(msg);
    setAudioFile(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (channel === 'sms' && !body.trim()) {
      setError(t('send_error_sms_empty'));
      return;
    }
    if (channel === 'call' && !body.trim() && !audioFile && !existingAudio) {
      setError(t('send_error_call_empty'));
      return;
    }
    if (channel === 'voice_note') {
      if (mediaKind === 'audio' && !audioFile && !existingAudio) { setError(t('send_error_voice_note_audio')); return; }
      if (mediaKind === 'image' && !imageFile) { setError(t('send_error_voice_note_image')); return; }
    }

    setSaving(true);
    try {
      let created;
      if (channel === 'sms') {
        created = await api.messages.create({ type: 'sms', title: title || null, text_content: body });
      } else if (channel === 'call') {
        if (existingAudio) {
          created = body.trim()
            ? await api.messages.cloneWithCaption(existingAudio.id, body, title || existingAudio.title)
            : existingAudio;
        } else if (audioFile) {
          created = await api.messages.uploadAudio(audioFile, title || audioFile.name);
          if (body.trim()) created = await api.messages.editText(created.id, created.title, body);
        } else {
          created = await api.messages.create({ type: 'sms', title: title || null, text_content: body });
        }
      } else if (channel === 'voice_note') {
        if (mediaKind === 'audio') {
          if (existingAudio) {
            created = body.trim()
              ? await api.messages.cloneWithCaption(existingAudio.id, body, title || existingAudio.title)
              : existingAudio;
          } else {
            created = await api.messages.uploadAudio(audioFile, title || audioFile.name);
          }
        } else {
          created = await api.messages.uploadImage(imageFile, title || imageFile.name);
        }
        if (body.trim() && !existingAudio) created = await api.messages.editText(created.id, created.title, body);
      }
      onComposed(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const channelInfo = CHANNELS.find((c) => c.key === channel);

  return (
    <div className="card" style={{ padding: 22, maxWidth: 520 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15 }}>{channelInfo.label}</h3>
        <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={onBack}>{t('send_back')}</button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>{t('field_title_ref_only')}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('field_optional')} />
        </div>

        {channel === 'sms' && (
          <div className="field">
            <label>{t('field_message')}</label>
            <textarea required rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('send_message_placeholder')} />
          </div>
        )}

        {channel === 'call' && (
          <>
            <div className="field">
              <label>{t('send_message_read_aloud')}</label>
              <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('send_message_read_aloud_placeholder')} />
            </div>
            <AudioSourcePicker
              onFileChosen={handleAudioFileChosen}
              onExistingChosen={handleExistingAudioChosen}
              existingId={existingAudio?.id}
            />
          </>
        )}

        {channel === 'voice_note' && (
          <>
            <div className="field">
              <label>{t('send_what_sending')}</label>
              <div className="chip-select">
                <button type="button" className={`chip-toggle ${mediaKind === 'audio' ? 'active' : ''}`} onClick={() => setMediaKind('audio')}>{t('send_audio')}</button>
                <button type="button" className={`chip-toggle ${mediaKind === 'image' ? 'active' : ''}`} onClick={() => setMediaKind('image')}>{t('send_photo')}</button>
              </div>
            </div>
            {mediaKind === 'audio' ? (
              <AudioSourcePicker
                onFileChosen={handleAudioFileChosen}
                onExistingChosen={handleExistingAudioChosen}
                existingId={existingAudio?.id}
              />
            ) : (
              <div className="field">
                <label>{t('send_photo')}</label>
                <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
              </div>
            )}
            <div className="field">
              <label>{t('field_caption')}</label>
              <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a message to go with it" />
            </div>
          </>
        )}

        <button type="submit" className="btn" disabled={saving} style={{ width: '100%' }}>
          {saving ? t('btn_saving') : t('send_continue')}
        </button>
      </form>
    </div>
  );
}