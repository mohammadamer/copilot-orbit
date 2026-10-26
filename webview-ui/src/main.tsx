import "./styles.css";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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
type SourceFilter = "all" | "local" | "remote" | "unknown";

function postMessage(message: WebviewMessage): void {
  vscode.postMessage(message);
}

function App() {
  const [sessions, setSessions] = useState<CopilotSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
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
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [filter, setFilter] = useState<
    "all" | "active" | "completed" | "failed" | "favorites" | "archived"
  >("all");
  const [error, setError] = useState<string>();

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
          if (!message.success && message.message) {
            setError(message.message);
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
      const query = search.trim().toLocaleLowerCase();
      if (
        query &&
        ![
          session.displayName,
          session.id,
          session.projectName ?? "",
          session.workingDirectory ?? "",
        ].some((value) => value.toLocaleLowerCase().includes(query))
      ) {
        return false;
      }
      if (sourceFilter !== "all" && session.source !== sourceFilter) {
        return false;
      }
      if (filter === "favorites") {
        return session.favorite;
      }
      if (filter === "archived") {
        return session.archived;
      }
      if (filter === "active") {
        return (
          session.status === "running" ||
          session.status === "waiting-for-permission" ||
          session.status === "waiting-for-question"
        );
      }
      if (filter === "completed" || filter === "failed") {
        return session.status === filter;
      }
      return !session.archived;
    });
    return filtered.sort((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    );
  }, [filter, search, sessions, sourceFilter]);
  const groupedSessions = useMemo(() => {
    if (!groupByProject) {
      return [["", visibleSessions] as const];
    }
    const groups = new Map<string, CopilotSession[]>();
    for (const session of visibleSessions) {
      const project = session.projectName ?? "Unknown project";
      groups.set(project, [...(groups.get(project) ?? []), session]);
    }
    return [...groups.entries()];
  }, [groupByProject, visibleSessions]);

  const selectedSession = sessions.find(
    (session) => session.id === selectedSessionId,
  );
  const selectedConversation = selectedSessionId
    ? conversations[selectedSessionId] ?? []
    : [];
  const selectedInteractions = interactions.filter(
    (interaction) => interaction.sessionId === selectedSessionId,
  );

  function submitComposer(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const content = composer.trim();
    if (!content || !selectedSession) {
      return;
    }
    postMessage({
      type: selectedSession.status === "running" ? "run:steer" : "message:send",
      sessionId: selectedSession.id,
      content,
    });
    setComposer("");
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
          <button onClick={() => setError(undefined)} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      )}

      <div className="workspace">
        <aside className={`session-pane ${selectedSession ? "mobile-hidden" : ""}`}>
          <nav className="filter-tabs" aria-label="Session filters">
            {(
              [
                "all",
                "active",
                "completed",
                "failed",
                "favorites",
                "archived",
              ] as const
            ).map((item) => (
              <button
                key={item}
                className={filter === item ? "active" : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all"
                  ? "All"
                  : item === "active"
                    ? "Active"
                    : item === "completed"
                      ? "Completed"
                      : item === "failed"
                        ? "Failed"
                        : item === "favorites"
                          ? "Favorites"
                          : "Archived"}
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
              groupedSessions.map(([project, projectSessions]) => (
                <section className="project-group" key={project || "all"}>
                  {project && <h2 className="project-heading">{project}</h2>}
                  {projectSessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      selected={selectedSessionId === session.id}
                      onSelect={() => {
                        if (!session.available) {
                          setError("This session is no longer available in the SDK catalog.");
                          return;
                        }
                        setSelectedSessionId(session.id);
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
                        session.workingDirectory
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
              ))
            )}
          </div>
        </aside>

        <section className={`conversation-pane ${!selectedSession ? "mobile-hidden" : ""}`}>
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
              <div className="conversation-scroll">
                {selectedInteractions.map((interaction) => (
                  <InteractionCard
                    key={interaction.requestId}
                    interaction={interaction}
                  />
                ))}
                {selectedConversation.map((message) => (
                  <article className={`message ${message.role}`} key={message.id}>
                    <p className="message-role">
                      {message.role === "assistant" ? "Copilot" : "You"}
                    </p>
                    <div className="message-content">{message.text}</div>
                  </article>
                ))}
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
                        placeholder={
                          selectedSession.status === "running"
                            ? "Guide the current run..."
                            : "Ask Copilot..."
                        }
                        disabled={
                          selectedInteractions.length > 0 ||
                          selectedSession.status === "unknown"
                        }
                        rows={2}
                      />
                      <button
                        className="primary-button"
                        disabled={
                          !composer.trim() || selectedInteractions.length > 0
                        }
                      >
                        {selectedSession.status === "running" ? "Steer" : "Send"}
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
        <span className="session-badges">
          <span className={`status-badge ${session.status}`}>
            {session.status === "unknown" ? "Unknown status" : session.status}
          </span>
          <span className="source-badge">
            {session.source === "unknown"
              ? "Unknown source"
              : session.source}
          </span>
          {!session.available && <span className="source-badge">Unavailable</span>}
        </span>
      </button>
      <div className="session-actions">
        <button className="text-button" onClick={onCopyId}>
          Copy ID
        </button>
        {onOpenProject && (
          <button className="text-button" onClick={onOpenProject}>
            Open project
          </button>
        )}
        <button
          className={session.favorite ? "text-button selected-action" : "text-button"}
          title={session.favorite ? "Remove favorite" : "Add favorite"}
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

function InteractionCard({
  interaction,
}: {
  interaction: PendingInteraction;
}) {
  const [answer, setAnswer] = useState("");
  const [fields, setFields] = useState<
    Record<string, string | number | boolean | string[]>
  >(() =>
    Object.fromEntries(
      Object.entries(interaction.schema?.properties ?? {}).map(([key, field]) => [
        key,
        field.default ?? "",
      ]),
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
      ...(structured ? { fields: submittedFields } : { answer }),
    });
  };

  return (
    <article className="interaction-card question-card">
      <p className="eyebrow">
        {structured ? "COPILOT NEEDS INFORMATION" : "COPILOT HAS A QUESTION"}
      </p>
      <h3>{interaction.title}</h3>
      {interaction.description && <p>{interaction.description}</p>}
      <form onSubmit={submitAnswer}>
        {structured
          ? Object.entries(interaction.schema?.properties ?? {}).map(
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
                            field.type === "number" ||
                            field.type === "integer"
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
          : interaction.choices?.length
            ? (
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
              )
            : null}
        {(!structured ||
          !interaction.choices?.length ||
          interaction.allowFreeform !== false) && (
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Your answer"
            required={!structured}
            rows={2}
          />
        )}
        <div className="interaction-actions">
          <button className="primary-button">Submit answer</button>
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
