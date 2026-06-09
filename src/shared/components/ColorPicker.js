import React, { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { contrastColor } from '../utils/color';
import ColorPickerPopover from './ColorPickerPopover';

export const COLORS = [
  '#7c6af7', '#e05c6e', '#4ecb8d', '#f0a854',
  '#5ab4f0', '#c45af0', '#f05a9e', '#4ef0d4',
];

// Shared color picker: preset swatches + custom popover picker
export function ColorPicker({ color, activeColor, presets, onPickPreset, onPickCustom }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const anchorRef = useRef();
  const isCustom = activeColor !== null && !presets.includes(activeColor);
  const currentCustom = activeColor ?? color;

  function togglePopover(e) {
    e.preventDefault();
    setPopoverOpen(v => !v);
  }

  return (
    <div className="color-picker-group">
      <div className="color-picker">
        {presets.map(c => (
          <button key={c}
            className={`color-swatch ${activeColor === c ? 'color-swatch--active' : ''}`}
            style={{ background: c }}
            onClick={() => { onPickPreset(c); setPopoverOpen(false); }}
          />
        ))}
        <button
          ref={anchorRef}
          className={`color-swatch color-custom-swatch ${isCustom ? 'color-swatch--active' : ''}`}
          style={{ background: currentCustom }}
          onClick={togglePopover}
          title="Custom color"
        >
          <Pencil size={10} style={{ color: contrastColor(currentCustom), pointerEvents: 'none' }} />
        </button>
      </div>
      {popoverOpen && (
        <ColorPickerPopover
          value={currentCustom}
          anchor={anchorRef.current}
          onClose={() => setPopoverOpen(false)}
          onChange={hex => onPickCustom(hex)}
        />
      )}
    </div>
  );
}
