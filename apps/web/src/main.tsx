import { lazy, StrictMode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ApplicationState } from "./application/application-client-base";
import { MaintenanceMonitor } from "./application/maintenance";
import { ApplicationClient } from "./application/application-client";
import { Pairing } from "./components/Pairing";
import { ProviderAuthPage } from "./components/ProviderAuthPage";
import { UpdatingScreen } from "./components/UpdatingScreen";
import { Workspace } from "./components/Workspace";
import { QuickSessionDialog } from "./components/QuickSessionDialog";
import { ToastProvider } from "./components/Toast";
import { fixtureState, selectFixtureSession } from "./fixtures/workspace";
import { notificationPresence } from "./notifications";
import {
  findDeepLinkedSession,
  sessionDeepLinkTarget,
  urlAfterConsumingSessionDeepLink,
} from "./session-deep-links";
import "./styles.css";
import "./themes";

const StandaloneSharedMarkdownEditor = lazy(async () => ({
  default: (await import("./components/StandaloneSharedMarkdownEditor")).StandaloneSharedMarkdownEditor,
}));

const standaloneSharedFile = (): { name: string; url: string; projectPath?: string } | undefined => {
  if (location.pathname !== "/shared-editor") return undefined;
  const value = new URLSearchParams(location.search).get("file");
  if (value === null) return undefined;
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin) return undefined;
    const projectPath = url.searchParams.get("path") ?? undefined;
    const sharedMarkdown = url.pathname.startsWith("/shared/") && /\.(?:md|markdown)$/iu.test(url.pathname);
    const projectMarkdown = /^\/project-files\/[^/]+\/[^/]+$/u.test(url.pathname)
      && projectPath !== undefined && /\.(?:md|markdown)$/iu.test(projectPath);
    if (!sharedMarkdown && !projectMarkdown) return undefined;
    const name = projectPath?.split("/").pop() ?? decodeURIComponent(url.pathname.split("/").pop() ?? "Shared Markdown");
    return { name, url: `${url.pathname}${url.search}`, ...(projectPath === undefined ? {} : { projectPath }) };
  } catch { return undefined; }
};

const fixtureMode =
  import.meta.env.VITE_FIXTURE_MODE === "true" ||
  new URLSearchParams(location.search).has("fixture");

