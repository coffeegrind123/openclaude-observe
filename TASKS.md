# TASKS

## QUEUED TASKS

- [ ] Make agent chips clickable to filter by agent
- [ ] Show the cwd for the session underneath the session in the sidebar
- [ ] Make the Activity Timeline pane vertically resizable
- [ ] Fix the conversation (chat) thread view - it currently shows PreTool & PostTool but no info
  - The chat view should really just be the same list and summaries as the main view - we're just grouping them here for convenience so the user can see the relevant thread in one compact view
- [ ] Apply the .prettierrc linting to all app/* files
- [ ] Re-order agent chips to always show the active ones on the left

---

## FUTURE TASKS

Don't implement these yet. They're here for future reference.

- [ ] Add a toggle icon in top right of Top Nav for a Logs view
  - Logs view should just show the raw events and payloads for the selected project or session
  - User can toggle between the "normal" view and raw logs
  - Logs should still have a bit of formatting to clearly show the raw event name "PreToolUse", etc. but then have the payloads auto expanded - no summary, no timeline, no deduping, just raw events and payloads
