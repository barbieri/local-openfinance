import { clsx } from 'clsx';
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type TooltipAlign = 'center' | 'start' | 'end';

type TooltipProps = {
  readonly content: ReactNode;
  readonly children: ReactNode;
  readonly align?: TooltipAlign;
  readonly label?: string;
  readonly className?: string;
};

type TooltipCoords = {
  readonly left: number;
  readonly top: number;
};

const VIEWPORT_PADDING = 8;
const ANCHOR_GAP = 6;

function computeTooltipCoords(
  anchor: DOMRect,
  tooltip: DOMRect,
  align: TooltipAlign,
): TooltipCoords {
  let top = anchor.top - ANCHOR_GAP - tooltip.height;
  if (top < VIEWPORT_PADDING) {
    top = anchor.bottom + ANCHOR_GAP;
  }

  let left = anchor.left + anchor.width / 2 - tooltip.width / 2;
  if (align === 'start') {
    left = anchor.left;
  } else if (align === 'end') {
    left = anchor.right - tooltip.width;
  }

  const maxLeft = window.innerWidth - tooltip.width - VIEWPORT_PADDING;
  left = Math.max(VIEWPORT_PADDING, Math.min(left, maxLeft));

  return { left, top };
}

export function Tooltip({ content, children, align = 'center', label, className }: TooltipProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords | null>(null);

  const show = useCallback(() => {
    setCoords(null);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
    setCoords(null);
  }, []);

  useLayoutEffect(() => {
    if (!visible) {
      return;
    }
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) {
      return;
    }
    setCoords(
      computeTooltipCoords(anchor.getBoundingClientRect(), tooltip.getBoundingClientRect(), align),
    );
  }, [visible, align]);

  const ariaLabel = label ?? (typeof content === 'string' ? content : undefined);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="inline-flex border-0 bg-transparent p-0"
        aria-label={ariaLabel}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </button>
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            className={clsx(
              'pointer-events-none fixed z-[200] max-w-[min(18rem,calc(100vw-1rem))] rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium text-foreground shadow-lg',
              className,
            )}
            style={{
              left: coords?.left ?? -9999,
              top: coords?.top ?? -9999,
              visibility: coords ? 'visible' : 'hidden',
              backgroundColor: 'var(--muted)',
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
