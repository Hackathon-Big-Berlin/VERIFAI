## Plan: Build TruWord V1 Frontend

Create a minimal V1 interface for **TruWord**, a real-time fact-checking tool, using the uploaded requirements as the source of truth.

### What will be built

- Replace the placeholder homepage with a clean two-panel app layout:
  - **Left panel:** live-style scrolling audio transcript
  - **Right sidebar:** flagged fact-check claims as they arrive
- Use a minimalist, high-contrast visual style focused on readability.
- Simulate live incoming data with mock transcript and fact-check events.
- Keep the app intentionally scoped to V1: no routing, no backend integration, no complex state management, no extra features.

### User experience

- The transcript panel will show timestamped transcript lines that appear over time.
- The sidebar will show fact-check cards as flags arrive, including:
  - original sentence
  - verdict
  - reason
  - source link
- The layout will remain usable on smaller screens by stacking or adapting the two panels.
- Clear empty/loading states will make the simulated live behavior understandable.

### Code organization

The implementation will avoid a single-file app and use modular folders:

```text
src/
  components/
    transcript/
      TranscriptPanel.tsx
      TranscriptLine.tsx
    sidepanel/
      FactCheckSidebar.tsx
      FactCheckCard.tsx
  lib/
    mockdata/
      transcript.ts
      fact-checks.ts
    types.ts
  pages/
    Index.tsx
```

### Mock data and future LiveKit integration

- Mock fact-check payloads will use the required JSON contract:

```json
{
  "type": "flag",
  "sentence": "The EU produces 30% of global emissions.",
  "verdict": "disputed",
  "reason": "Current data puts EU share at around 7–8%.",
  "source": "https://..."
}
```

- A small mock stream/generator will simulate receiving transcript and flag events over time.
- Clear TODO comments will be placed where real LiveKit data channel subscriptions or backend API calls should later replace the mock logic, for example:

```ts
// TODO: LiveKit function call would happen here
// TODO: Replace with real LiveKit data channel payload
```

### Technical notes

- Use React hooks only for state and timed mock updates.
- Use existing Vite + React + Tailwind setup.
- Do not add routes or new state libraries.
- Leave `backend/` untouched and empty if it exists or is later added.
- Keep components small, readable, and separated from mock data.