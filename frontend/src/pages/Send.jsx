import React, { useEffect, useRef, useState } from 'react';
import { api, audioUrl, imageUrl } from '../api.js';
import SendForm from '../components/SendForm.jsx';

const CHANNELS = [
  { key: 'sms', label: 'Text message', icon: 'ti-message', desc: 'A plain text message' },
  { key: 'call', label: 'Phone call', icon: 'ti-phone', desc: 'Something read aloud, or an audio recording played on a call' },
  { key: 'voice_note', label: 'Voice note (MMS)', icon: 'ti-microphone', desc: 'An audio clip or photo sent as a picture/voice message' },
];

export default function Send() {
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
          <h1>Send</h1>
          <p>Choose what you want to send, write it, then pick who gets it</p>
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
              <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 2px' }}>Sending</p>
              <p style={{ fontWeight: 600, fontSize: 15.5 }}>{message.title || 'Untitled message'}</p>
            </div>
            <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={backToChannels}>
              Start over
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
            <img src={imageUrl(message.id)} alt={message.title || 'Photo'} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, marginBottom: 14, display: 'block' }} />
          )}

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <SendForm key={message.id} message={message} />
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
      setMicError('Could not access your microphone. Check your browser permissions.');
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
      <label>Audio</label>
      <div className="chip-select" style={{ marginBottom: 10 }}>
        <button type="button" className={`chip-toggle ${mode === 'upload' ? 'active' : ''}`} onClick={() => setMode('upload')}>Upload file</button>
        <button type="button" className={`chip-toggle ${mode === 'library' ? 'active' : ''}`} onClick={() => setMode('library')}>Saved recordings</button>
        <button type="button" className={`chip-toggle ${mode === 'record' ? 'active' : ''}`} onClick={() => setMode('record')}>Record now</button>
      </div>

      {mode === 'upload' && (
        <input type="file" accept="audio/*" onChange={(e) => onFileChosen(e.target.files?.[0] || null)} />
      )}

      {mode === 'library' && (
        libraryLoading ? (
          <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Loading...</p>
        ) : library.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>No saved recordings yet — upload or record one instead.</p>
        ) : (
          <select
            value={existingId || ''}
            onChange={(e) => {
              const found = library.find((m) => String(m.id) === e.target.value);
              onExistingChosen(found || null);
            }}
          >
            <option value="">Choose a saved recording...</option>
            {library.map((m) => <option key={m.id} value={m.id}>{m.title || 'Untitled'}</option>)}
          </select>
        )
      )}

      {mode === 'record' && (
        <div>
          {micError && <div className="banner error" style={{ marginBottom: 8 }}>{micError}</div>}
          {!recording && !recordedUrl && (
            <button type="button" className="btn secondary" onClick={startRecording}>
              <i className="ti ti-microphone" /> Start recording
            </button>
          )}
          {recording && (
            <button type="button" className="btn" style={{ background: 'var(--danger)' }} onClick={stopRecording}>
              <i className="ti ti-player-stop" /> Stop recording
            </button>
          )}
          {recordedUrl && !recording && (
            <div>
              <audio controls src={recordedUrl} style={{ width: '100%', marginBottom: 8 }} />
              <button type="button" className="btn secondary" onClick={reRecord}>Re-record</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ComposeForm({ channel, onBack, onComposed, setError }) {
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
      setError('Enter a message to send');
      return;
    }
    if (channel === 'call' && !body.trim() && !audioFile && !existingAudio) {
      setError('Enter something to read aloud, choose a recording, or record one');
      return;
    }
    if (channel === 'voice_note') {
      if (mediaKind === 'audio' && !audioFile && !existingAudio) { setError('Choose, upload, or record an audio clip'); return; }
      if (mediaKind === 'image' && !imageFile) { setError('Choose a photo to upload'); return; }
    }

    setSaving(true);
    try {
      let created;
      if (channel === 'sms') {
        created = await api.messages.create({ type: 'sms', title: title || null, text_content: body });
      } else if (channel === 'call') {
        if (existingAudio) {
          created = existingAudio;
        } else if (audioFile) {
          created = await api.messages.uploadAudio(audioFile, title || audioFile.name);
          if (body.trim()) created = await api.messages.editText(created.id, created.title, body);
        } else {
          created = await api.messages.create({ type: 'sms', title: title || null, text_content: body });
        }
      } else if (channel === 'voice_note') {
        if (mediaKind === 'audio') {
          if (existingAudio) {
            created = existingAudio;
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
        <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={onBack}>Back</button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Title (for your reference only)</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
        </div>

        {channel === 'sms' && (
          <div className="field">
            <label>Message</label>
            <textarea required rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should this text say?" />
          </div>
        )}

        {channel === 'call' && (
          <>
            <div className="field">
              <label>Message to read aloud (leave blank if using a recording instead)</label>
              <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should be said on the call?" />
            </div>
            <AudioSourcePicker
              onFileChosen={handleAudioFileChosen}
              onExistingChosen={handleExistingAudioChosen}
              existingId={existingAudio?.id}
            />
            {existingAudio && (
              <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: -8, marginBottom: 14 }}>
                Using saved recording "{existingAudio.title || 'Untitled'}" — any text above won't be added to it.
              </p>
            )}
          </>
        )}

        {channel === 'voice_note' && (
          <>
            <div className="field">
              <label>What are you sending?</label>
              <div className="chip-select">
                <button type="button" className={`chip-toggle ${mediaKind === 'audio' ? 'active' : ''}`} onClick={() => setMediaKind('audio')}>Audio</button>
                <button type="button" className={`chip-toggle ${mediaKind === 'image' ? 'active' : ''}`} onClick={() => setMediaKind('image')}>Photo</button>
              </div>
            </div>
            {mediaKind === 'audio' ? (
              <>
                <AudioSourcePicker
                  onFileChosen={handleAudioFileChosen}
                  onExistingChosen={handleExistingAudioChosen}
                  existingId={existingAudio?.id}
                />
                {existingAudio && (
                  <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: -8, marginBottom: 14 }}>
                    Using saved recording "{existingAudio.title || 'Untitled'}" — any caption below won't be added to it.
                  </p>
                )}
              </>
            ) : (
              <div className="field">
                <label>Photo</label>
                <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
              </div>
            )}
            <div className="field">
              <label>Caption (optional — sent as text alongside it)</label>
              <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a message to go with it" />
            </div>
          </>
        )}

        <button type="submit" className="btn" disabled={saving} style={{ width: '100%' }}>
          {saving ? 'Saving...' : 'Continue to recipients'}
        </button>
      </form>
    </div>
  );
}
