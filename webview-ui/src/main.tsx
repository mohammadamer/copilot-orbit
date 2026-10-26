import "./styles.css";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createRoot } from "react-dom/client";
import type {
  ConversationItem,
  ExtensionMessage,
  PendingInteraction,
  WebviewMessage,
  WorkingTimelineEvent,
} from "../../src/domain/messages";
import type { CopilotSession, SessionStatus } from "../../src/domain/session";

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const initialConversationRounds = 4;
const conversationRoundsPerLoad = 4;
const recentSessionLimit = 20;
type SourceFilter = "all" | "local" | "remote" | "unknown";
type SessionFilter =
  | "all"
  | "recent"
  | "active"
  | "pending"
  | "completed"
  | "failed"
  | "favorites"
  | "archived";

const filterLabels: Record<SessionFilter, string> = {
  all: "All",
  recent: "Recent",
  active: "Active",
  pending: "Pending",
  completed: "Completed",
  failed: "Failed",
  favorites: "Favorites",
  archived: "Archived",
};

interface ConversationRound {
  id: string;
  messages: ConversationItem[];
}

interface ConversationScrollState {
  nearBottom: boolean;
  sessionId?: string;
  previousHeight?: number;
}

function postMessage(message: WebviewMessage): void {
  vscode.postMessage(message);
}

