## Plan: Combine transcript lines into one block per connection

Update the transcript experience so each time **Connect** is clicked, the spoken transcript appears as one continuous block instead of separate rows.

### What will change

- Treat the transcript as a single-speaker session.
- On each new LiveKit connection, clear any previous transcript content and start a fresh transcript block.
- As transcript messages arrive, append finalized speech into the current block.
- Keep interim/non-final transcript updates visible by replacing the in-progress ending text instead of adding a new line.
- Remove the separate timestamp/speaker row layout from the transcript display.

### User experience

- Before connecting, the panel still shows the waiting message.
- After connecting and speaking, the left panel shows one readable paragraph/block of transcript text.
- Disconnecting does not split the transcript into rows.
- Clicking **Connect** again starts a new clean transcript block.

### Technical details

- Update `useLiveKitRoom` so transcript state is session-oriented rather than row-oriented:
  - reset transcript state inside `connect()`
  - maintain finalized text plus the current interim text
  - expose a single combined transcript string or one block-like data object
- Update `TranscriptPanel` to render the joined transcript block.
- `TranscriptLine` can be removed from use or simplified if no longer needed.
- Keep existing LiveKit connection controls and fact-check sidebar behavior unchanged.
- Run the existing TypeScript/tests after implementation.