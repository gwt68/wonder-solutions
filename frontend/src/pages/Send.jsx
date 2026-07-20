import React, { useState } from 'react';
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

function ComposeForm({ channel, onBack, onComposed, setError }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [mediaKind, setMediaKind] = useState('audio'); // for voice_note: 'audio' | 'image'
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (channel === 'sms' && !body.trim()) {
      setError('Enter a message to send');
      return;
    }
    if (channel === 'call' && !body.trim() && !audioFile) {
      setError('Enter something to read aloud, or upload a recording');
      return;
    }
    if (channel === 'voice_note') {
      if (mediaKind === 'audio' && !audioFile) { setError('Choose an audio file to upload'); return; }
      if (mediaKind === 'image' && !imageFile) { setError('Choose a photo to upload'); return; }
    }

    setSaving(true);
    try {
      let created;
      if (channel === 'sms') {
        created = await api.messages.create({ type: 'sms', title: title || null, text_content: body });
      } else if (channel === 'call') {
        if (audioFile) {
          created = await api.messages.uploadAudio(audioFile, title || audioFile.name);
          if (body.trim()) created = await api.messages.editText(created.id, created.title, body);
        } else {
          created = await api.messages.create({ type: 'sms', title: title || null, text_content: body });
        }
      } else if (channel === 'voice_note') {
        if (mediaKind === 'audio') {
          created = await api.messages.uploadAudio(audioFile, title || audioFile.name);
        } else {
          created = await api.messages.uploadImage(imageFile, title || imageFile.name);
        }
        if (body.trim()) created = await api.messages.editText(created.id, created.title, body);
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
              <label>Message to read aloud (leave blank if uploading a recording instead)</label>
              <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should be said on the call?" />
            </div>
            <div className="field">
              <label>Or upload a recording instead</label>
              <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
            </div>
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
              <div className="field">
                <label>Audio file</label>
                <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
              </div>
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
