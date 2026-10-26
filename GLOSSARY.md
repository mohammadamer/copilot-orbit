# Copilot Orbit

Copilot Orbit helps a developer discover Copilot sessions and manage only the work that a supported runtime allows it to control.

## Sessions and execution

**Session**:
A persistent conversation identity with a stable session ID. A session can remain discoverable even when no client is currently managing its execution.

**Run**:
A period of agent execution within a session. Canceling a run does not delete or complete its session.

**Runtime owner**:
The client currently managing execution for a session. Discovering a session does not establish which client, if any, owns its active run.

**Controllable session**:
A session currently managed by Copilot Orbit, for which the extension can offer verified runtime controls.

**Resumable session**:
A session that the supported SDK can resume under its existing identity. Resumption continues the conversation but does not imply takeover of another client's process.

**Read-only session**:
A session whose available metadata or history can be inspected, but for which Copilot Orbit cannot offer verified execution controls.

**Pending interaction**:
A permission request or user question that requires an explicit response before its managed run can proceed.

## Organization

**Project**:
The workspace or repository context associated with a session through reliable metadata. A session title alone does not establish its project.

**Favorite**:
A personal marker used to find a session more easily; it does not change the session itself.

**Archived session**:
A session locally set aside from ordinary views. Archiving is reversible organization and does not delete, complete, or otherwise change the session.
