import React, { useState, useEffect } from 'react';
import TitleBar from '../shared/components/TitleBar';
import './HomePage.css';

export default function HomePage({
  appBgUrl,
  isReady,
  onBeforeEnterTracker,
  onEnterTracker,
  loadingProgress   = 0,
  loadingDone       = false,
  offlineError      = false,
  skipLoadingPhase  = false,
  calculationDone   = false,
  onLoadingUnlock,
}) {
  const [btnVisible, setBtnVisible] = useState(false);
  const [btnAnimDone, setBtnAnimDone] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [barDone, setBarDone] = useState(false);
  const [barEntered, setBarEntered] = useState(false);
  const [mountVisible, setMountVisible] = useState(false);

  // titlePhase drives the loading→home animation:
  //   'entering'  — title centered, bar expanding (Phase 2 animation in progress)
  //   'loading'   — title centered, bar visible, loading in progress
  //   'arriving'  — title sliding up to home position (CSS transition)
  //   'home'      — title at normal position, button can appear
  // Title stays at center for both 'entering' and 'loading' — no intermediate movement.
  // 'calculating' — title only, bar hidden, waiting for calculationDone
  // 'entering'    — bar entrance animation playing
  // 'loading'     — bar visible, tasks running
  // 'arriving'    — title sliding up to home position
  // 'home'        — title settled, Enter button visible
  const [titlePhase, setTitlePhase] = useState(
    skipLoadingPhase ? 'home' : (calculationDone ? 'entering' : 'calculating')
  );

  // One animation frame after mount — lets CSS establish the opacity:0 baseline
  // before we add the visible classes, so transitions actually fire on return.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMountVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Hide the pre-React title in index.html — React now renders the title at the
  // same center position, so the swap is invisible.
  useEffect(() => {
    if (skipLoadingPhase) return;
    const el = document.getElementById('pre-title');
    if (el) el.style.opacity = '0';
  }, []); // eslint-disable-line

  // Once storage is read and the task list is known, start the bar entrance.
  useEffect(() => {
    if (!calculationDone || titlePhase !== 'calculating') return;
    setTitlePhase('entering');
  }, [calculationDone, titlePhase]); // eslint-disable-line

  // When the bar expand animation completes → switch to loading phase and unlock loading.
  // All tasks fire only after this — the bar is fully formed before any progress shows.
  useEffect(() => {
    if (!barEntered) return;
    setTitlePhase('loading');
    onLoadingUnlock?.();
  }, [barEntered]); // eslint-disable-line

  // When loading completes → kick off the arrival animation.
  // Phase flips to 'home' via onTransitionEnd on the content div,
  // so the --arriving class is never stripped before the CSS transition finishes.
  useEffect(() => {
    if (!loadingDone) return;
    setTitlePhase('arriving');
  }, [loadingDone]);

  // Show the button once the title has settled AND backgrounds are ready AND
  // the mount frame has passed (so opacity:0 baseline is painted first).
  useEffect(() => {
    if (!isReady) return;
    if (!mountVisible) return;
    if (!skipLoadingPhase && titlePhase !== 'home') return;
    setBtnVisible(true);
  }, [isReady, titlePhase, skipLoadingPhase, mountVisible]);

  function handleEnter() {
    if (!isReady || exiting) return;
    setExiting(true);
    setTimeout(() => onBeforeEnterTracker?.(), 200); // start tracker after homepage is 67% faded out
    setTimeout(onEnterTracker, 500);
  }

  const hasBg        = !!appBgUrl;
  const isCalculating = titlePhase === 'calculating';
  const isEntering    = titlePhase === 'entering';
  const isLoading     = titlePhase === 'loading';
  const isArriving    = titlePhase === 'arriving';

  // Content class drives the vertical position of the title block.
  // calculating/entering/loading all keep the title at viewport center.
  let contentClass = '';
  if (isCalculating || isEntering || isLoading) {
    contentClass = 'homepage-content--entering';
  } else if (isArriving) {
    contentClass = 'homepage-content--arriving';
  }

  return (
    <div className={[
      'homepage',
      hasBg            ? 'homepage--has-bg'    : '',
      exiting          ? 'homepage--exiting'    : '',
      skipLoadingPhase ? 'homepage--returning'  : 'homepage--no-intro',
    ].filter(Boolean).join(' ')}>

      <TitleBar />

      {/* Content block — padding-top drives the loading→home slide */}
      <div
        className={['homepage-content', contentClass].filter(Boolean).join(' ')}
        onTransitionEnd={() => {
          if (isArriving) setTitlePhase('home');
        }}
      >

        {/* Title */}
        <h1 className={[
          'homepage-title',
          (isCalculating || isEntering || isLoading || isArriving) ? 'homepage-title--static'  : '',
          (skipLoadingPhase && mountVisible && !exiting) ? 'homepage-title--visible' : '',
          (titlePhase === 'home' && !skipLoadingPhase && !exiting)
                                               ? 'homepage-title--visible' : '',
          exiting                              ? 'homepage-title--exit'    : '',
        ].filter(Boolean).join(' ')}>
          Gacha Companion
        </h1>

        {/* Offline message */}
        {offlineError && !skipLoadingPhase && (
          <p className={`homepage-offline-msg${isLoading ? ' homepage-offline-msg--visible' : ''}`}>
            No internet connection — Could not update
          </p>
        )}

        {/* Enter button */}
        <button
          className={[
            'homepage-enter-btn',
            (btnVisible || (skipLoadingPhase && mountVisible && isReady)) ? 'homepage-enter-btn--visible' : '',
            exiting ? 'homepage-enter-btn--exit' : '',
          ].filter(Boolean).join(' ')}
          onClick={handleEnter}
          disabled={!isReady || !btnAnimDone}
          onTransitionEnd={e => { if (e.propertyName === 'opacity') setBtnAnimDone(true); }}
        >
          Gacha Tracker
        </button>
      </div>

      {/* Loading bar — hidden during 'calculating', shown once bar entrance begins */}
      {!skipLoadingPhase && !barDone && !isCalculating && (
        <div
          className={[
            'homepage-loading-bar-wrap',
            isEntering ? 'homepage-loading-bar-wrap--entering'   : '',
            isLoading  ? 'homepage-loading-bar-wrap--visible'    : '',
            isArriving ? 'homepage-loading-bar-wrap--collapsing' : '',
          ].filter(Boolean).join(' ')}
          onAnimationEnd={(e) => {
            if (e.animationName === 'barExpand')   { setBarEntered(true); return; }
            if (e.animationName === 'barCollapse')   setBarDone(true);
          }}
        >
          <div
            className="homepage-loading-bar-fill"
            style={{ width: `${Math.min(100, Math.max(0, loadingProgress)).toFixed(1)}%` }}
          />
        </div>
      )}
    </div>
  );
}
