# Task 1 Report: Resolve Meet owner from class context

## What changed

- Added `resolveMeetTeacherContext()` in `routes/calendar.js` to resolve the real teacher from `slot_id`, `session_id`, or `student_id`.
- Updated `/api/calendar/meet` to use the resolved teacher's calendar tokens instead of `req.user.id`.
- Kept the existing `createCalendarEvent()`, `meet_link`, and `google_event_id` persistence flow unchanged.
- Added `tests/meet-owner-resolution.js` covering:
  - admin Meet creation uses the assigned class teacher
  - teacher fallback still works when no class teacher is resolved
  - admin without a resolvable teacher gets `400`
  - resolved teacher without Google Calendar gets `400`

## Verification

- `node tests/meet-owner-resolution.js` -> PASS
- `npm run test:smoke` -> PASS, `70/70` checks passed

## Notes

- No admin fallback was added.
- The fix is local to `routes/calendar.js` as requested.
