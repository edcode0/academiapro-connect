# Meet Owner Resolution Design

Date: 2026-06-27
Repo: `AcademiaPro`
Status: approved in chat, pending final user review of this file

## Goal

Fix the current Google Meet ownership bug so that a teacher or admin entering an existing Meet link no longer depends on the AcademiaPro user who clicked "create Meet". The Meet must be created with the Google Calendar account of the teacher who owns the class.

## Problem

Today `/api/calendar/meet` uses `req.user.id` to load Google Calendar tokens and create the event. That means:

- if an admin creates a Meet for a teacher's class, Google sees the admin's Google account as the organizer;
- Meet host controls then belong to that Google organizer context, not to the teacher assigned to the class;
- the internal AcademiaPro role (`teacher` or `admin`) does not affect Google Meet host permissions.

## Decision

Resolve the real teacher for the class before creating the Meet, and always use that teacher's Google Calendar tokens.

Resolved teacher selection order:

1. If `slot_id` is present, use `available_slots.teacher_id`.
2. Else if `session_id` is present, use the linked slot's `teacher_id`.
3. Else if `session_id` is present but the session has no slot, use the session student's `assigned_teacher_id`.
4. Else if `student_id` is present, use `students.assigned_teacher_id`.
5. Else if the requester is a `teacher`, use `req.user.id`.
6. Else fail with a clear validation error.

## Non-Goals

- No automatic fallback to the admin's Google account.
- No Meet co-host automation through Google Meet API.
- No schema changes.
- No login persistence changes in this task. The JWT cookie duration change is a separate follow-up.

## Backend Changes

Touch the smallest possible surface:

- `routes/calendar.js`
  - add a small helper that resolves the effective teacher for Meet creation from `slot_id`, `session_id`, `student_id`, and requester role;
  - update `/api/calendar/meet` to load tokens from the resolved teacher instead of `req.user.id`;
  - preserve existing `meet_link` and `google_event_id` persistence behavior.

- optional small helper placement:
  - keep it inside `routes/calendar.js` unless reuse appears immediately necessary.

## Validation Rules

- If no teacher can be resolved:
  - return `400` with a clear error telling the user to assign a teacher first.

- If the resolved teacher exists but has no connected Google Calendar:
  - return `400` with a clear error telling the user that the assigned teacher must connect Google Calendar.

- If Google event creation fails:
  - keep the current generic failure path, without exposing raw provider errors to the client.

## Frontend Impact

No workflow redesign.

Existing pages already surface backend errors from `/api/calendar/meet`. Only minimal message cleanup is acceptable if needed so the user understands why Meet creation was blocked.

## Testing

Keep verification lightweight and direct:

1. Teacher with connected Google Calendar creates a Meet for their own class.
2. Admin creates a Meet for a class assigned to a teacher with connected Google Calendar.
3. Admin attempts to create a Meet for a class whose assigned teacher has no Calendar connection.
4. Admin attempts to create a Meet where no teacher can be resolved.

Expected result:

- cases 1 and 2 succeed and use the teacher-owned Google account;
- cases 3 and 4 fail with clear `400` errors;
- no fallback silently creates the Meet under the wrong Google account.

## Risks

- Some existing sessions may not have enough data to resolve a teacher if they were created without a slot and without `assigned_teacher_id` on the student. Those should fail explicitly instead of producing a wrong owner.
- Google Meet host/co-host behavior still depends on Google account capabilities. This change fixes organizer ownership, which is the stable part we control from the current Calendar-based integration.

## Follow-Up

Separate task after this one:

- extend auth cookie/JWT persistence from `7d` to about `15d`, likely without introducing refresh-token infrastructure unless a later requirement proves it necessary.
