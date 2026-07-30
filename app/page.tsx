import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileDiffOptions } from "@pierre/diffs";
import { PatchDiff, Virtualizer } from "@pierre/diffs/react";
import { useLiveSnapshot } from "./use-live-snapshot";

type FileStatus = "added" | "modified" | "deleted" | "renamed" | "binary";

type FileSummary = {
  title: string;
  what: string;
  why: string;
  details: string[];
  risks: string[];
};

type DiffFile = {
  path: string;
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isTruncated: boolean;
  totalDiffLines: number;
  patch: string;
  snippet: string;
  sourceUrl?: string;
  summary: FileSummary;
  noteReady?: boolean;
};

type DiffSnapshot = {
  version: string;
  generatedAt: string;
  repo: {
    name: string;
    root: string;
    base: string;
    head: string;
    branch?: string;
    baseBranch?: string;
    remote?: string;
    remoteUrl?: string;
    target?: {
      kind: "worktree" | "checkout" | "range" | "branch" | "pull-request";
    };
  };
  change: {
    title: string;
    number?: number;
    url?: string;
    summary: string;
    why: string;
    highlights: string[];
    risks: string[];
  };
  files: DiffFile[];
  notes?: {
    fresh: boolean;
    complete: boolean;
    status: "idle" | "generating" | "complete" | "failed" | "stale";
    completedFiles: number;
    totalFiles: number;
    model?: string;
    reasoning?: string;
  };
};

const DIFF_OPTIONS = {
  diffIndicators: "classic",
  diffStyle: "unified",
  disableFileHeader: true,
  hunkSeparators: "metadata",
  lineDiffType: "word-alt",
  overflow: "scroll",
  theme: "pierre-light",
  themeType: "light",
} satisfies FileDiffOptions<undefined>;

function shortRef(ref: string) {
  return ref.length > 16 ? ref.slice(0, 8) : ref;
}

function changeScope(snapshot: DiffSnapshot) {
  const { repo } = snapshot;
  if (snapshot.change.number) return `PR #${snapshot.change.number}`;
  if (repo.target?.kind === "branch" && repo.baseBranch && repo.branch) {
    return `${repo.baseBranch} → ${repo.branch}`;
  }
  if (repo.target?.kind === "worktree") {
    return repo.head === "WORKTREE"
      ? "Empty repo → working tree"
      : "HEAD → working tree";
  }
  if (repo.target?.kind === "checkout") {
    if (repo.base === repo.head) {
      return "HEAD → working tree";
    }
    const base =
      repo.baseBranch && repo.baseBranch !== repo.branch
        ? repo.baseBranch
        : shortRef(repo.base);
    const checkout = repo.branch
      ? `${repo.branch} checkout`
      : `${shortRef(repo.head)} checkout`;
    return `${base} → ${checkout}`;
  }
  return `${shortRef(repo.base)} → ${shortRef(repo.head)}`;
}

function relativeTime(value: string | null) {
  if (!value) return "Connecting";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1_000),
  );
  if (seconds < 8) return "Updated now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Updated ${minutes}m ago`;
}

function statusLabel(status: FileStatus) {
  if (status === "added") return "Added";
  if (status === "deleted") return "Deleted";
  if (status === "renamed") return "Renamed";
  if (status === "binary") return "Binary";
  return "Modified";
}

function BrandBlock() {
  return (
    <div className="brand-block">
      <div className="brand-mark" aria-hidden="true">
        <span>D</span>
        <span>S</span>
      </div>
      <div>
        <p className="brand-name">Diffsplain</p>
        <p className="brand-tag">Agent-made change notes</p>
      </div>
    </div>
  );
}

