# Task 1 Report: Schema + helper base for homework reminders

## What I implemented

- Added the `homework_reminders` table definition to `initDb` in [db.js](/Users/edu/Desktop/app%20academy/AcademiaPro/db.js).
- Added the same `CREATE TABLE IF NOT EXISTS homework_reminders` statement to the migrations list so existing databases follow the current init pattern.
- Created [services/homework-reminders.js](/Users/edu/Desktop/app%20academy/AcademiaPro/services/homework-reminders.js) with:
  - `normalizeHomeworkList`
  - `computeNextScheduledFor`
  - `canScheduleReminder`
- Created the focused test file [tests/homework-reminders.js](/Users/edu/Desktop/app%20academy/AcademiaPro/tests/homework-reminders.js) exactly around the Task 1 helper behaviors from the brief.

## Tests run and results

- `node tests/homework-reminders.js`
  - First run: failed as expected with `Error: Cannot find module '../services/homework-reminders'`
  - Second run: passed with `homework-reminders tests passed`
- `node -c db.js`
  - Passed
- `node -c services/homework-reminders.js`
  - Passed
- `node -c tests/homework-reminders.js`
  - Passed

## TDD evidence

### RED

Command:

```bash
node tests/homework-reminders.js
```

Output:

```text
Error: Cannot find module '../services/homework-reminders'
```

### GREEN

Command:

```bash
node tests/homework-reminders.js
```

Output:

```text
homework-reminders tests passed
```

## Files changed

- [db.js](/Users/edu/Desktop/app%20academy/AcademiaPro/db.js)
- [services/homework-reminders.js](/Users/edu/Desktop/app%20academy/AcademiaPro/services/homework-reminders.js)
- [tests/homework-reminders.js](/Users/edu/Desktop/app%20academy/AcademiaPro/tests/homework-reminders.js)
- [task-1-report.md](/Users/edu/Desktop/app%20academy/AcademiaPro/.superpowers/sdd/task-1-report.md)

## Self-review findings

- The helper implementation matches the brief exactly and stays intentionally small.
- The schema addition is compatible with the current `initDb` flow for both fresh setup and existing databases.
- No extra behavior or columns were added beyond Task 1.

## Concerns

- The focused test covers the helper module directly, but there is no existing automated test harness here that exercises `initDb` end-to-end for both SQLite and PostgreSQL in this task scope.
