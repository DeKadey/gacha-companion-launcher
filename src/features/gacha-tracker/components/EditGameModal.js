import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { StepBasic, StepCharBanner, StepWeaponBanner } from './GameFormSteps';
import ConfirmDialog from '../../../shared/components/ConfirmDialog';
import { useAccent } from '../../../shared/contexts/AccentContext';
import { useT } from '../../../shared/i18n';
import '../../../shared/components/Modal.css';
import { ScrollArea } from '../../../shared/components/ScrollArea';

const TOTAL_STEPS = 3;

function gameToForm(game) {
  return {
    name: game.name,
    color: game.color,
    usesAppColor: game.usesAppColor ?? false,
    iconDataUrl: game.iconPath || '',
    currencyName: game.charBanner.currencyName,
    costPerPull: game.charBanner.costPerPull,
    pullItemName: game.pullItemName || '',
    charBaseRate: parseFloat((game.charBanner.baseRate * 100).toFixed(4)),
    charSoftPity: game.charBanner.softPity,
    charHardPity: game.charBanner.hardPity,
    has5050: game.charBanner.has5050,
    charFeaturedChance: parseFloat(((game.charBanner.featuredChance ?? 0.5) * 100).toFixed(4)),
    guaranteeCarryOver: game.charBanner.guaranteeCarryOver,
    weaponBaseRate: parseFloat((game.weaponBanner.baseRate * 100).toFixed(4)),
    weaponSoftPity: game.weaponBanner.softPity,
    weaponHardPity: game.weaponBanner.hardPity,
    weaponHas5050: game.weaponBanner.has5050 ?? true,
    weaponFeaturedChance: parseFloat(((game.weaponBanner.featuredChance ?? 0.75) * 100).toFixed(4)),
    weaponGuaranteeCarryOver: game.weaponBanner.guaranteeCarryOver,
    specialMechanicId: game.weaponBanner.specialMechanicId,
    specialMechanicConfig: game.weaponBanner.specialMechanicConfig || {},
  };
}

export default function EditGameModal({ game, onUpdate, onClose }) {
  const t = useT();
  const accentColor = useAccent();
  const [step, setStep] = useState(1);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [form, setForm] = useState(() => gameToForm(game));
  const [nameError, setNameError] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const pendingAction = useRef(null);
  const progressColor = form.usesAppColor ? accentColor : form.color;

  function startClose(action) {
    pendingAction.current = action;
    setIsClosing(true);
  }

  function requestClose() { setShowCloseConfirm(true); }
  function confirmClose() { startClose(onClose); }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !showCloseConfirm) setShowCloseConfirm(true); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCloseConfirm]);

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }));
    if (key === 'name' && nameError) setNameError(false);
  }

  function handleNext() {
    if (step === 1 && !form.name.trim()) { setNameError(true); return; }
    setNameError(false);
    setStep(s => s + 1);
  }

  function handleSubmit() {
    if (!form.name.trim()) return;
    const currencyName = form.currencyName.trim();
    const costPerPull = Number(form.costPerPull);
    const iconChanged = form.iconDataUrl !== (game.iconPath || '');
    const updatedGame = {
      ...game,
      name: form.name.trim(),
      color: form.color,
      usesAppColor: form.usesAppColor,
      iconPath: form.iconDataUrl,
      iconFilename: iconChanged ? null : game.iconFilename,
      pullItemName: form.pullItemName.trim(),
      charBanner: {
        ...game.charBanner,
        currencyName, costPerPull,
        baseRate: Number(form.charBaseRate) / 100,
        softPity: Number(form.charSoftPity),
        hardPity: Number(form.charHardPity),
        has5050: form.has5050,
        featuredChance: Number(form.charFeaturedChance) / 100,
        guaranteeCarryOver: form.guaranteeCarryOver,
      },
      weaponBanner: {
        ...game.weaponBanner,
        currencyName, costPerPull,
        baseRate: Number(form.weaponBaseRate) / 100,
        softPity: Number(form.weaponSoftPity),
        hardPity: Number(form.weaponHardPity),
        has5050: form.weaponHas5050,
        featuredChance: Number(form.weaponFeaturedChance) / 100,
        guaranteeCarryOver: form.weaponGuaranteeCarryOver,
        specialMechanicId: form.specialMechanicId,
        specialMechanicConfig: form.specialMechanicConfig,
      },
    };
    startClose(() => onUpdate(updatedGame));
  }

  const canNext = step === 1 ? form.name.trim().length > 0 : true;

  return (
    <>
      <motion.div
        className="modal-overlay modal-overlay--motion"
        initial={{ opacity: 0 }}
        animate={{ opacity: isClosing ? 0 : 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        onAnimationComplete={() => {
          if (isClosing && pendingAction.current) pendingAction.current();
        }}
      >
        <motion.div
          className="modal modal--wizard"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: isClosing ? 0 : 1, y: isClosing ? 12 : 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <div className="modal-header">
            <div>
              <h2 className="modal-title">{t('Edit game')}</h2>
              <p className="modal-subtitle">{t('Step')} {step} {t('of')} {TOTAL_STEPS}</p>
            </div>
            <button className="modal-close" onClick={requestClose}><X size={18} /></button>
          </div>
          <div className="modal-progress" style={{ background: progressColor + '44' }}>
            <div className="modal-progress-fill" style={{ width: `${(step / TOTAL_STEPS) * 100}%`, background: progressColor }} />
          </div>
          <ScrollArea style={{ flex: 1 }} viewportClassName="modal-body">
            {step === 1 && <StepBasic form={form} set={set} nameError={nameError} />}
            {step === 2 && <StepCharBanner form={form} set={set} />}
            {step === 3 && <StepWeaponBanner form={form} set={set} />}
          </ScrollArea>
          <div className="modal-footer">
            {step > 1 && <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)}>{t('Back')}</button>}
            <div style={{ flex: 1 }} />
            {step < TOTAL_STEPS
              ? <button className="btn btn-primary" onClick={handleNext}>{t('Next')}</button>
              : <button className="btn btn-primary" onClick={handleSubmit} disabled={!form.name.trim()}>{t('Save changes')}</button>
            }
          </div>
        </motion.div>
      </motion.div>
      <AnimatePresence>
        {showCloseConfirm && (
          <ConfirmDialog
            key="edit-close-confirm"
            title={t('Discard changes?')}
            message={t("Your edits haven't been saved. Are you sure you want to close?")}
            confirmLabel={t('Close')} danger
            onConfirm={confirmClose}
            onCancel={() => setShowCloseConfirm(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
