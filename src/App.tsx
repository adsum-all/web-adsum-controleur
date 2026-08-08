import { useCallback, useEffect, useRef, useState } from "react";

import { type ControlEvent, ApiError, getControlEvents, getDirectory } from "./api.js";
import { Login } from "./components/Login.js";
import { EventPicker } from "./components/EventPicker.js";
import { ManualEntry } from "./components/ManualEntry.js";
import { Scanner } from "./components/Scanner.js";
import { SyncQueue } from "./components/SyncQueue.js";
import { cacheDirectory } from "./directory.js";
import { pendingCount } from "./queue.js";
import { clearToken, loadToken, saveToken } from "./session.js";

type Tab = "scan" | "manual" | "queue";

// The active tab is mirrored in the URL hash so a refresh stays on the same tab.
const TABS_CTRL: Tab[] = ["scan", "manual", "queue"];
function tabFromHash(): Tab {
  if (typeof window === "undefined") return "scan";
  const h = window.location.hash.replace(/^#\/?/, "").split("/")[0] as Tab;
  return TABS_CTRL.includes(h) ? h : "scan";
}

export function App(): JSX.Element {
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [events, setEvents] = useState<ControlEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<ControlEvent | null>(null);
  const [tab, setTab] = useState<Tab>(() => tabFromHash());
  const dernierHashTab = useRef<string>("");
  useEffect(() => {
    const h = `#/${tab}`;
    dernierHashTab.current = h;
    if (typeof window !== "undefined" && window.location.hash !== h) window.history.replaceState(null, "", h);
  }, [tab]);
  useEffect(() => {
    const onHash = (): void => { if (window.location.hash !== dernierHashTab.current) setTab(tabFromHash()); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [queue, setQueue] = useState<number>(pendingCount());

  useEffect(() => {
    const up = (): void => setOnline(true);
    const down = (): void => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const refreshQueue = useCallback(() => setQueue(pendingCount()), []);

  function logout(): void {
    clearToken();
    setToken(null);
    setEvent(null);
    setEvents([]);
    // The cached directory belongs to the session that fetched it and must not be
    // read by the next controller. The pending queue is deliberately KEPT: it holds
    // check-ins that never reached the server, and clearing it here would destroy
    // attendances. Each entry now carries its author, so the next controller cannot
    // sync them under their own name; they wait for the person who recorded them.
    try {
      localStorage.removeItem("adsum.controleur.directory");
    } catch {
      /* private mode */
    }
  }

  const loadSession = useCallback(async (jwt: string) => {
    setLoading(true);
    setError(null);
    try {
      const [evts] = await Promise.all([
        getControlEvents(jwt),
        getDirectory(jwt).then(cacheDirectory).catch(() => undefined),
      ]);
      setEvents(evts);
    } catch (err) {
      // An expired or revoked token surfaces as 401: drop it and return to the
      // login screen cleanly instead of leaving the user stuck.
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }, []);

  const onAuth = useCallback(
    (jwt: string) => {
      saveToken(jwt);
      setToken(jwt);
      void loadSession(jwt);
    },
    [loadSession],
  );

  // Rehydrate a persisted session on startup: a token restored from
  // localStorage needs its events and member directory re-fetched.
  useEffect(() => {
    const restored = loadToken();
    if (restored) void loadSession(restored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) {
    return (
      <Shell>
        <Login onAuth={onAuth} />
      </Shell>
    );
  }

  if (!event) {
    return (
      <Shell>
        <EventPicker events={events} loading={loading} error={error} onPick={setEvent} />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="topbar">
        <button type="button" className="link" onClick={() => setEvent(null)}>
          Changer
        </button>
        <span className="topbar-title">{event.titre}</span>
        <button type="button" className="link" onClick={logout}>
          Quitter
        </button>
      </header>
      <main className="content">
        {tab === "scan" && <Scanner token={token} event={event} online={online} onQueueChange={refreshQueue} />}
        {tab === "manual" && (
          <ManualEntry token={token} event={event} online={online} onQueueChange={refreshQueue} />
        )}
        {tab === "queue" && <SyncQueue token={token} online={online} onQueueChange={refreshQueue} />}
      </main>
      <nav className="tabbar" aria-label="Navigation">
        <TabButton active={tab === "scan"} label="Scanner" glyph="[ ]" onClick={() => setTab("scan")} />
        <TabButton active={tab === "manual"} label="Manuel" glyph="A" onClick={() => setTab("manual")} />
        <TabButton
          active={tab === "queue"}
          label="File"
          glyph="#"
          badge={queue > 0 ? queue : undefined}
          onClick={() => setTab("queue")}
        />
      </nav>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="app">
      <div className="app-inner">{children}</div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  label: string;
  glyph: string;
  badge?: number;
  onClick: () => void;
}

function TabButton({ active, label, glyph, badge, onClick }: TabButtonProps): JSX.Element {
  return (
    <button type="button" className={`tab ${active ? "tab-active" : ""}`} onClick={onClick} aria-current={active}>
      <span className="tab-glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="tab-label">{label}</span>
      {badge !== undefined && <span className="tab-badge">{badge}</span>}
    </button>
  );
}
