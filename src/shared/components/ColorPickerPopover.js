import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { hexToHsv, hsvToHex, hexToRgb, rgbToHex } from '../utils/color';
import './ColorPickerPopover.css';

export default function ColorPickerPopover({ value, anchor, onClose, onChange }) {
  // HSV stored as an object {h, s, v} — never an array
  const [hsv, setHsv] = useState(() => {
    const [h, s, v] = hexToHsv(value);
    return { h, s, v };
  });
  // Ref that's always current — avoids stale closure in global mouse handlers
  const hsvRef = useRef(hsv);

  const [hexDraft, setHexDraft] = useState(value.replace('#', '').toUpperCase());
  // RGB kept as strings so partial typing works (e.g. clearing "200" to type "50")
  const [rgbDraft, setRgbDraft] = useState(() => hexToRgb(value).map(String));
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const gradRef = useRef();
  const hueRef = useRef();
  const draggingGrad = useRef(false);
  const draggingHue = useRef(false);
  const popoverRef = useRef();

  // Position popover below (or above if not enough space)
  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const popH = 310;
    const popW = 220;
    const top = (window.innerHeight - rect.bottom) >= popH + 8
      ? rect.bottom + 6
      : rect.top - popH - 6;
    let left = rect.left;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    setPos({ top, left });
  }, [anchor]);

  // Apply a new HSV value: update ref + state + derived rgb/hex + call onChange
  function applyHsv(newHsv) {
    hsvRef.current = newHsv;
    setHsv({ ...newHsv });
    const hex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
    setRgbDraft(hexToRgb(hex).map(String));
    setHexDraft(hex.replace('#', '').toUpperCase());
    onChange(hex);
  }

  // Gradient mousedown
  function onGradDown(e) {
    e.preventDefault();
    draggingGrad.current = true;
    const rect = gradRef.current.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100;
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)) * 100;
    applyHsv({ ...hsvRef.current, s, v });
  }

  // Hue bar mousedown
  function onHueDown(e) {
    e.preventDefault();
    draggingHue.current = true;
    const rect = hueRef.current.getBoundingClientRect();
    const h = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
    applyHsv({ ...hsvRef.current, h });
  }

  // Global mousemove/mouseup — uses refs only, no stale closure on hsv
  useEffect(() => {
    function onMove(e) {
      if (draggingGrad.current && gradRef.current) {
        const rect = gradRef.current.getBoundingClientRect();
        const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100;
        const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)) * 100;
        const newHsv = { ...hsvRef.current, s, v };
        hsvRef.current = newHsv;
        setHsv({ ...newHsv });
        const hex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
        setRgbDraft(hexToRgb(hex).map(String));
        setHexDraft(hex.replace('#', '').toUpperCase());
        onChange(hex);
      }
      if (draggingHue.current && hueRef.current) {
        const rect = hueRef.current.getBoundingClientRect();
        const h = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
        const newHsv = { ...hsvRef.current, h };
        hsvRef.current = newHsv;
        setHsv({ ...newHsv });
        const hex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
        setRgbDraft(hexToRgb(hex).map(String));
        setHexDraft(hex.replace('#', '').toUpperCase());
        onChange(hex);
      }
    }
    function onUp() {
      draggingGrad.current = false;
      draggingHue.current = false;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onChange]); // stable — hsvRef handles the changing value

  // Close on outside click / Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    function onDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target) &&
          (!anchor || !anchor.contains(e.target))) {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose, anchor]);

  // RGB inputs: draft strings allow partial typing; clamp+commit on change
  function handleRgbChange(idx, raw) {
    const cleaned = raw.replace(/[^0-9]/g, '').slice(0, 3);
    const next = [...rgbDraft];
    next[idx] = cleaned;
    setRgbDraft(next);
    const nums = next.map(s => Math.max(0, Math.min(255, parseInt(s) || 0)));
    const hex = rgbToHex(nums[0], nums[1], nums[2]);
    const [h, s, v] = hexToHsv(hex);
    const newHsv = { h, s, v };
    hsvRef.current = newHsv;
    setHsv(newHsv);
    setHexDraft(hex.replace('#', '').toUpperCase());
    onChange(hex);
  }

  // On blur, normalize the RGB draft so it shows a clean number
  function handleRgbBlur(idx) {
    const next = [...rgbDraft];
    next[idx] = String(Math.max(0, Math.min(255, parseInt(rgbDraft[idx]) || 0)));
    setRgbDraft(next);
  }

  // Hex input
  function handleHexChange(e) {
    const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexDraft(raw.toUpperCase());
    if (raw.length === 6) {
      const hex = '#' + raw;
      const [h, s, v] = hexToHsv(hex);
      const newHsv = { h, s, v };
      hsvRef.current = newHsv;
      setHsv(newHsv);
      setRgbDraft(hexToRgb(hex).map(String));
      onChange(hex);
    }
  }

  function handleHexBlur() {
    if (hexDraft.length !== 6) setHexDraft(value.replace('#', '').toUpperCase());
  }

  return ReactDOM.createPortal(
    <div
      ref={popoverRef}
      className="cpop"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Gradient area: saturation (x) × value (y) */}
      <div
        ref={gradRef}
        className="cpop-grad"
        style={{ background: `hsl(${hsv.h}, 100%, 50%)` }}
        onMouseDown={onGradDown}
      >
        <div className="cpop-grad-white" />
        <div className="cpop-grad-black" />
        <div className="cpop-thumb" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
      </div>

      {/* Hue bar */}
      <div className="cpop-hue-wrap">
        <div ref={hueRef} className="cpop-hue" onMouseDown={onHueDown}>
          <div className="cpop-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
        </div>
      </div>

      {/* Preview + inputs */}
      <div className="cpop-bottom">
        <div className="cpop-preview" style={{ background: value }} />
        <div className="cpop-inputs">
          <div className="cpop-rgb-row">
            {['R', 'G', 'B'].map((ch, i) => (
              <div key={ch} className="cpop-rgb-field">
                <input
                  className="cpop-num-input"
                  type="text"
                  inputMode="numeric"
                  value={rgbDraft[i]}
                  onChange={e => handleRgbChange(i, e.target.value)}
                  onBlur={() => handleRgbBlur(i)}
                />
                <span className="cpop-num-label">{ch}</span>
              </div>
            ))}
          </div>
          <div className="cpop-hex-row">
            <span className="cpop-hex-hash">#</span>
            <input
              className="cpop-hex-input"
              type="text"
              value={hexDraft}
              onChange={handleHexChange}
              onBlur={handleHexBlur}
              maxLength={6}
              spellCheck={false}
            />
            <span className="cpop-num-label">HEX</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
