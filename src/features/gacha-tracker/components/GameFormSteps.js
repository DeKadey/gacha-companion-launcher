import React, { useRef } from 'react';
import { Pencil, ImagePlus } from 'lucide-react';
import { SPECIAL_MECHANICS } from '../engine/mechanics';
import { useAccent } from '../../../shared/contexts/AccentContext';
import { useT } from '../../../shared/i18n';
import { ColorPicker, COLORS } from '../../../shared/components/ColorPicker';

export { COLORS };

export function StepBasic({ form, set, nameError }) {
  const t = useT();
  const accentColor = useAccent();
  const fileInputRef = useRef();

  const ICON_MAX_BYTES = 10 * 1024 * 1024;

  function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > ICON_MAX_BYTES) {
      alert('Icon image must be 10 MB or smaller.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => set('iconDataUrl', ev.target.result);
    reader.readAsDataURL(file);
  }

  function pickColor(c) {
    set('color', c);
    set('usesAppColor', false);
  }

  function pickCustomColor(hex) {
    set('color', hex);
    set('usesAppColor', false);
  }

  function useAppColor() {
    set('usesAppColor', true);
  }

  const isCustom = !form.usesAppColor && !COLORS.includes(form.color);

  return (
    <div className="step">
      <Field label="Game name" required error={nameError ? 'Required' : null}>
        <input
          className={`input${nameError ? ' input--error' : ''}`}
          value={form.name}
          onChange={e => set('name', e.target.value)}
          autoFocus
        />
      </Field>

      <Field label="Game icon">
        <div className="icon-uploader-wrap">
          <div className="icon-uploader" onClick={() => fileInputRef.current.click()}>
            {form.iconDataUrl ? (
              <>
                <img src={form.iconDataUrl} alt="icon" className="icon-preview" />
                <div className="icon-upload-overlay"><Pencil size={16} /></div>
              </>
            ) : (
              <div className="icon-empty-state">
                <ImagePlus size={22} strokeWidth={1.5} />
                <span>{t('Upload Image')}</span>
              </div>
            )}
          </div>
          {form.iconDataUrl && (
            <button className="icon-remove-btn" onClick={() => set('iconDataUrl', '')}>Remove</button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: 'none' }} onChange={handleImageUpload} />
        <p className="field-hint">PNG, JPG, GIF, WebP — shown in sidebar and dashboard</p>
      </Field>

      <Field label="Color">
        <ColorPicker
          color={form.color}
          activeColor={!form.usesAppColor ? form.color : null}
          presets={COLORS}
          onPickPreset={pickColor}
          onPickCustom={pickCustomColor}
        />
        <button
          className={`use-app-color-btn ${form.usesAppColor ? 'use-app-color-btn--active' : ''}`}
          onClick={useAppColor}
        >
          <div className="use-app-color-dot" style={{ background: accentColor }} />
          {t('Use app color')}
        </button>
      </Field>

      <Field label="Currency name">
        <input className="input" value={form.currencyName} onChange={e => set('currencyName', e.target.value)} />
      </Field>
      <Field label="Pull item name">
        <input className="input" value={form.pullItemName} onChange={e => set('pullItemName', e.target.value)}
          placeholder="Optional" />
      </Field>
      <Field label="Cost per pull">
        <input className="input" type="number" value={form.costPerPull}
          onChange={e => set('costPerPull', e.target.value)} />
      </Field>
    </div>
  );
}

export function StepCharBanner({ form, set }) {
  return (
    <div className="step">
      <p className="step-headline">Character Banner</p>
      <div className="field-row">
        <Field label="Base 5★ rate (%)">
          <input className="input" type="number" step="0.1" value={form.charBaseRate}
            onChange={e => set('charBaseRate', e.target.value)} />
        </Field>
        <Field label="Soft pity (pull #)">
          <input className="input" type="number" value={form.charSoftPity}
            onChange={e => set('charSoftPity', e.target.value)} />
        </Field>
      </div>
      <Field label="Hard pity (pull #)">
        <input className="input" type="number" value={form.charHardPity}
          onChange={e => set('charHardPity', e.target.value)} />
      </Field>
      <Field label="Has featured system?">
        <Toggle value={form.has5050} onChange={v => set('has5050', v)} labelOn="Yes" labelOff="No" />
      </Field>
      {form.has5050 && (
        <>
          <Field label="Featured win chance (%)">
            <input className="input" type="number" step="0.1" min="1" max="100"
              value={form.charFeaturedChance}
              onChange={e => set('charFeaturedChance', e.target.value)} />
          </Field>
          <Field label="Guarantee carries over to next banner?">
            <Toggle value={form.guaranteeCarryOver} onChange={v => set('guaranteeCarryOver', v)}
              labelOn="Yes" labelOff="No" />
          </Field>
        </>
      )}
    </div>
  );
}

