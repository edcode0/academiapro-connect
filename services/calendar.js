'use strict';

const { google } = require('googleapis');
const db = require('../db');

const encryptGoogleToken = db.encryptGoogleToken || (value => value);

function makeOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        (process.env.BASE_URL || '') + '/api/gmail/callback'
    );
}

async function resolveCalendarUserId(teacher, googleEventId) {
    if (Number.isSafeInteger(teacher?.id)) return teacher.id;
    if (!googleEventId) return null;
    const result = await db.query(
        'SELECT teacher_id FROM available_slots WHERE google_event_id=$1',
        [googleEventId]
    );
    const userIds = [...new Set((result.rows || []).map(row => row.teacher_id).filter(Boolean))];
    return userIds.length === 1 ? userIds[0] : null;
}

async function persistCalendarTokens(teacher, tokens) {
    const userId = await resolveCalendarUserId(teacher);
    if (!userId) {
        console.warn('[Calendar] Refreshed credentials could not be associated with a user');
        return;
    }
    await db.query(
        `UPDATE users SET calendar_access_token=COALESCE($1, calendar_access_token),
         calendar_refresh_token=COALESCE($2, calendar_refresh_token),
         calendar_token_expiry=COALESCE($3, calendar_token_expiry) WHERE id=$4`,
        [
            encryptGoogleToken(tokens.access_token),
            encryptGoogleToken(tokens.refresh_token),
            tokens.expiry_date,
            userId
        ]
    );
}

async function clearCalendarTokens(teacher, googleEventId) {
    const userId = typeof teacher === 'number'
        ? teacher
        : await resolveCalendarUserId(teacher, googleEventId);
    if (!userId) return false;
    await db.query(
        'UPDATE users SET calendar_access_token=NULL, calendar_refresh_token=NULL, calendar_token_expiry=NULL WHERE id=$1',
        [userId]
    );
    return true;
}

async function clearCalendarOnInvalidGrant(err, teacher, googleEventId) {
    if (!/invalid_grant/i.test(err?.message || '')) return false;
    try {
        return await clearCalendarTokens(teacher, googleEventId);
    } catch {
        console.error('[Calendar] Invalid credentials could not be cleared');
        return false;
    }
}

function makeCalendarOAuth2Client(teacher) {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        (process.env.BASE_URL || '') + '/api/calendar/callback'
    );
    auth.setCredentials({
        access_token: teacher.calendar_access_token,
        refresh_token: teacher.calendar_refresh_token,
        expiry_date: teacher.calendar_token_expiry
    });
    auth.on('tokens', async tokens => {
        await persistCalendarTokens(teacher, tokens)
            .catch(() => console.error('[Calendar] Refreshed credentials could not be persisted'));
    });
    return auth;
}

async function createCalendarEvent(teacher, slot) {
    try {
        if (!teacher.calendar_access_token) return null;
        const auth = makeCalendarOAuth2Client(teacher);
        const calendar = google.calendar({ version: 'v3', auth });
        const event = {
            summary:     `Clase - ${slot.student_name || 'Alumno'}`,
            description: 'Clase programada en AcademiaPro',
            start:       { dateTime: slot.start_datetime, timeZone: 'Europe/Madrid' },
            end:         { dateTime: slot.end_datetime,   timeZone: 'Europe/Madrid' },
            conferenceData: {
                createRequest: {
                    requestId:            `academiapro-${Date.now()}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            },
            attendees: slot.student_email ? [{ email: slot.student_email }] : []
        };
        const response = await calendar.events.insert({
            calendarId:            'primary',
            resource:              event,
            conferenceDataVersion: 1,
            sendUpdates:           'all'
        });
        const meetLink = response.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;
        console.log('[Calendar] Event created:', response.data.id, 'Meet:', meetLink);
        return { google_event_id: response.data.id, meet_link: meetLink || null };
    } catch (err) {
        const invalidGrant = await clearCalendarOnInvalidGrant(err, teacher);
        console.error(invalidGrant
            ? '[Calendar] Credentials revoked; local Calendar connection cleared'
            : '[Calendar] Event creation failed');
        return null;
    }
}

async function deleteCalendarEvent(teacher, googleEventId) {
    let scopedTeacher = teacher;
    try {
        if (!teacher.calendar_access_token || !googleEventId) return;
        const userId = await resolveCalendarUserId(teacher, googleEventId);
        if (userId) scopedTeacher = { ...teacher, id: userId };
        const auth = makeCalendarOAuth2Client(scopedTeacher);
        const calendar = google.calendar({ version: 'v3', auth });
        await calendar.events.delete({ calendarId: 'primary', eventId: googleEventId });
        console.log('[Calendar] Event deleted:', googleEventId);
    } catch (err) {
        const invalidGrant = await clearCalendarOnInvalidGrant(err, scopedTeacher, googleEventId);
        console.error(invalidGrant
            ? '[Calendar] Credentials revoked; local Calendar connection cleared'
            : '[Calendar] Event deletion failed');
    }
}

module.exports = {
    makeOAuth2Client,
    makeCalendarOAuth2Client,
    clearCalendarTokens,
    clearCalendarOnInvalidGrant,
    createCalendarEvent,
    deleteCalendarEvent
};