function Root() {
  const [client] = useState(() => {
    if (fixtureMode) {
      return undefined;
    }

    return new ApplicationClient();
  });
  const [updating, setUpdating] = useState(false);
  const [quickSessionOpen, setQuickSessionOpen] = useState(false);
  const [providerConfigured, setProviderConfigured] = useState<boolean>();
  const quickSessionTrigger = useRef<HTMLElement | null>(null);
  const changeQuickSessionOpen = (open: boolean): void => {
    setQuickSessionOpen(open);
    if (!open) queueMicrotask(() => quickSessionTrigger.current?.focus());
  };
  const [state, setState] = useState<ApplicationState>(() => {
    if (fixtureMode) {
      return fixtureState;
    }

    return client?.snapshot ?? fixtureState;
  });

  useEffect(() => {
    if (client === undefined) { setProviderConfigured(true); return; }
    void client.getAuthProviders().then((providers) => setProviderConfigured(providers.some(({ configured }) => configured))).catch(() => setProviderConfigured(true));
  }, [client]);

  useEffect(() => {
    if (client === undefined) {
      return;
    }

    const unsubscribe = client.subscribe(setState);
    client.connect();

    return () => {
      unsubscribe();
      client.stop();
    };
  }, [client]);

  useEffect(() => {
    if (client === undefined) return;
    const monitor = new MaintenanceMonitor({
      fetchStatus: () => fetch("/maintenancez", { cache: "no-store" }),
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (handle) => window.clearTimeout(handle as number),
      onChange: setUpdating,
      onRecovered: () => client.connect(),
    });
    monitor.start();
    return () => monitor.stop();
  }, [client]);

  useEffect(() => {
    if (!(client instanceof ApplicationClient)) return;
    const report = (): void => {
      const desktop = typeof matchMedia !== "function" || !matchMedia("(max-width: 760px)").matches;
      let pauseMobile = true;
      try { pauseMobile = localStorage.getItem("pi-station:pause-mobile-notifications") !== "false"; } catch { /* Local storage is optional. */ }
      const visible = document.visibilityState === "visible" && document.hasFocus();
      client.setSelectedVisible(visible);
      void fetch("/v2/notifications/presence", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationPresence(state.selectedSessionKey, { desktop, pauseMobile, visible })),
      }).catch(() => undefined);
    };
    report();
    const timer = window.setInterval(report, 20_000);
    addEventListener("focus", report);
    addEventListener("blur", report);
    addEventListener("pi-station:notification-preference", report);
    document.addEventListener("visibilitychange", report);
    return () => {
      clearInterval(timer);
      removeEventListener("focus", report);
      removeEventListener("blur", report);
      removeEventListener("pi-station:notification-preference", report);
      document.removeEventListener("visibilitychange", report);
    };
  }, [client, state.selectedSessionKey]);

  useEffect(() => {
    if (client === undefined || state.connection !== "ready") return;
    const deepLink = sessionDeepLinkTarget(location.search);
    if (deepLink === undefined) return;
    const target = findDeepLinkedSession(state.sessions, deepLink);
    if (target) {
      const owner = state.workspaces?.find(({ projectIds }) => target.projectId !== undefined && projectIds.includes(target.projectId));
      history.replaceState(null, "", urlAfterConsumingSessionDeepLink(new URL(location.href)));
      if (owner === undefined) return;
      if (owner.id === state.activeWorkspaceId) client.select(target.sessionKey);
      else void client.activateWorkspace(owner.id).then(() => client.select(target.sessionKey));
    }
  }, [client, state.activeWorkspaceId, state.connection, state.sessions, state.workspaces]);

  const selectSession = (
    key: Parameters<ApplicationClient["select"]>[0],
  ): void => {
    if (client !== undefined) {
      client.select(key);
      return;
    }

    setState((current) => selectFixtureSession(current, key));
  };

  const executeCommand = (
    action: Parameters<ApplicationClient["executeCommand"]>[0],
    targetSessionKey?: Parameters<ApplicationClient["executeCommand"]>[1],
  ): string | undefined => {
    return client?.executeCommand(action, targetSessionKey);
  };

  const loadEarlierHistory = (): boolean => {
    return client?.requestEarlierHistory() ?? false;
  };

  const setProjectBookmark = (
    projectId: Parameters<ApplicationClient["setProjectBookmark"]>[0],
    bookmarked: boolean,
  ): string | undefined => client?.setProjectBookmark(projectId, bookmarked);

  const reorderProjectBookmark = (
    projectId: Parameters<ApplicationClient["reorderProjectBookmark"]>[0],
    direction: "up" | "down",
  ): string | undefined => client?.reorderProjectBookmark(projectId, direction);

  const setSessionBookmark = (
    projectId: Parameters<ApplicationClient["setSessionBookmark"]>[0],
    sessionKey: Parameters<ApplicationClient["setSessionBookmark"]>[1],
    bookmarked: boolean,
  ): string | undefined => client?.setSessionBookmark(
    projectId,
    sessionKey,
    bookmarked,
  );

  const reorderSessionBookmark = (
    projectId: Parameters<ApplicationClient["reorderSessionBookmark"]>[0],
    sessionKey: Parameters<ApplicationClient["reorderSessionBookmark"]>[1],
    direction: "up" | "down",
  ): string | undefined => client?.reorderSessionBookmark(
    projectId,
    sessionKey,
    direction,
  );

  const createProject = (
    name: string,
    directory: string,
  ): string | undefined => {
    return client?.createProject(name, directory);
  };

  const removeProject = (
    projectId: Parameters<ApplicationClient["removeProject"]>[0],
  ): string | undefined => client?.removeProject(projectId);

  const listDirectory = (
    path?: string,
    showHidden?: boolean,
  ): string | undefined => {
    return client?.listDirectory(path, showHidden);
  };

  const createManagedSession = (
    workingDirectory: string,
    optionalName?: string,
    resumeSessionKey?: Parameters<ApplicationClient["createManagedSession"]>[2],
  ): string | undefined => {
    return client?.createManagedSession(
      workingDirectory,
      optionalName,
      resumeSessionKey,
    );
  };

  const reconnect = useCallback(() => {
    client?.connect();
  }, [client]);

  if (updating) return <UpdatingScreen />;
  if (client !== undefined && providerConfigured === undefined) return <p className="page-loading" role="status">Checking model providers…</p>;
  if (client !== undefined && providerConfigured === false) return <ProviderAuthPage client={client} onboarding onComplete={() => setProviderConfigured(true)} />;

  if (state.connection === "authentication-required" && client !== undefined) {
    return <Pairing onApproved={reconnect} />;
  }

  return (
    <>
    <Workspace
      state={state}
      client={client}
      onSelect={selectSession}
      onCommand={executeCommand}
      onLoadEarlier={loadEarlierHistory}
      {...(client === undefined ? {} : {
        onUploadImage: (file: File, signal: AbortSignal) => client.uploadImage(file, signal),
        onDeleteImage: (id: string) => client.deleteImage(id),
        onUploadAttachment: (file: File, signal: AbortSignal) => client.uploadAttachment(file, signal),
        onDeleteAttachment: (id: string) => client.deleteAttachment(id),
      })}
      onRestartManagedSession={(sessionKey, generationId) => client?.restartManagedSession(sessionKey, generationId)}
      onCreateManagedSession={createManagedSession}
      onConfigureDevelopmentServer={(projectId, configuration) => client?.configureDevelopmentServer(projectId, configuration)}
      onStartDevelopmentServer={(projectId) => client?.startDevelopmentServer(projectId)}
      onStopDevelopmentServer={(projectId) => client?.stopDevelopmentServer(projectId)}
      onViewDevelopmentServerOutput={(projectId) => client?.loadDevelopmentServerOutput(projectId)}
      onInitialPaint={(timelineItems) => client?.reportWorkspacePaint(timelineItems)}
      onListDirectory={listDirectory}
      onCreateProject={createProject}
      onRemoveProject={removeProject}
      onSetProjectClosed={(projectId, closed) => client?.setProjectClosed(projectId, closed) ?? Promise.reject(new Error("Project state changes are unavailable"))}
      onSetProjectBookmark={setProjectBookmark}
      onReorderProjectBookmark={reorderProjectBookmark}
      onSetSessionBookmark={setSessionBookmark}
      onReorderSessionBookmark={reorderSessionBookmark}
      onOpenQuickSession={() => {
        if (quickSessionOpen) {
          changeQuickSessionOpen(false);
          return;
        }
        quickSessionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setQuickSessionOpen(true);
      }}
    />
    <QuickSessionDialog
      open={quickSessionOpen}
      onOpenChange={changeQuickSessionOpen}
      onKept={(key) => {
        client?.connect();
        window.setTimeout(() => client?.select(key), 100);
      }}
    />
    </>
  );
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Application root is missing");
}

const sharedFile = standaloneSharedFile();
createRoot(rootElement).render(
  <StrictMode>
    <ToastProvider>
      {sharedFile === undefined ? <Root /> : (
        <Suspense fallback={<p className="page-loading" role="status">Loading editor…</p>}>
          <StandaloneSharedMarkdownEditor file={sharedFile} />
        </Suspense>
      )}
    </ToastProvider>
  </StrictMode>,
);
