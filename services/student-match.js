'use strict';

// Disambiguates which student a transcript belongs to when several classes
// with different students fall inside the same booking-lookup window (see
// services/gmail.js) — normal for a teacher with back-to-back sessions.
// Signals used, in order of trust:
//   1. Exact AI-guessed name match among the real candidates in the window.
//   2. Time proximity: which candidate's class just finished relative to
//      when the email arrived (Gemini/Meet send shortly after a class ends,
//      not hours later) — only trusted when it's both close in absolute
//      terms and clearly closer than the next-best candidate.
//   3. A single candidate is trusted as-is, UNLESS the AI's guessed name
//      confidently points to a *different* real student — that contradiction
//      means something is off (wrong slot booked, wrong recording), so it's
//      safer to flag it than to guess.
// No unique winner at any step → the caller falls back to pending_match
// instead of picking blindly.

const TIME_TRUST_THRESHOLD_MS = 90 * 60 * 1000; // a class ending >90min before the email is not "just finished"
const TIME_TRUST_MARGIN_MS = 20 * 60 * 1000;    // best candidate must clear the runner-up by this much

function normalizedName(name) {
    return String(name || '').trim().toLowerCase();
}

function matchStudentByExactName(students, nameGuess) {
    const nameToMatch = normalizedName(nameGuess);
    if (nameToMatch.length < 2) return null;
    return students.find(s => normalizedName(s.name) === nameToMatch) || null;
}

// Treats a naive "YYYY-MM-DDTHH:MM[:SS]" local string as if it were UTC, so
// differencing two values produced the same way gives the real elapsed time
// regardless of which timezone the strings actually represent — the offset
// cancels out. Never compare the result against a real epoch value directly.
function naiveToArtificialMs(naiveStr) {
    if (!naiveStr) return null;
    const iso = naiveStr.length <= 16 ? `${naiveStr}:00Z` : `${naiveStr}Z`;
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? null : ms;
}

function pickByTimeProximity(candidates, emailArtificialMs) {
    if (emailArtificialMs == null) return null;
    const scored = candidates
        .map(c => {
            const endMs = naiveToArtificialMs(c.endDatetime || c.startDatetime);
            return endMs == null ? null : { studentId: c.studentId, gap: Math.abs(emailArtificialMs - endMs) };
        })
        .filter(Boolean)
        .sort((a, b) => a.gap - b.gap);

    if (!scored.length || scored[0].gap > TIME_TRUST_THRESHOLD_MS) return null;
    if (scored.length > 1 && (scored[1].gap - scored[0].gap) < TIME_TRUST_MARGIN_MS) return null; // near-tie, don't guess
    return scored[0].studentId;
}

// candidateSlots: [{ studentId, startDatetime, endDatetime }] — every booked
// slot for this teacher inside the lookup window, regardless of student.
function resolveTranscriptStudent({ candidateSlots = [], students = [], aiGuessedName = '', emailArrivalNaive = null }) {
    if (candidateSlots.length === 0) {
        return matchStudentByExactName(students, aiGuessedName);
    }

    const candidateIds = candidateSlots.map(c => c.studentId);

    if (candidateSlots.length === 1) {
        const onlyId = candidateIds[0];
        const guessed = matchStudentByExactName(students, aiGuessedName);
        // AI is confident about a name, it's a real student, but not this one — contradiction.
        if (guessed && guessed.id !== onlyId) return null;
        return students.find(s => s.id === onlyId) || null;
    }

    const nameToMatch = normalizedName(aiGuessedName);
    if (nameToMatch.length >= 2) {
        const nameHits = students.filter(s => candidateIds.includes(s.id) && normalizedName(s.name) === nameToMatch);
        if (nameHits.length === 1) return nameHits[0];
    }

    const emailArtificialMs = naiveToArtificialMs(emailArrivalNaive);
    const timeWinnerId = pickByTimeProximity(candidateSlots, emailArtificialMs);
    return timeWinnerId != null ? (students.find(s => s.id === timeWinnerId) || null) : null;
}

module.exports = { resolveTranscriptStudent };

if (require.main === module) {
    const assert = require('assert');
    const students = [
        { id: 1, name: 'Dani' },
        { id: 2, name: 'Martina' },
        { id: 3, name: 'Ana' }
    ];
    const slot = (studentId, endDatetime) => ({ studentId, startDatetime: endDatetime, endDatetime });

    // 1 candidate, no contradicting name → trusted as-is.
    assert.deepStrictEqual(
        resolveTranscriptStudent({ candidateSlots: [slot(2, '2026-09-16T17:00:00')], students, aiGuessedName: '' }),
        students[1]
    );

    // 1 candidate, but AI confidently names a DIFFERENT real student → contradiction, no guess.
    assert.strictEqual(
        resolveTranscriptStudent({ candidateSlots: [slot(1, '2026-09-16T16:00:00')], students, aiGuessedName: 'Martina' }),
        null
    );

    // Ambiguous window (Dani 16:00-17:00, Martina 17:00-18:00) → exact name breaks the tie.
    assert.deepStrictEqual(
        resolveTranscriptStudent({
            candidateSlots: [slot(1, '2026-09-16T17:00:00'), slot(2, '2026-09-16T18:00:00')],
            students,
            aiGuessedName: 'Martina'
        }),
        students[1]
    );

    // Ambiguous window, no usable name → time proximity: email arrives 10min after Martina's class.
    assert.deepStrictEqual(
        resolveTranscriptStudent({
            candidateSlots: [slot(1, '2026-09-16T16:00:00'), slot(2, '2026-09-16T17:00:00')],
            students,
            aiGuessedName: '',
            emailArrivalNaive: '2026-09-16T17:10:00'
        }),
        students[1]
    );

    // Ambiguous window, no name, both candidates too close together in time → don't guess.
    assert.strictEqual(
        resolveTranscriptStudent({
            candidateSlots: [slot(1, '2026-09-16T16:55:00'), slot(2, '2026-09-16T17:00:00')],
            students,
            aiGuessedName: '',
            emailArrivalNaive: '2026-09-16T17:10:00'
        }),
        null
    );

    // Ambiguous window, no name, best candidate too far in the past (>90min) → don't guess.
    assert.strictEqual(
        resolveTranscriptStudent({
            candidateSlots: [slot(1, '2026-09-16T14:00:00'), slot(2, '2026-09-16T14:30:00')],
            students,
            aiGuessedName: '',
            emailArrivalNaive: '2026-09-16T17:10:00'
        }),
        null
    );

    // No booked slot in window → fallback to exact name match across everyone.
    assert.deepStrictEqual(
        resolveTranscriptStudent({ candidateSlots: [], students, aiGuessedName: 'ana' }),
        students[2]
    );

    console.log('student-match.js: all assertions passed');
}
