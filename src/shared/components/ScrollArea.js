import { useRef, useState, useEffect, useCallback } from 'react';
import './ScrollArea.css';

export function ScrollArea({
  children,
  className,
  style,
  viewportClassName,
  viewportStyle,
  thumbWidth = 4,
  thumbColor = 'var(--border-bright)',
  thumbHoverColor = 'var(--border-bright)',
}) {
  const viewportRef = useRef(null);
  const [thumb, setThumb] = useState({ visible: false, height: 0, top: 0 });
  const [hovered, setHovered] = useState(false);
  const trackWidth = thumbWidth + 4;

  const updateThumb = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { clientHeight, scrollHeight, scrollTop } = el;
    if (scrollHeight <= clientHeight) {
      setThumb(t => t.visible ? { visible: false, height: 0, top: 0 } : t);
      return;
    }
    const thumbH = Math.max((clientHeight / scrollHeight) * clientHeight, 24);
    const maxTop = clientHeight - thumbH;
    const scrollFraction = scrollTop / (scrollHeight - clientHeight);
    setThumb({ visible: true, height: thumbH, top: scrollFraction * maxTop });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateThumb, { passive: true });
    const ro = new ResizeObserver(updateThumb);
    ro.observe(el);
    const mo = new MutationObserver(updateThumb);
    mo.observe(el, { childList: true, subtree: true });
    updateThumb();
    return () => {
      el.removeEventListener('scroll', updateThumb);
      ro.disconnect();
      mo.disconnect();
    };
  }, [updateThumb]);

  const onThumbDown = useCallback((e) => {
    e.preventDefault();
    const el = viewportRef.current;
    if (!el) return;
    const startY = e.clientY;
    const startTop = el.scrollTop;
    const { scrollHeight, clientHeight } = el;
    const thumbH = Math.max((clientHeight / scrollHeight) * clientHeight, 24);
    const trackRange = clientHeight - thumbH;
    const scrollRange = scrollHeight - clientHeight;

    const onMove = (ev) => {
      if (trackRange <= 0) return;
      el.scrollTop = startTop + ((ev.clientY - startY) / trackRange) * scrollRange;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div
      className={className}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...style }}
    >
      <div
        ref={viewportRef}
        className={`sa-viewport${viewportClassName ? ` ${viewportClassName}` : ''}`}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'none', ...viewportStyle }}
      >
        {children}
      </div>
      {thumb.visible && (
        <div className="sa-track" style={{ width: trackWidth }}>
          <div
            className="sa-thumb"
            onMouseDown={onThumbDown}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              width: thumbWidth,
              height: thumb.height,
              top: thumb.top,
              borderRadius: thumbWidth / 2,
              background: hovered ? thumbHoverColor : thumbColor,
            }}
          />
        </div>
      )}
    </div>
  );
}
