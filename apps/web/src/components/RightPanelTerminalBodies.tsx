import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";

import {
  selectActiveTerminalSurface,
  useRightPanelStore,
  type TerminalPanelSurface,
} from "~/rightPanelStore";

import type { RightPanelTerminalProps } from "./chat/RightPanelSurfaceContent";
import { reconcileMountedTerminalThreads } from "./RightPanelTabs.logic";
import { RightPanelTerminalBody } from "./RightPanelTerminalBody";

/** Where one thread's drawer terminals render; the drawer moves it into its body while shown. */
export interface TerminalBodyHost {
  readonly threadRef: ScopedThreadRef | null;
  readonly element: HTMLDivElement;
  /** Takes the element back out of the drawer, into the hidden holder. */
  readonly park: () => void;
}

/**
 * One stable element per thread, so a thread's terminals survive the drawer remounting (a
 * thread switch, a closed panel, the sheet layout) without re-attaching.
 */
export function createTerminalBodyHosts() {
  const hosts = new Map<string, TerminalBodyHost>();
  let holder: HTMLElement | null = null;
  return {
    host(threadKey: string): TerminalBodyHost {
      let host = hosts.get(threadKey);
      if (!host) {
        const element = document.createElement("div");
        element.className = "flex min-h-0 flex-1 flex-col";
        host = {
          threadRef: parseScopedThreadKey(threadKey),
          element,
          park: () => {
            if (holder) holder.appendChild(element);
            else element.remove();
          },
        };
        hosts.set(threadKey, host);
      }
      return host;
    },
    setHolder(element: HTMLElement | null) {
      holder = element;
    },
    retain(threadKeys: ReadonlySet<string>) {
      for (const [threadKey, host] of hosts) {
        if (threadKeys.has(threadKey)) continue;
        host.element.remove();
        hosts.delete(threadKey);
      }
    },
  };
}

export type TerminalBodyHosts = ReturnType<typeof createTerminalBodyHosts>;

const EMPTY_KEYS: readonly string[] = [];

/** Keeps drawer terminals mounted for recently shown threads; only the active one is visible. */
export function RightPanelTerminalBodies(props: {
  hosts: TerminalBodyHosts;
  activeThreadKey: string | null;
  drawerVisible: boolean;
  terminal: RightPanelTerminalProps;
}) {
  const { hosts, activeThreadKey } = props;
  const panelOpenKeys = useRightPanelStore(
    useShallow((state) =>
      Object.entries(state.byThreadKey).flatMap(([threadKey, thread]) =>
        thread.isOpen && thread.surfaces.some((surface) => surface.kind === "terminal")
          ? [threadKey]
          : [],
      ),
    ),
  );
  const [mounted, setMounted] = useState(EMPTY_KEYS);
  const next = reconcileMountedTerminalThreads({
    current: mounted,
    panelOpen: new Set(panelOpenKeys),
    active: activeThreadKey,
    activeShowing: props.drawerVisible,
  });
  if (next.length !== mounted.length || next.some((key, index) => key !== mounted[index])) {
    setMounted(next);
  }
  const holderRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- gives parked hosts a hidden DOM home and drops the hosts of threads whose terminals unmounted
  useLayoutEffect(() => {
    hosts.setHolder(holderRef.current);
    hosts.retain(new Set(activeThreadKey === null ? mounted : [...mounted, activeThreadKey]));
  }, [activeThreadKey, hosts, mounted]);
  const hiddenTerminal = { ...props.terminal, launchContext: null };

  return (
    <div hidden ref={holderRef}>
      {mounted.map((threadKey) => {
        const active = threadKey === activeThreadKey;
        return (
          <ThreadTerminalBodyPortal
            key={threadKey}
            host={hosts.host(threadKey)}
            visible={active && props.drawerVisible}
            terminal={active ? props.terminal : hiddenTerminal}
          />
        );
      })}
    </div>
  );
}

const ThreadTerminalBodyPortal = memo(function ThreadTerminalBodyPortal(props: {
  host: TerminalBodyHost;
  visible: boolean;
  terminal: RightPanelTerminalProps;
}) {
  const { threadRef } = props.host;
  const surface = useRightPanelStore((state): TerminalPanelSurface | null =>
    selectActiveTerminalSurface(state.byThreadKey, threadRef),
  );
  if (!surface || !threadRef) return null;
  return createPortal(
    <RightPanelTerminalBody
      key={surface.id}
      threadRef={threadRef}
      surface={surface}
      visible={props.visible}
      terminal={props.terminal}
    />,
    props.host.element,
  );
});
