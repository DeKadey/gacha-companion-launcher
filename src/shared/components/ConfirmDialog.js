import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import './Modal.css';

export default function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = 'Confirm', danger = false }) {
  const [isClosing, setIsClosing] = useState(false);
  const pendingAction = useRef(null);

  function handleAction(cb) {
    pendingAction.current = cb;
    setIsClosing(true);
  }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') handleAction(onCancel); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]); // eslint-disable-line

  return (
    <motion.div
      className="modal-overlay confirm-overlay modal-overlay--motion"
      initial={{ opacity: 0 }}
      animate={{ opacity: isClosing ? 0 : 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      onAnimationComplete={() => {
        if (isClosing && pendingAction.current) pendingAction.current();
      }}
    >
      <motion.div
        className="modal confirm-modal"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: isClosing ? 0 : 1, y: isClosing ? 12 : 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
        </div>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => handleAction(onCancel)}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => handleAction(onConfirm)}>
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