export function StepWeaponBanner({ form, set }) {
  const selectedMechanic = SPECIAL_MECHANICS.find(m => m.id === form.specialMechanicId)
    || SPECIAL_MECHANICS.find(m => m.id === 'none');

  function setMechanicConfig(key, value) {
    set('specialMechanicConfig', { ...form.specialMechanicConfig, [key]: value });
  }

  return (
    <div className="step">
      <p className="step-headline">Weapon Banner</p>
      <div className="field-row">
        <Field label="Base 5★ rate (%)">
          <input className="input" type="number" step="0.1" value={form.weaponBaseRate}
            onChange={e => set('weaponBaseRate', e.target.value)} />
        </Field>
        <Field label="Soft pity (pull #)">
          <input className="input" type="number" value={form.weaponSoftPity}
            onChange={e => set('weaponSoftPity', e.target.value)} />
        </Field>
      </div>
      <Field label="Hard pity (pull #)">
        <input className="input" type="number" value={form.weaponHardPity}
          onChange={e => set('weaponHardPity', e.target.value)} />
      </Field>
      <Field label="Has featured system?">
        <Toggle value={form.weaponHas5050} onChange={v => set('weaponHas5050', v)} labelOn="Yes" labelOff="No" />
      </Field>
      {form.weaponHas5050 && (
        <>
          <Field label="Featured win chance (%)">
            <input className="input" type="number" step="0.1" min="1" max="100"
              value={form.weaponFeaturedChance}
              onChange={e => set('weaponFeaturedChance', e.target.value)} />
          </Field>
          <Field label="Guarantee carries over to next banner?">
            <Toggle value={form.weaponGuaranteeCarryOver} onChange={v => set('weaponGuaranteeCarryOver', v)}
              labelOn="Yes" labelOff="No" />
          </Field>
        </>
      )}
      <Field label="Special mechanic">
        <select className="input" value={form.specialMechanicId}
          onChange={e => { set('specialMechanicId', e.target.value); set('specialMechanicConfig', {}); }}>
          {SPECIAL_MECHANICS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {selectedMechanic && selectedMechanic.id !== 'none' && (
          <p className="field-hint mechanic-desc">{selectedMechanic.description}</p>
        )}
      </Field>
      {selectedMechanic?.fields?.map(field => (
        <Field key={field.key} label={field.label} hint={field.hint}>
          <input className="input" type={field.type}
            value={form.specialMechanicConfig[field.key] ?? field.default}
            onChange={e => setMechanicConfig(field.key, e.target.value)} />
        </Field>
      ))}
    </div>
  );
}

export const DATABASES = [
  { id: 'genshin', name: 'Genshin Impact' },
  { id: 'hsr',     name: 'Honkai: Star Rail' },
  { id: 'zzz',     name: 'Zenless Zone Zero' },
];

export const DATABASE_FEATURES = {
  genshin: [], // coming in V4
  hsr:     [], // coming in V4
  zzz:     [], // coming in V4
};

export function Field({ label, hint, required, error, children }) {
  return (
    <div className="field">
      <label className="field-label">
        {label}{required && <span className="field-required">*</span>}
      </label>
      {children}
      {error && <p className="field-error">{error}</p>}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Toggle({ value, onChange, labelOn, labelOff }) {
  return (
    <div className="toggle-group">
      <button className={`toggle-btn ${value ? 'toggle-btn--active' : ''}`}
        onClick={() => onChange(true)}>{labelOn}</button>
      <button className={`toggle-btn ${!value ? 'toggle-btn--active' : ''}`}
        onClick={() => onChange(false)}>{labelOff}</button>
    </div>
  );
}

