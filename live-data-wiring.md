# Wiring the sidebar / stats to live flags + opinions

The listener already exists — it just throws away `flag` and `opinion` messages today. Here's the exact spot and the changes needed to make the UI react to live data instead of mock-only.

## Where the listener lives

`src/hooks/useLiveKitRoom.ts:62-110` — the `RoomEvent.DataReceived` handler decodes every JSON payload and currently has only one branch (the `transcript` branch). Add two more sibling branches in that same handler:

```ts
// inside the existing if-block, after the transcript branch
if (message.type === "flag" && typeof (message as { sentence?: unknown }).sentence === "string") {
  setFlags((prev) => {
    // dedupe by (sentence, verdict) so a re-published flag doesn't render twice
    const key = `${(message as FactCheckFlag).sentence}|${(message as FactCheckFlag).verdict}`;
    if (prev.some((f) => `${f.sentence}|${f.verdict}` === key)) return prev;
    return [...prev, message as FactCheckFlag];
  });
}

if (message.type === "opinion" && typeof (message as { sentence?: unknown }).sentence === "string") {
  setOpinions((prev) => [...prev, message as Opinion]);
}
```

## Plumbing changes (5 small edits, all in two files)

**`useLiveKitRoom.ts`:**
1. Import `FactCheckFlag, Opinion` from `@/lib/types`.
2. Add two new states: `const [flags, setFlags] = useState<FactCheckFlag[]>([])` and same for `opinions`.
3. Add the two branches above inside `DataReceived`.
4. Return them: `return { status, error, sessions, flags, opinions, connect, disconnect }`.

**`Index.tsx`:**
5. Pull `flags` and `opinions` from the hook, merge with mock:
   ```ts
   const { flags: liveFlags, opinions: liveOpinions, ... } = useLiveKitRoom();
   const allFlags = useMemo(() => [...MOCK_FLAGS, ...liveFlags], [liveFlags]);
   const allOpinions = useMemo(() => [...MOCK_OPINIONS, ...liveOpinions], [liveOpinions]);
   // pass allFlags, allOpinions to StatsHeader / TranscriptPanel / FactCheckSidebar
   ```

That's it on the frontend. Sidebar and StatsHeader are dumb — they re-render whenever the prop array changes, no other changes needed.

## What's still missing (backend, separate work)

Nothing currently publishes `flag` or `opinion` messages on the data channel — `agent.py` only publishes `transcript`. Until we add the `collect_for_fact_check` listener (sketched in `transcript-data-flow.md`), `liveFlags` and `liveOpinions` will always be empty and the UI will keep showing only mock data.

The frontend wiring above is harmless to ship now — it will sit dormant until the backend starts emitting the messages.

## Order to ship it

1. **Now (frontend-only)** — add states + branches + merge. Zero risk, no visible change yet (since live arrays are empty).
2. **After Lukas's pipeline runs** — add the `agent.py` listener that calls `run_fact_check_pipeline` and publishes the two new message types. The frontend lights up automatically.