function App() {
  const [sessions, setSessions] = useState<CopilotSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const selectedSessionIdRef = useRef(selectedSessionId);
  selectedSessionIdRef.current = selectedSessionId;
  const [conversations, setConversations] = useState<
    Record<string, ConversationItem[]>
  >({});
  const [interactions, setInteractions] = useState<PendingInteraction[]>([]);
  const [timelines, setTimelines] = useState<
    Record<string, WorkingTimelineEvent[]>
  >({});
  const [showWorkingTimeline, setShowWorkingTimeline] = useState(true);
  const [groupByProject, setGroupByProject] = useState(true);
  const [composer, setComposer] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [visibleRoundCounts, setVisibleRoundCounts] = useState<
    Record<string, number>
  >({});
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const conversationScroll = useRef<HTMLDivElement>(null);
  const scrollState = useRef<ConversationScrollState>({ nearBottom: true });
  const pendingComposer = useRef(
    new Map<string, { sessionId: string; content: string }>(),
  );

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "sessions:loaded":
          setSessions(message.sessions);
          break;
        case "conversation:loaded":
          setSelectedSessionId(message.sessionId);
          setConversations((current) => ({
            ...current,
            [message.sessionId]: message.messages,
          }));
          break;
        case "conversation:event":
          setConversations((current) => {
            const messages = current[message.sessionId] ?? [];
            const matchingIndex = messages.findIndex(
              (item) => item.id === message.message.id,
            );
            if (matchingIndex >= 0 && message.message.role === "assistant") {
              const next = [...messages];
              next[matchingIndex] = {
                ...next[matchingIndex],
                text: message.append
                  ? next[matchingIndex].text + message.message.text
                  : message.message.text,
              };
              return { ...current, [message.sessionId]: next };
            }
            return {
              ...current,
              [message.sessionId]: [...messages, message.message],
            };
          });
          break;
        case "session:status":
          setSessions((current) =>
            current.map((session) =>
              session.id === message.sessionId
                ? { ...session, ...statusProperties(message.status) }
                : session,
            ),
          );
          break;
        case "timeline:updated":
          setTimelines((current) => ({
            ...current,
            [message.sessionId]: message.events,
          }));
          break;
        case "preferences:loaded":
          setShowWorkingTimeline(message.showWorkingTimeline);
          setGroupByProject(message.groupByProject);
          break;
        case "session:focus":
          setSelectedSessionId(message.sessionId);
          if (message.resume) {
            postMessage({
              type: "session:resume",
              sessionId: message.sessionId,
            });
          }
          break;
        case "interaction:pending":
          setInteractions((current) =>
            current.some(
              (item) => item.requestId === message.interaction.requestId,
            )
              ? current
              : [...current, message.interaction],
          );
          break;
        case "interaction:cleared":
          setInteractions((current) =>
            current.filter((item) => item.requestId !== message.requestId),
          );
          break;
        case "error":
          setError(message.message);
          break;
        case "operation:result":
          if (message.success && message.message) {
            setNotice(message.message);
          } else if (!message.success && message.message) {
            setError(message.message);
          }
          if (message.requestId) {
            const pending = pendingComposer.current.get(message.requestId);
            if (pending) {
              pendingComposer.current.delete(message.requestId);
              if (
                message.success &&
                selectedSessionIdRef.current === pending.sessionId
              ) {
                setComposer((current) =>
                  current === pending.content ? "" : current,
                );
              }
            }
          }
          break;
      }
    };

    window.addEventListener("message", onMessage);
    postMessage({ type: "sessions:refresh" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const visibleSessions = useMemo(() => {
    const filtered = sessions.filter((session) => {
      const query = debouncedSearch.trim().toLocaleLowerCase();
      if (
        query &&
        ![
          session.displayName,
          session.id,
          session.projectName ?? "",
          session.projectPath ?? "",
          session.workingDirectory ?? "",
        ].some((value) => value.toLocaleLowerCase().includes(query))
      ) {
        return false;
      }
      if (sourceFilter !== "all" && session.source !== sourceFilter) {
        return false;
      }
      switch (filter) {
        case "favorites":
          return session.favorite;
        case "archived":
          return session.archived;
        case "active":
          return (
            session.status === "running" ||
            session.status === "waiting-for-permission" ||
            session.status === "waiting-for-question"
          );
        case "pending":
          return interactions.some(
            (interaction) => interaction.sessionId === session.id,
          );
        case "completed":
        case "failed":
          return !session.archived && session.status === filter;
        case "recent":
        case "all":
          return !session.archived;
      }
    });
    const sorted = filtered.sort((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    );
    return filter === "recent" ? sorted.slice(0, recentSessionLimit) : sorted;
  }, [debouncedSearch, filter, interactions, sessions, sourceFilter]);
  const groupedSessions = useMemo(() => {
    if (!groupByProject) {
      return [{ key: "", name: "", sessions: visibleSessions }];
    }
    const groups = new Map<
      string,
      { name: string; sessions: CopilotSession[] }
    >();
    for (const session of visibleSessions) {
      const key = session.projectPath ?? session.projectName ?? "unknown";
      const group = groups.get(key) ?? {
        name: session.projectName ?? "Unknown project",
        sessions: [],
      };
      group.sessions.push(session);
      groups.set(key, group);
    }
    return [...groups].map(([key, group]) => ({ key, ...group }));
  }, [groupByProject, visibleSessions]);

  const selectedSession = sessions.find(
    (session) => session.id === selectedSessionId,
  );
  const selectedConversation = selectedSessionId
    ? (conversations[selectedSessionId] ?? [])
    : [];
  const selectedInteractions = interactions.filter(
    (interaction) => interaction.sessionId === selectedSessionId,
  );
  const canSendOrSteer = ["idle", "failed", "running"].includes(
    selectedSession?.status ?? "unknown",
  );
  const conversationRounds = useMemo(
    () => groupConversationRounds(selectedConversation),
    [selectedConversation],
  );
  const visibleRoundCount = selectedSessionId
    ? (visibleRoundCounts[selectedSessionId] ?? initialConversationRounds)
    : initialConversationRounds;
  const visibleRounds = conversationRounds.slice(-visibleRoundCount);

  useLayoutEffect(() => {
    const element = conversationScroll.current;
    if (!element) {
      return;
    }
    const sessionChanged = scrollState.current.sessionId !== selectedSessionId;
    if (sessionChanged) {
      element.scrollTop = element.scrollHeight;
      delete scrollState.current.previousHeight;
      scrollState.current.sessionId = selectedSessionId;
    } else if (scrollState.current.previousHeight !== undefined) {
      element.scrollTop +=
        element.scrollHeight - scrollState.current.previousHeight;
      delete scrollState.current.previousHeight;
    } else if (scrollState.current.nearBottom) {
      element.scrollTop = element.scrollHeight;
    }
    scrollState.current.nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 64;
  }, [
    conversationRounds,
    selectedInteractions,
    selectedSessionId,
    visibleRounds,
  ]);

  function submitComposer(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const content = composer.trim();
    if (!content || !selectedSession) {
      return;
    }
    const requestId = crypto.randomUUID();
    pendingComposer.current.set(requestId, {
      sessionId: selectedSession.id,
      content,
    });
    postMessage({
      type: selectedSession.status === "running" ? "run:steer" : "message:send",
      sessionId: selectedSession.id,
      content,
      requestId,
    });
    setError(undefined);
    setNotice(undefined);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">COPILOT ORBIT</p>
          <h1>Sessions</h1>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={() => postMessage({ type: "sessions:refresh" })}
            title="Refresh sessions"
          >
            Refresh
          </button>
          <button
            className="primary-button"
            onClick={() => postMessage({ type: "session:create" })}
          >
            New session
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            onClick={() => setError(undefined)}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="notice-banner" role="status">
          <span>{notice}</span>
          <button
            onClick={() => setNotice(undefined)}
            aria-label="Dismiss notice"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="workspace">
        <aside
          className={`session-pane ${selectedSession ? "mobile-hidden" : ""}`}
        >
          <nav className="filter-tabs" aria-label="Session filters">
            {(
              [
                "all",
                "recent",
                "active",
                "pending",
                "completed",
                "failed",
                "favorites",
                "archived",
              ] as const
            ).map((item) => (
              <button
                key={item}
                className={filter === item ? "active" : ""}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {filterLabels[item]}
              </button>
            ))}
          </nav>
          <div className="session-search">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search session metadata"
              aria-label="Search session metadata"
            />
            <select
              value={sourceFilter}
              onChange={(event) =>
                setSourceFilter(parseSourceFilter(event.target.value))
              }
              aria-label="Filter by source"
            >
              <option value="all">All sources</option>
              <option value="local">Local</option>
              <option value="remote">Remote</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <div className="session-list">
            {visibleSessions.length === 0 ? (
              <p className="empty-state">No sessions in this view.</p>
            ) : (
              groupedSessions.map(
                ({ key, name, sessions: projectSessions }) => (
                  <section className="project-group" key={key || "all"}>
                    {name && <h2 className="project-heading">{name}</h2>}
                    {projectSessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        selected={selectedSessionId === session.id}
                        onSelect={() => {
                          if (!session.available) {
                            setError(
                              "This session is no longer available in the SDK catalog.",
                            );
                            return;
                          }
                          setSelectedSessionId(session.id);
                          postMessage({
                            type: "session:select",
                            sessionId: session.id,
                          });
                          if (!session.canResume) {
                            postMessage({
                              type: "session:resume",
                              sessionId: session.id,
                            });
                          }
                        }}
                        onCopyId={() =>
                          postMessage({
                            type: "session:copy-id",
                            sessionId: session.id,
                          })
                        }
                        onOpenProject={
                          session.projectPath || session.workingDirectory
                            ? () =>
                                postMessage({
                                  type: "project:open",
                                  sessionId: session.id,
                                })
                            : undefined
                        }
                      />
                    ))}
                  </section>
                ),
              )
            )}
          </div>
        </aside>

        <section
          className={`conversation-pane ${!selectedSession ? "mobile-hidden" : ""}`}
        >
          {selectedSession ? (
            <>
              <header className="conversation-header">
                <button
                  className="back-button"
                  onClick={() => setSelectedSessionId(undefined)}
                >
                  Back
                </button>
                <div className="conversation-title">
                  <h2>{selectedSession.displayName}</h2>
                  <span>
                    {selectedSession.projectName ?? "Unknown project"} ·{" "}
                    {selectedSession.status === "unknown"
                      ? "Status unknown"
                      : selectedSession.status}
                    {" · "}
                    {selectedSession.controlCapability === "controllable"
                      ? "Managed by Orbit"
                      : selectedSession.controlCapability === "resumable"
                        ? "Resumable"
                        : "Read only"}
                  </span>
                </div>
                {selectedSession.status === "running" && (
                  <button
                    className="danger-button"
                    onClick={() =>
                      postMessage({
                        type: "run:cancel",
                        sessionId: selectedSession.id,
                      })
                    }
                  >
                    Cancel run
                  </button>
                )}
                {selectedSession.canResume && selectedSession.available && (
                  <button
                    className="primary-button"
                    onClick={() =>
                      postMessage({
                        type: "session:resume",
                        sessionId: selectedSession.id,
                      })
                    }
                  >
                    Resume and inspect
                  </button>
                )}
              </header>
              <div
                className="conversation-scroll"
                ref={conversationScroll}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  scrollState.current.nearBottom =
                    element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight <
                    64;
                }}
              >
                {selectedInteractions.map((interaction) => (
                  <InteractionCard
                    key={interaction.requestId}
                    interaction={interaction}
                  />
                ))}
                {conversationRounds.length > visibleRoundCount && (
                  <button
                    className="secondary-button load-more"
                    onClick={() => {
                      if (conversationScroll.current) {
                        scrollState.current.previousHeight =
                          conversationScroll.current.scrollHeight;
                      }
                      if (selectedSessionId) {
                        setVisibleRoundCounts((current) => ({
                          ...current,
                          [selectedSessionId]: Math.min(
                            conversationRounds.length,
                            visibleRoundCount + conversationRoundsPerLoad,
                          ),
                        }));
                      }
                    }}
                  >
                    Load {conversationRoundsPerLoad} earlier rounds
                  </button>
                )}
                {visibleRounds.flatMap((round) =>
                  round.messages.map((message) => (
                    <article
                      className={`message ${message.role}`}
                      key={message.id}
                    >
                      <p className="message-role">
                        {message.role === "assistant" ? "Copilot" : "You"}
                      </p>
                      <div className="message-content">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeSanitize, rehypeHighlight]}
                          components={markdownComponents}
                        >
                          {message.text}
                        </ReactMarkdown>
                      </div>
                    </article>
                  )),
                )}
                {showWorkingTimeline &&
                  (timelines[selectedSession.id] ?? []).length > 0 && (
                    <details className="working-timeline">
                      <summary>Working timeline</summary>
                      <ul>
                        {timelines[selectedSession.id].map((event) => (
                          <li key={event.id}>
                            <span>{event.toolName}</span>
                            <span className={`timeline-status ${event.status}`}>
                              {event.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                {selectedConversation.length === 0 &&
                  selectedInteractions.length === 0 && (
                    <p className="empty-state conversation-empty">
                      {selectedSession.canResume
                        ? "Resume this session to load its conversation."
                        : "Send a message to start a run."}
                    </p>
                  )}
              </div>
              {selectedSession.available !== false &&
                selectedSession.controlCapability === "controllable" && (
                  <form className="composer" onSubmit={submitComposer}>
                    <label htmlFor="message-composer">
                      {selectedSession.status === "running"
                        ? "Steer the current run"
                        : "Send a message"}
                    </label>
                    {selectedInteractions.length > 0 && (
                      <p className="composer-hint">
                        Respond to the pending interaction before continuing.
                      </p>
                    )}
                    {selectedSession.status === "unknown" && (
                      <p className="composer-hint">
                        Runtime status is unknown; sending is disabled until the
                        SDK confirms the session is idle.
                      </p>
                    )}
                    <div className="composer-row">
                      <textarea
                        id="message-composer"
                        value={composer}
                        onChange={(event) => setComposer(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                        placeholder={
                          selectedSession.status === "running"
                            ? "Guide the current run..."
                            : "Ask Copilot..."
                        }
                        disabled={
                          selectedInteractions.length > 0 || !canSendOrSteer
                        }
                        rows={2}
                      />
                      <button
                        className="primary-button"
                        disabled={
                          !composer.trim() ||
                          selectedInteractions.length > 0 ||
                          !canSendOrSteer
                        }
                      >
                        {selectedSession.status === "running"
                          ? "Steer"
                          : "Send"}
                      </button>
                    </div>
                  </form>
                )}
            </>
          ) : (
            <div className="welcome-state">
              <h2>Every discoverable Copilot session.</h2>
              <p>Clear control where supported.</p>
              <p>Select a session to inspect or resume it.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function getStringArray(
  value: string | number | boolean | string[] | undefined,
): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseSourceFilter(value: string): SourceFilter {
  if (value === "local" || value === "remote" || value === "unknown") {
    return value;
  }
  return "all";
}

function formatActivityTime(value: string | undefined): string {
  if (!value) {
    return "Activity time unknown";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Activity time unknown"
    : `Last active ${date.toLocaleString()}`;
}

function groupConversationRounds(
  messages: ConversationItem[],
): ConversationRound[] {
  const rounds: ConversationRound[] = [];
  for (const message of messages) {
    if (message.role === "user" || rounds.length === 0) {
      rounds.push({ id: message.id, messages: [message] });
      continue;
    }
    const round = rounds[rounds.length - 1];
    const previous = round.messages[round.messages.length - 1];
    if (message.role === "assistant" && previous.role === "assistant") {
      round.messages[round.messages.length - 1] = {
        ...previous,
        text: `${previous.text}\n\n${message.text}`,
      };
    } else {
      round.messages.push(message);
    }
  }
  return rounds;
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    if (!href || !isSafeExternalUrl(href)) {
      return <span>{children}</span>;
    }
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          postMessage({ type: "link:open", url: href });
        }}
      >
        {children}
      </a>
    );
  },
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
};

function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function statusProperties(status: SessionStatus): Partial<CopilotSession> {
  return {
    status,
    canSteer: status === "running",
  };
}

function SessionCard({
  session,
  selected,
  onSelect,
  onCopyId,
  onOpenProject,
}: {
  session: CopilotSession;
  selected: boolean;
  onSelect: () => void;
  onCopyId: () => void;
  onOpenProject?: () => void;
}) {
  return (
    <article className={`session-card ${selected ? "selected" : ""}`}>
      <button className="session-main" onClick={onSelect}>
        <span className="session-name">{session.displayName}</span>
        <span className="session-meta">
          {session.projectName ?? "Unknown project"}
        </span>
        <span className="session-meta">
          {formatActivityTime(session.updatedAt)}
        </span>
        <span className="session-badges">
          <span className={`status-badge ${session.status}`}>
            {session.status === "unknown" ? "Unknown status" : session.status}
          </span>
          <span className="source-badge">
            {session.source === "unknown" ? "Unknown source" : session.source}
          </span>
          {!session.available && (
            <span className="source-badge">Unavailable</span>
          )}
        </span>
      </button>
      <div className="session-actions">
        <button
          className="text-button"
          onClick={onCopyId}
          aria-label={`Copy session ID for ${session.displayName}`}
        >
          Copy ID
        </button>
        {onOpenProject && (
          <button
            className="text-button"
            onClick={onOpenProject}
            aria-label={`Open project for ${session.displayName}`}
          >
            Open project
          </button>
        )}
        <button
          className={
            session.favorite ? "text-button selected-action" : "text-button"
          }
          title={session.favorite ? "Remove favorite" : "Add favorite"}
          aria-label={session.favorite ? "Remove favorite" : "Add favorite"}
          onClick={() =>
            postMessage({
              type: "session:favorite",
              sessionId: session.id,
              favorite: !session.favorite,
            })
          }
        >
          {session.favorite ? "★" : "☆"}
        </button>
        <button
          className="text-button"
          title={session.archived ? "Unarchive session" : "Archive session"}
          aria-label={
            session.archived ? "Unarchive session" : "Archive session"
          }
          onClick={() =>
            postMessage({
              type: "session:archive",
              sessionId: session.id,
              archived: !session.archived,
            })
          }
        >
          {session.archived ? "Unarchive" : "Archive"}
        </button>
        {!session.available && (
          <button
            className="text-button"
            title="Remove saved local metadata"
            onClick={() =>
              postMessage({
                type: "session:metadata:remove",
                sessionId: session.id,
              })
            }
          >
            Forget
          </button>
        )}
      </div>
    </article>
  );
}

function InteractionCard({ interaction }: { interaction: PendingInteraction }) {
  const [answer, setAnswer] = useState("");
  const [fields, setFields] = useState<
    Record<string, string | number | boolean | string[]>
  >(() =>
    Object.fromEntries(
      Object.entries(interaction.schema?.properties ?? {}).map(
        ([key, field]) => [
          key,
          field.default ??
            (field.type === "boolean"
              ? false
              : field.type === "array"
                ? []
                : ""),
        ],
      ),
    ),
  );

  if (interaction.kind === "permission") {
    return (
      <article className="interaction-card permission-card">
        <p className="eyebrow">APPROVAL REQUIRED</p>
        <h3>{interaction.title}</h3>
        <p>{interaction.description}</p>
        {interaction.elevatedRisk && (
          <p className="elevated-risk">{interaction.elevatedRisk}</p>
        )}
        <div className="interaction-actions">
          <button
            className="primary-button"
            onClick={() =>
              postMessage({
                type: "permission:respond",
                requestId: interaction.requestId,
                decision: "approve",
              })
            }
          >
            Approve once
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              postMessage({
                type: "permission:respond",
                requestId: interaction.requestId,
                decision: "reject",
              })
            }
          >
            Reject
          </button>
        </div>
      </article>
    );
  }

  const structured = interaction.questionFormat === "structured";
  const urlMode = interaction.elicitationMode === "url";
  const unsupportedForm =
    structured && !urlMode && interaction.schema === undefined;
  const requestUrl = interaction.url;
  const hasSafeUrl = isSafeExternalUrl(requestUrl ?? "");
  const showLegacyText =
    !structured &&
    (!interaction.choices?.length || interaction.allowFreeform !== false);
  const cancelOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (structured && event.key === "Escape") {
      event.preventDefault();
      postMessage({
        type: "question:respond",
        requestId: interaction.requestId,
        action: "cancel",
      });
    }
  };
  const submitAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedFields = Object.fromEntries(
      Object.entries(fields).filter(([key, value]) => {
        const field = interaction.schema?.properties[key];
        return !(
          (field?.type === "number" || field?.type === "integer") &&
          value === ""
        );
      }),
    );
    postMessage({
      type: "question:respond",
      requestId: interaction.requestId,
      action: "accept",
      ...(structured && !urlMode
        ? { fields: submittedFields }
        : !structured
          ? { answer }
          : {}),
    });
  };

  return (
    <article
      className="interaction-card question-card"
      onKeyDown={cancelOnEscape}
    >
      <p className="eyebrow">
        {structured ? "COPILOT NEEDS INFORMATION" : "COPILOT HAS A QUESTION"}
      </p>
      <h3>{interaction.title}</h3>
      {interaction.description && <p>{interaction.description}</p>}
      {urlMode && (
        <>
          <p>
            {hasSafeUrl
              ? "Open the requested page, complete the browser step, then continue."
              : "This browser request has no safe HTTP or HTTPS link. You can decline or cancel it."}
          </p>
          {hasSafeUrl && requestUrl && (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                postMessage({ type: "link:open", url: requestUrl })
              }
            >
              Open browser link
            </button>
          )}
        </>
      )}
      {unsupportedForm && (
        <p>
          This request did not include a supported structured form. Decline or
          cancel it to continue.
        </p>
      )}
      <form onSubmit={submitAnswer}>
        {structured && !urlMode ? (
          Object.entries(interaction.schema?.properties ?? {}).map(
            ([key, field]) => (
              <label className="field-label" key={key}>
                {field.title ?? key}
                {field.description && <small>{field.description}</small>}
                {field.choices && field.type !== "array" ? (
                  <select
                    required={interaction.schema?.required?.includes(key)}
                    value={String(fields[key] ?? "")}
                    onChange={(event) =>
                      setFields((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose…</option>
                    {field.choices.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </select>
                ) : field.type === "array" && field.choices ? (
                  <select
                    multiple
                    required={interaction.schema?.required?.includes(key)}
                    value={getStringArray(fields[key])}
                    onChange={(event) =>
                      setFields((current) => ({
                        ...current,
                        [key]: Array.from(
                          event.target.selectedOptions,
                          (option) => option.value,
                        ),
                      }))
                    }
                  >
                    {field.choices.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </select>
                ) : field.type === "array" ? (
                  <>
                    <small>Enter one value per line.</small>
                    <textarea
                      required={interaction.schema?.required?.includes(key)}
                      value={getStringArray(fields[key]).join("\n")}
                      onChange={(event) =>
                        setFields((current) => ({
                          ...current,
                          [key]: event.target.value
                            .split(/\r?\n/)
                            .map((item) => item.trim())
                            .filter(Boolean),
                        }))
                      }
                      rows={3}
                    />
                  </>
                ) : field.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(fields[key])}
                    onChange={(event) =>
                      setFields((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                ) : (
                  <input
                    type={
                      field.type === "number" || field.type === "integer"
                        ? "number"
                        : "text"
                    }
                    required={interaction.schema?.required?.includes(key)}
                    value={String(fields[key] ?? "")}
                    min={field.minimum}
                    max={field.maximum}
                    step={field.type === "integer" ? 1 : undefined}
                    minLength={field.minLength}
                    maxLength={field.maxLength}
                    onChange={(event) =>
                      setFields((current) => ({
                        ...current,
                        [key]:
                          field.type === "number" || field.type === "integer"
                            ? event.target.value === ""
                              ? ""
                              : Number(event.target.value)
                            : event.target.value,
                      }))
                    }
                  />
                )}
              </label>
            ),
          )
        ) : interaction.choices?.length ? (
          <select
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            required={!answer && interaction.allowFreeform === false}
          >
            <option value="">Choose an answer…</option>
            {interaction.choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        ) : null}
        {showLegacyText && (
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Your answer"
            required={!structured}
            rows={2}
          />
        )}
        <div className="interaction-actions">
          {(!urlMode || hasSafeUrl) && !unsupportedForm && (
            <button className="primary-button">
              {urlMode ? "Continue after browser step" : "Submit answer"}
            </button>
          )}
          {structured && (
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  postMessage({
                    type: "question:respond",
                    requestId: interaction.requestId,
                    action: "decline",
                  })
                }
              >
                Decline
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  postMessage({
                    type: "question:respond",
                    requestId: interaction.requestId,
                    action: "cancel",
                  })
                }
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </form>
    </article>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Copilot Orbit webview root element is missing.");
}
createRoot(rootElement).render(<App />);
