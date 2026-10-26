# Keep Session Control in the Extension Host

Copilot Orbit keeps SDK/runtime access, permission handling, session ownership, and authoritative state in the VS Code extension host; the React webview is presentation-only over a validated message bridge. This centralizes trust and lifecycle decisions instead of exposing SDK or process control to the UI, at the cost of routing every interaction through a typed host boundary.