function DiffLines({ patch }: { patch: string }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const renderablePatch = useMemo(
    () =>
      patch
        .split("\n")
        .filter((line) => !/^(?:\.\.\.|…) diff truncated;/.test(line))
        .join("\n"),
    [patch],
  );

  useEffect(() => {
    shellRef.current
      ?.closest<HTMLElement>(".diff-scroll")
      ?.scrollTo({ top: 0, left: 0 });
  }, [renderablePatch]);

  return (
    <div
      ref={shellRef}
      className="diff-renderer-shell"
      role="region"
      aria-label="Unified code diff"
    >
      <PatchDiff
        patch={renderablePatch}
        options={DIFF_OPTIONS}
        className="diff-renderer"
      />
    </div>
  );
}

function LoadingState() {
  return (
    <main className="loading-shell">
      <div className="loading-mark">DP</div>
      <p className="eyebrow">LOCAL DIFF READER</p>
      <h1>Preparing the changes.</h1>
      <div className="loading-line" aria-hidden="true">
        <span />
      </div>
      <p className="loading-note">
        Waiting for the workspace snapshot at <code>/diff-data.json</code>
      </p>
    </main>
  );
}

function EmptyState({
  snapshot,
  loadError,
}: {
  snapshot: DiffSnapshot;
  loadError: string | null;
}) {
  return (
    <main className="empty-shell">
      <div className="empty-topline">
        <BrandBlock />
        <div className={`sync-state ${loadError ? "sync-state--error" : ""}`}>
          <span className="live-dot" aria-hidden="true" />
          <div>
            <strong>{loadError ? "Reconnecting" : "Watching"}</strong>
            <span>{snapshot.repo.name}</span>
          </div>
        </div>
      </div>
      <div className="empty-message">
        <p className="eyebrow">CLEAN WORKSPACE</p>
        <h1>No changed files.</h1>
        <p>
          Diffsplain is watching changes against{" "}
          <code>{shortRef(snapshot.repo.base)}</code>. New work will appear here.
        </p>
      </div>
    </main>
  );
}

function ConnectionNotice({
  demoUnavailable,
  message,
}: {
  demoUnavailable: boolean;
  message: string | null;
}) {
  if (!message) return null;
  return (
    <div className="connection-error" role="status">
      {message}
      {demoUnavailable
        ? ". Check public/demo-diff-data.json."
        : " The last valid review stays visible while Diffsplain retries."}
    </div>
  );
}

