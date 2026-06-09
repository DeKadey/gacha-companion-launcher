import React, { useCallback } from 'react';
import './TitleBar.css';

export default function TitleBar() {
  // JavaScript-based window drag — replaces -webkit-app-region: drag.
  const handleDragStart = useCallback((e) => {
    if (e.button !== 0) return;           // left button only
    e.preventDefault();

    let lastX = e.screenX;
    let lastY = e.screenY;

    const onMove = (e) => {
      const dx = e.screenX - lastX;
      const dy = e.screenY - lastY;
      lastX = e.screenX;
      lastY = e.screenY;
      window.api?.moveWindowBy?.(dx, dy);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',  onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',  onUp);
  }, []);

  return (
    <div className="title-bar">
      <div className="title-bar-drag" onMouseDown={handleDragStart} />
    </div>
  );
}
