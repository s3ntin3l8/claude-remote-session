import { useEffect, useState } from "react";
import { api, ApiError } from "./api.js";
import { useDashboardStore } from "./store.js";
import { RefreshIcon } from "./icons.js";

export interface BrowserPanelParams {
  projectId: number;
}

// "loading"/"unavailable"/"ready" mirrors GitHubPanel's own three-state
// shape for the same reason — a dockview panel opened from the Dock widget
// or the CommandPalette's Integrations entry (see App.tsx/CommandPalette.tsx),
// where "not applicable" (previews disabled server-wide, or this project has
// no dev server configured) is a normal, common outcome to render inline
// rather than treat as an error.
type BrowserPanelState =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; src: string };

// A dockview panel showing a project's dev server, proxied same-origin at
// "preview-<slug>.<previewBaseHost>" (issue #28) — the iframe embeds cleanly
// because the proxy strips the target's own framing headers and the
// dashboard's CSP explicitly allows *.previewBaseHost as a frame-src (see
// src/plugins/preview-proxy.ts and src/plugins/security.ts).
//
// Deliberately re-derives everything from `params.projectId` on every mount
// rather than persisting a slug/URL in panel params: getOrCreateProjectPreview
// (src/services/preview-registry.ts) is idempotent by projectId, so a
// restored workspace layout (dockview's own toJSON()/fromJSON() round-trip)
// just re-resolves the same preview instead of needing any "is this cached
// slug still valid" recovery logic — the same simplicity GitHubPanelParams
// already gets from storing only `projectId`, not a fetched status.
export function BrowserPanel({ params }: { params: BrowserPanelParams }) {
  const { projects } = useDashboardStore();
  const project = projects.find((p) => p.id === params.projectId);
  const [fetchState, setFetchState] = useState<BrowserPanelState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Nothing to fetch — the "unavailable" message for this case is derived
    // below instead of set here, so this effect never calls setState
    // synchronously (react-hooks/set-state-in-effect): it's known from
    // already-loaded store data, not something that needs a network
    // round-trip to determine, unlike the previewsEnabled/preview-creation
    // calls below.
    if (!project?.devServerUrl) return;

    let cancelled = false;
    api
      .getServerInfo()
      .then((info) => {
        if (cancelled) return;
        if (!info.previewsEnabled) {
          setFetchState({
            status: "unavailable",
            message: "Browser preview isn't enabled on this server (PREVIEW_BASE_HOST is unset).",
          });
          return;
        }
        return api.createProjectPreview(params.projectId).then((preview) => {
          if (cancelled) return;
          const scheme = window.location.protocol;
          setFetchState({
            status: "ready",
            src: `${scheme}//preview-${preview.slug}.${info.previewBaseHost}/`,
          });
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFetchState({
          status: "unavailable",
          message:
            err instanceof ApiError ? err.message : "Couldn't open a preview for this project.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [params.projectId, project?.devServerUrl, reloadKey]);

  // Checked client-side rather than relying on an iframe load failure: a
  // cross-origin iframe's load error can't be introspected from JS at all,
  // so this is the one case worth catching proactively (derived at render
  // time from already-loaded store data — see the effect's own comment on
  // why this isn't fetchState) rather than showing a blank/broken frame.
  const state: BrowserPanelState = !project?.devServerUrl
    ? {
        status: "unavailable",
        message:
          "This project has no dev server URL configured. Set one in the project's settings.",
      }
    : fetchState;

  if (state.status === "loading") {
    return <div className="browser-panel-empty">Loading…</div>;
  }

  if (state.status === "unavailable") {
    return <div className="browser-panel-empty">{state.message}</div>;
  }

  return (
    <div className="browser-panel">
      <div className="browser-panel-toolbar">
        <span className="browser-panel-url" title={state.src}>
          {state.src}
        </span>
        <button
          className="browser-panel-reload"
          onClick={() => setReloadKey((k) => k + 1)}
          title="Reload"
        >
          <RefreshIcon size={13} />
        </button>
      </div>
      {/* Keyed on reloadKey so "Reload" remounts the iframe (a plain
          location.reload() inside a cross-origin frame isn't reachable from
          here) rather than trying to force a same-src navigation. */}
      <iframe key={reloadKey} className="browser-panel-frame" src={state.src} title="Preview" />
    </div>
  );
}
