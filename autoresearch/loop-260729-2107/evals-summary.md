# Speed autoresearch result

Status: CONVERGED

## Working set

| Stage | Before | After | Change |
|---|---:|---:|---:|
| 60-file snapshot | 981.4 ms | 159.5 ms | 83.7% faster |
| 60-file summaries | 19,165.7 ms | 705.7 ms | 96.3% faster |
| Snapshot to first agent | 4,367.7 ms | 37.0 ms | 99.2% faster |
| Browser update | 798.3 ms | 101.3 ms | 87.3% faster |
| Edit during active notes | 4,303.5 ms | 4,067.5 ms | 5.5% faster |

Git calls fell from 67 to 8. Agent calls fell from 15 to 6. Agent input fell from 203,843 bytes to 105,061 bytes.

## Held-out set

The held-out set uses large patches, a rename, spaces in paths, and an added file.

| Stage | Before | After | Change |
|---|---:|---:|---:|
| Snapshot | 318.9 ms | 193.3 ms | 39.4% faster |
| Summaries after snapshot | 639.7 ms | 439.1 ms | 31.4% faster |

## Kept

- Reuse the first live snapshot during note generation.
- Publish notes without rebuilding Git data.
- Start the first agent job at once; use a 300 ms delay for later edits.
- Use at most 12 files and 180 KB per batch.
- Run three file-note jobs at once.
- Write the whole-change note once after file notes.
- Read all tracked patches with one Git command.
- Push live updates with server-sent events and keep polling as a fallback.
- Cancel stale note work after a new fingerprint appears.

## Rejected

- Low reasoning as the default: 28,758.4 ms versus 26,616.1 ms for the current default, 8.0% slower.
- A fixed 20-file default: fast on tiny patches but no safe input bound.
- Guessing a local default branch before checking the remote: no gain in the working set and it can select the wrong base.
- Timing logs as a speed change: useful for tests, but they do not make the product faster.

## Verification

- `npm run lint`: passed.
- `npm test`: 59 passed.
- `npm run docs:check`: passed.
- Real Codex output checks: complete for default and low reasoning.
