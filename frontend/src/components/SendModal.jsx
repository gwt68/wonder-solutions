import React from 'react';
import SendForm from './SendForm.jsx';

export default function SendModal({ message, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <h2>Send "{message.title || 'Untitled'}"</h2>
        <SendForm message={message} onSent={() => {}} />
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
