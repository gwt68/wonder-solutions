import React, { useState } from 'react';

export default function PasswordInput({ value, onChange, required, minLength, placeholder, autoFocus }) {
  const [visible, setVisible] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{ paddingRight: 38 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer',
          padding: 6, display: 'flex', alignItems: 'center',
        }}
      >
        <i className={`ti ${visible ? 'ti-eye-off' : 'ti-eye'}`} />
      </button>
    </div>
  );
}
