# Task 2 Report: Create reminders from transcript flows

## What I implemented

- Extended `tests/homework-reminders.js` with the Task 2 RED/GREEN assertions for transcript-driven reminder creation.
- Added shared reminder helpers in `services/homework-reminders.js`:
  - `shouldCreateReminderFromProcessed(processed = {})`
  - `buildHomeworkReminderPrompt(reminderId, homeworkList)`
  - `createHomeworkReminderFromTranscript({ academyId, teacherId, studentId, transcriptId, processed })`
- Updated `routes/transcripts.js` so manual transcript processing returns `transcript_id` and manual `send-to-chat` creates a homework reminder plus the second CTA chat message through the shared service.
- Updated `services/gmail.js` so the Gmail transcript flow reuses the same shared reminder creation service and posts the same second CTA message after transcript storage.
- Updated `public/transcripts.html` so the processed transcript payload explicitly preserves `transcript_id` in `lastProcessedJson`.

## Tests run and results

1. RED:
   - Command: `node tests/homework-reminders.js`
   - Result: FAIL
   - Output:

```text
/Users/edu/Desktop/app academy/AcademiaPro/tests/homework-reminders.js:21
    assert.strictEqual(shouldCreateReminderFromProcessed({ deberes: [] }), false);
                       ^

TypeError: shouldCreateReminderFromProcessed is not a function
```

2. Verification setup:
   - Command: `npm rebuild sqlite3`
   - Result: PASS
   - Notes: the first focused test run exposed a local native-module mismatch for `sqlite3` under the current Node runtime, so I rebuilt it before rerunning the task test.

3. GREEN:
   - Command: `node tests/homework-reminders.js`
   - Result: PASS
   - Output:

```text
[dotenv@17.3.1] injecting env (8) from .env -- tip: ⚡️ secrets for agents: https://dotenvx.com/as2
Using PostgreSQL (Railway)
homework-reminders tests passed
```

4. Syntax verification:
   - Command: `node --check services/homework-reminders.js`
   - Result: PASS
   - Command: `node --check routes/transcripts.js`
   - Result: PASS
   - Command: `node --check services/gmail.js`
   - Result: PASS

## TDD evidence

- RED command: `node tests/homework-reminders.js`
- RED result: `TypeError: shouldCreateReminderFromProcessed is not a function`
- GREEN command: `node tests/homework-reminders.js`
- GREEN result: `homework-reminders tests passed`

## Files changed

- `services/homework-reminders.js`
- `routes/transcripts.js`
- `services/gmail.js`
- `public/transcripts.html`
- `tests/homework-reminders.js`

## Self-review findings

- The manual and Gmail transcript flows now both create reminders through the same service entry point, so reminder creation logic is not duplicated.
- The transcript chat formatting helper is still reused in both flows.
- Reminder CTA message text and styles match the task brief verbatim, while homework list items are HTML-escaped before rendering.
- Real-time chat emission now includes the second reminder CTA message in both flows so the chat stays consistent without waiting for a refresh.

## Concerns

- `routes/transcripts.js`, `services/gmail.js`, and `public/transcripts.html` already had local uncommitted edits before this task started. I worked with those changes in place and did not revert them.

---

## Reviewer fix pass

### What I fixed

- Restored the original primary transcript chat message format in `routes/transcripts.js` so Task 2 only adds the second CTA reminder message.
- Restored the original primary Gmail transcript chat message format in `services/gmail.js` so the CTA reminder remains additive only.
- Preserved transcript linkage for history resend by returning `transcript_id` in `/api/transcripts/history` and carrying it through `public/transcripts.html` when a historical transcript is reopened and re-sent.
- Added focused helper coverage in `tests/homework-reminders.js` for:
  - rejecting empty/whitespace-only homework lists
  - preserving a processed `transcript_id`
  - falling back to a supplied transcript id when the processed payload does not already contain one
- Added `getTranscriptIdForReminder(processed, fallbackTranscriptId)` to `services/homework-reminders.js` and used it inside reminder creation so resend/history flows keep transcript linkage.

### Reviewer fix TDD evidence

1. RED:
   - Command: `node tests/homework-reminders.js`
   - Result: FAIL
   - Output:

```text
/Users/edu/Desktop/app academy/AcademiaPro/tests/homework-reminders.js:31
    assert.strictEqual(getTranscriptIdForReminder({ transcript_id: 42 }), 42);
                       ^

TypeError: getTranscriptIdForReminder is not a function
```

2. GREEN:
   - Command: `node tests/homework-reminders.js`
   - Result: PASS
   - Output:

```text
[dotenv@17.3.1] injecting env (8) from .env -- tip: 🔐 prevent building .env in docker: https://dotenvx.com/prebuild
Using PostgreSQL (Railway)
homework-reminders tests passed
```

3. Follow-up syntax verification:
   - Command: `node --check services/homework-reminders.js`
   - Result: PASS
   - Command: `node --check routes/transcripts.js`
   - Result: PASS
   - Command: `node --check services/gmail.js`
   - Result: PASS

### Files updated in reviewer fix pass

- `services/homework-reminders.js`
- `routes/transcripts.js`
- `services/gmail.js`
- `public/transcripts.html`
- `tests/homework-reminders.js`

### Additional self-review findings

- Reminder CTA creation still only happens when normalized homework items remain after trimming, so blank entries do not generate a second message.
- History resend now preserves transcript linkage by explicitly injecting `transcript_id` into the client-side summary payload before `send-to-chat`.

---

## Follow-up fix pass

### What I fixed

- Wrapped transcript history JSON parsing in `public/transcripts.html` so one malformed or legacy `processed_json` row degrades safely instead of breaking the whole history resend UI.
- Added `safeParseProcessedJson(rawJson)` and `buildHistorySummaryPayload(row)` in `public/transcripts.html` and used them in `loadHistory()`.
- Reworked `tests/homework-reminders.js` into focused mocked behavior coverage instead of helper-only assertions.
- Added focused coverage for:
  - manual transcript flow: no second CTA when homework is empty after cleaning
  - manual transcript flow: second CTA appears and transcript linkage is preserved when cleaned homework exists
  - history/resend payload shaping: malformed rows are tolerated and `transcript_id` is preserved
  - Gmail transcript flow: reminder creation and second CTA message use the same path when homework exists
- Suppressed dotenv/bootstrap and Gmail processing noise in the focused test output so the command stays readable.

### Follow-up fix tests and results

1. Covering test run:
   - Command: `node tests/homework-reminders.js`
   - Result: PASS
   - Output:

```text
homework-reminders tests passed
```

2. Syntax verification:
   - Command: `node --check services/homework-reminders.js`
   - Result: PASS
   - Command: `node --check routes/transcripts.js`
   - Result: PASS
   - Command: `node --check services/gmail.js`
   - Result: PASS

### Files updated in follow-up fix pass

- `public/transcripts.html`
- `tests/homework-reminders.js`

### Follow-up self-review findings

- The primary transcript message remains unchanged in both manual and Gmail flows; only the second CTA reminder message is additive.
- The history resend UI now keeps working even if an older `processed_json` row cannot be parsed.
- The focused test file now exercises task-critical flow behavior with mocked `db` and `io`, not just pure helper functions.
