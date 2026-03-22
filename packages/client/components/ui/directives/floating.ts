import {
  type Accessor,
  type JSX,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

type Props = JSX.Directives["floating"] & object;

export type FloatingElement = {
  config: () => Props;
  element: HTMLElement;
  hide: () => void;
  show: Accessor<Props | undefined>;
};

const [floatingElements, setFloatingElements] = createSignal<FloatingElement[]>(
  [],
);

export { floatingElements };

/**
 * Register a new floating element
 * @param element element
 */
export function registerFloatingElement(element: FloatingElement) {
  setFloatingElements((elements) => [...elements, element]);
}

/**
 * Un register floating element
 * @param element DOM Element
 */
export function unregisterFloatingElement(element: HTMLElement) {
  setFloatingElements((elements) =>
    elements.filter((entry) => entry.element !== element),
  );
}

/**
 * Add floating elements
 * @param element Element
 * @param accessor Parameters
 */
export function floating(element: HTMLElement, accessor: Accessor<Props>) {
  const config = accessor();
  if (!config) return;

  const [show, setShow] = createSignal<Props | undefined>();
  const shouldAutoDismissTooltip =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none)").matches;
  const TOOLTIP_TIMEOUT_MS = 1800;
  let tooltipTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTooltipTimer() {
    if (tooltipTimer) {
      clearTimeout(tooltipTimer);
      tooltipTimer = undefined;
    }
  }
  // DEBUG: createEffect(() => console.info("show:", show()));

  registerFloatingElement({
    config: accessor,
    element,
    show,
    /**
     * Hide the element
     */
    hide() {
      setShow(undefined);
    },
  });

  /**
   * Trigger a floating element
   */
  function trigger(target: keyof Props, desiredState?: boolean) {
    const current = show();
    const config = accessor();

    if (target === "userCard" && config.userCard) {
      if (current?.userCard) {
        setShow(undefined);
      } else if (!current) {
        setShow({ userCard: config.userCard });
      } else {
        setShow(undefined);
        setShow({ userCard: config.userCard });
      }
    }

    if (target === "tooltip" && config.tooltip) {
      if (current?.tooltip) {
        if (desiredState !== true) {
          clearTooltipTimer();
          setShow(undefined);
        }
      } else if (!current) {
        if (desiredState !== false) {
          setShow({ tooltip: config.tooltip });

          if (shouldAutoDismissTooltip) {
            clearTooltipTimer();
            tooltipTimer = setTimeout(() => {
              tooltipTimer = undefined;
              setShow((value) => (value?.tooltip ? undefined : value));
            }, TOOLTIP_TIMEOUT_MS);
          }
        }
      }
    }

    if (target === "contextMenu" && config.contextMenu) {
      if (current?.contextMenu) {
        setShow(undefined);
      } else if (!current) {
        setShow({ contextMenu: config.contextMenu });
      } else {
        setShow(undefined);
        setShow({ contextMenu: config.contextMenu });
      }
    }
  }

  /**
   * Handle click events
   */
  function onClick() {
    // TODO: handle shift+click for mention
    clearTooltipTimer();
    trigger("userCard");
  }

  /**
   * Handle context menu click
   */
  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    clearTooltipTimer();
    trigger("contextMenu");
  }

  const LONG_PRESS_MS = 520;
  const TOUCH_MOVE_CANCEL_DISTANCE = 10;

  let touchStartX = 0;
  let touchStartY = 0;
  let touchTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTouchTimer() {
    if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = undefined;
    }
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      clearTouchTimer();
      return;
    }

    const touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;

    clearTouchTimer();
    touchTimer = setTimeout(() => {
      touchTimer = undefined;

      // Keep floating manager coordinates in sync for context menu placement.
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          clientX: touchStartX,
          clientY: touchStartY,
        }),
      );

      trigger("contextMenu");
      event.preventDefault();
    }, LONG_PRESS_MS);
  }

  function onTouchMove(event: TouchEvent) {
    if (!touchTimer || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const movedX = Math.abs(touch.clientX - touchStartX);
    const movedY = Math.abs(touch.clientY - touchStartY);

    if (
      movedX > TOUCH_MOVE_CANCEL_DISTANCE ||
      movedY > TOUCH_MOVE_CANCEL_DISTANCE
    ) {
      clearTouchTimer();
    }
  }

  function onTouchEnd() {
    clearTouchTimer();
  }

  /**
   * Handle mouse entering
   */
  function onMouseEnter() {
    trigger("tooltip", true);
  }

  /**
   * Handle mouse leaving
   */
  function onMouseLeave() {
    clearTooltipTimer();
    trigger("tooltip", false);
  }

  createEffect(
    on(
      () => accessor().userCard,
      (userCard) => {
        if (userCard) {
          element.style.cursor = "pointer";
          element.style.userSelect = "none";
          element.addEventListener("click", onClick);

          onCleanup(() => element.removeEventListener("click", onClick));
        }
      },
    ),
  );

  createEffect(
    on(
      () => accessor().tooltip,
      (tooltip) => {
        if (tooltip) {
          element.ariaLabel =
            typeof tooltip.content === "string"
              ? tooltip.content
              : tooltip!.aria!;

          element.addEventListener("mouseenter", onMouseEnter);
          element.addEventListener("mouseleave", onMouseLeave);

          onCleanup(() => {
            element.removeEventListener("mouseenter", onMouseEnter);
            element.removeEventListener("mouseleave", onMouseLeave);
          });
        }
      },
    ),
  );

  createEffect(
    on(
      () => accessor().contextMenu,
      (contextMenu) => {
        if (contextMenu) {
          element.addEventListener(
            accessor().contextMenuHandler ?? "contextmenu",
            onContextMenu,
          );
          element.addEventListener("touchstart", onTouchStart, {
            passive: true,
          });
          element.addEventListener("touchmove", onTouchMove, {
            passive: true,
          });
          element.addEventListener("touchend", onTouchEnd, {
            passive: true,
          });
          element.addEventListener("touchcancel", onTouchEnd, {
            passive: true,
          });

          onCleanup(() => {
            element.removeEventListener(
              config.contextMenuHandler ?? "contextmenu",
              onContextMenu,
            );
            element.removeEventListener("touchstart", onTouchStart);
            element.removeEventListener("touchmove", onTouchMove);
            element.removeEventListener("touchend", onTouchEnd);
            element.removeEventListener("touchcancel", onTouchEnd);
            clearTouchTimer();
          });
        }
      },
    ),
  );

  onCleanup(() => unregisterFloatingElement(element));
  onCleanup(() => clearTooltipTimer());
}