export default function Home() {
  const { demoUnavailable, loadError, snapshot } =
    useLiveSnapshot<DiffSnapshot>();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [motion, setMotion] = useState<"next" | "previous" | "pick">("pick");
  const [motionKey, setMotionKey] = useState(0);
  const [clock, setClock] = useState(0);
  const touchStart = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const ticker = window.setInterval(() => setClock((value) => value + 1), 5_000);
    return () => window.clearInterval(ticker);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    setSelectedPath((current) => {
      if (current && snapshot.files.some((file) => file.path === current)) {
        return current;
      }
      return snapshot.files[0]?.path ?? null;
    });
  }, [snapshot]);

  const files = useMemo(() => snapshot?.files ?? [], [snapshot]);
  const currentIndex = Math.max(
    0,
    files.findIndex((file) => file.path === selectedPath),
  );
  const currentFile = files[currentIndex];

  const chooseFile = useCallback(
    (index: number, direction: "next" | "previous" | "pick" = "pick") => {
      const file = files[index];
      if (!file) return;
      setMotion(direction);
      setMotionKey((value) => value + 1);
      setSelectedPath(file.path);
      setPickerOpen(false);
      setQuery("");
    },
    [files],
  );

  const move = useCallback(
    (step: number) => {
      if (files.length < 2) return;
      const nextIndex = (currentIndex + step + files.length) % files.length;
      chooseFile(nextIndex, step > 0 ? "next" : "previous");
    },
    [chooseFile, currentIndex, files.length],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPickerOpen(true);
        return;
      }
      if (event.key === "Escape") {
        setPickerOpen(false);
        return;
      }
      if (isTyping || pickerOpen) return;
      if (event.key === "ArrowRight") move(1);
      if (event.key === "ArrowLeft") move(-1);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move, pickerOpen]);

  useEffect(() => {
    if (pickerOpen) searchRef.current?.focus();
  }, [pickerOpen]);

  const visibleFiles = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return files;
    return files.filter((file) => file.path.toLowerCase().includes(cleanQuery));
  }, [files, query]);

  if (!snapshot) {
    return (
      <>
        <LoadingState />
        <ConnectionNotice
          demoUnavailable={demoUnavailable}
          message={loadError}
        />
      </>
    );
  }

  if (!files.length) {
    return (
      <>
        <EmptyState snapshot={snapshot} loadError={loadError} />
        <ConnectionNotice
          demoUnavailable={demoUnavailable}
          message={loadError}
        />
      </>
    );
  }

  if (!currentFile) return <LoadingState />;

  const showFull = expandedFiles.has(currentFile.path);
  const shownPatch =
    currentFile.isTruncated && !showFull
      ? currentFile.snippet
      : currentFile.patch;
  const changeLabel = changeScope(snapshot);
  const noteReady =
    currentFile.noteReady ?? snapshot.notes?.complete ?? true;
  const notesGenerating = snapshot.notes?.status === "generating";
  const notesFailed = snapshot.notes?.status === "failed";
  const notesInProgress = notesGenerating && !noteReady;
  const noteUnavailable = notesFailed && !noteReady;
  const noteProgress = snapshot.notes
    ? `${snapshot.notes.completedFiles} of ${snapshot.notes.totalFiles} ready`
    : "";
  const syncLabel = loadError
    ? "Reconnecting"
    : notesGenerating
      ? "Writing notes"
      : notesFailed
        ? "Notes stopped"
        : "Watching";
  const syncDetail = loadError
    ? relativeTime(snapshot.generatedAt)
    : notesGenerating || notesFailed
      ? noteProgress
      : relativeTime(snapshot.generatedAt);

  return (
    <main
      className="app-shell"
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        if (touchStart.current === null) return;
        const distance =
          (event.changedTouches[0]?.clientX ?? touchStart.current) -
          touchStart.current;
        touchStart.current = null;
        if (Math.abs(distance) < 70) return;
        move(distance < 0 ? 1 : -1);
      }}
    >
      <header className="topbar">
        <BrandBlock />

        <div className="change-block">
          <div className="change-meta">
            <span>{snapshot.repo.name}</span>
            <span className="meta-separator">/</span>
            {snapshot.change.url ? (
              <a href={snapshot.change.url} target="_blank" rel="noreferrer">
                {changeLabel}
              </a>
            ) : (
              <span>{changeLabel}</span>
            )}
          </div>
          <p>{snapshot.change.title}</p>
        </div>

        <div
          className={`sync-state ${
            loadError
              ? "sync-state--error"
              : notesFailed
                ? "sync-state--notes-error"
                : notesGenerating
                  ? "sync-state--notes"
                  : ""
          }`}
          title={loadError ?? `Snapshot ${snapshot.version}`}
        >
          <span className="live-dot" aria-hidden="true" />
          <div>
            <strong>{syncLabel}</strong>
            <span>{syncDetail}</span>
          </div>
        </div>
      </header>

      <section className="reader" aria-label="Changed file reader">
        <div className="reader-toolbar">
          <button
            className="nav-button nav-button--previous"
            onClick={() => move(-1)}
            aria-label="Previous file"
            title="Previous file (Left arrow)"
          >
            <span aria-hidden="true">←</span>
          </button>

          <button
            className="file-picker-trigger"
            onClick={() => setPickerOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
          >
            <span className="file-count">
              {String(currentIndex + 1).padStart(2, "0")}
              <i>/</i>
              {String(files.length).padStart(2, "0")}
            </span>
            <span className={`status-pin status-pin--${currentFile.status}`} />
            <span className="current-path">{currentFile.path}</span>
            <span className="picker-hint">
              <kbd>⌘</kbd>
              <kbd>K</kbd>
            </span>
          </button>

          <div className="file-stats" aria-label="Change totals">
            <span className={`status-label status-label--${currentFile.status}`}>
              {statusLabel(currentFile.status)}
            </span>
            <span className="addition">+{currentFile.additions}</span>
            <span className="deletion">−{currentFile.deletions}</span>
          </div>

          <button
            className="nav-button nav-button--next"
            onClick={() => move(1)}
            aria-label="Next file"
            title="Next file (Right arrow)"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>

        <div
          className={`page page--${motion}`}
          key={`${currentFile.path}-${motionKey}`}
        >
          <section className="diff-pane" aria-labelledby="diff-heading">
            <div className="pane-heading">
              <div>
                <p className="eyebrow">UNIFIED DIFF</p>
                <h1 id="diff-heading">{currentFile.path.split("/").pop()}</h1>
                {currentFile.oldPath ? (
                  <p className="renamed-from">from {currentFile.oldPath}</p>
                ) : null}
              </div>
              <div className="diff-actions">
                {currentFile.isTruncated ? (
                  <button
                    className="text-button"
                    onClick={() =>
                      setExpandedFiles((current) => {
                        const next = new Set(current);
                        if (next.has(currentFile.path)) {
                          next.delete(currentFile.path);
                        } else {
                          next.add(currentFile.path);
                        }
                        return next;
                      })
                    }
                  >
                    {showFull ? "Show excerpt" : "Read full diff"}
                  </button>
                ) : null}
                {currentFile.sourceUrl ? (
                  <a
                    className="text-button"
                    href={currentFile.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open file ↗
                  </a>
                ) : null}
              </div>
            </div>

            {currentFile.isBinary ? (
              <div className="diff-scroll">
                <div className="binary-card">
                  <span className="binary-icon" aria-hidden="true">
                    01
                  </span>
                  <p className="eyebrow">BINARY CHANGE</p>
                  <h2>The file contents cannot appear as text.</h2>
                  <p>
                    The change is still part of this set. Read the agent note for
                    its role.
                  </p>
                </div>
              </div>
            ) : (
              <Virtualizer
                className="diff-scroll"
                contentClassName="diff-scroll-content"
              >
                <DiffLines
                  key={showFull ? "full" : "excerpt"}
                  patch={shownPatch}
                />
              </Virtualizer>
            )}

            <footer className="diff-footer">
              <span>
                {showFull || !currentFile.isTruncated
                  ? `${currentFile.totalDiffLines.toLocaleString()} diff lines`
                  : `Excerpt from ${currentFile.totalDiffLines.toLocaleString()} diff lines`}
              </span>
              <span>Use ← → to change files</span>
            </footer>
          </section>

          <aside className="summary-pane" aria-labelledby="summary-heading">
            <div className="summary-scroll">
              <div
                className={`summary-kicker ${
                  notesInProgress || noteUnavailable
                    ? "summary-kicker--pending"
                    : ""
                }`}
              >
                <span>
                  {notesInProgress
                    ? "AGENT NOTE · WRITING"
                    : noteUnavailable
                      ? "AGENT NOTE · STOPPED"
                      : "AGENT NOTE"}
                </span>
                <span>
                  {String(currentIndex + 1).padStart(2, "0")} /{" "}
                  {String(files.length).padStart(2, "0")}
                </span>
              </div>

              {notesInProgress ? (
                <div
                  className="summary-loading"
                  role="status"
                  aria-live="polite"
                >
                  <h2 id="summary-heading">Writing summary of diff...</h2>
                  <div className="note-skeleton" aria-hidden="true">
                    <div className="note-skeleton-group">
                      <span className="note-skeleton-line note-skeleton-line--long" />
                      <span className="note-skeleton-line note-skeleton-line--medium" />
                    </div>
                    <div className="note-skeleton-group">
                      <span className="note-skeleton-line note-skeleton-line--label" />
                      <span className="note-skeleton-line note-skeleton-line--long" />
                      <span className="note-skeleton-line note-skeleton-line--short" />
                    </div>
                    <div className="note-skeleton-group">
                      <span className="note-skeleton-line note-skeleton-line--label" />
                      <span className="note-skeleton-line note-skeleton-line--medium" />
                      <span className="note-skeleton-line note-skeleton-line--long" />
                      <span className="note-skeleton-line note-skeleton-line--short" />
                    </div>
                  </div>
                </div>
              ) : noteUnavailable ? (
                <>
                  <h2 id="summary-heading">This note is not ready.</h2>
                  <p className="summary-lead">
                    The agent stopped before it reached this file. The diff is
                    still ready to review.
                  </p>
                  <section className="note-section note-section--pending">
                    <p className="eyebrow">WHAT TO DO</p>
                    <p>
                      Check the terminal error, then start Diffsplain again.
                    </p>
                  </section>
                </>
              ) : (
                <>
                  <h2 id="summary-heading">{currentFile.summary.title}</h2>
                  <p className="summary-lead">{currentFile.summary.what}</p>

                  <section className="note-section">
                    <p className="eyebrow">WHY IT CHANGED</p>
                    <p>{currentFile.summary.why}</p>
                  </section>
                </>
              )}

              {!notesInProgress &&
              !noteUnavailable &&
              currentFile.summary.details.length ? (
                <section className="note-section">
                  <p className="eyebrow">KEY DETAILS</p>
                  <ul>
                    {currentFile.summary.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {!notesInProgress &&
              !noteUnavailable &&
              currentFile.summary.risks.length ? (
                <section className="note-section note-section--risk">
                  <p className="eyebrow">CHECK CLOSELY</p>
                  <ul>
                    {currentFile.summary.risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            {!notesInProgress ? (
              <footer className="agent-signoff">
                <span className="agent-glyph" aria-hidden="true">
                  ✦
                </span>
                <span>
                  {noteUnavailable
                    ? "The coding agent stopped"
                    : "Written by the coding agent"}
                  <small>
                    {noteUnavailable
                      ? noteProgress
                      : `Snapshot ${snapshot.version.slice(0, 10)} · ${new Date(
                          snapshot.generatedAt,
                        ).toLocaleString()}`}
                  </small>
                </span>
              </footer>
            ) : null}
          </aside>
        </div>
      </section>

      {pickerOpen ? (
        <div
          className="picker-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPickerOpen(false);
          }}
        >
          <section
            className="picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Choose a changed file"
          >
            <div className="picker-header">
              <div>
                <p className="eyebrow">ALL CHANGED FILES</p>
                <h2>Jump to a file</h2>
              </div>
              <button
                className="picker-close"
                onClick={() => setPickerOpen(false)}
                aria-label="Close file picker"
              >
                Esc
              </button>
            </div>

            <label className="picker-search">
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by path…"
                aria-label="Filter changed files"
              />
              <small>{visibleFiles.length} files</small>
            </label>

            <div className="picker-list">
              {visibleFiles.map((file) => {
                const index = files.findIndex((item) => item.path === file.path);
                const active = file.path === currentFile.path;
                return (
                  <button
                    className={`picker-row ${active ? "picker-row--active" : ""}`}
                    key={file.path}
                    onClick={() =>
                      chooseFile(
                        index,
                        index > currentIndex ? "next" : "previous",
                      )
                    }
                  >
                    <span className="picker-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={`status-pin status-pin--${file.status}`} />
                    <span className="picker-path">{file.path}</span>
                    <span className="picker-change-count">
                      <i>+{file.additions}</i>
                      <b>−{file.deletions}</b>
                    </span>
                  </button>
                );
              })}
              {!visibleFiles.length ? (
                <p className="picker-empty">No changed file matches “{query}”.</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <ConnectionNotice
        demoUnavailable={demoUnavailable}
        message={loadError}
      />
      <span className="sr-only" aria-live="polite">
        {clock >= 0
          ? notesGenerating || notesFailed
            ? `${syncLabel}: ${noteProgress}`
            : relativeTime(snapshot.generatedAt)
          : ""}
      </span>
    </main>
  );
}
