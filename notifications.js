const db = require('./db');

let _io = null;

function setIo(io) {
    _io = io;
}

async function createNotification(userId, academyId, type, title, message, link = null) {
    try {
        const nowSql = db.isPostgres ? 'NOW()' : "datetime('now')";
        const result = await db.query(
            `INSERT INTO notifications (user_id, academy_id, type, title, message, link, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, ${nowSql}) RETURNING *`,
            [userId, academyId, type, title, message, link]
        );
        const notification = result.rows[0];
        if (_io) _io.to(`user_${userId}`).emit('new_notification', notification);
        return notification;
    } catch (err) {
        console.error('[Notification] Error creating:', err.message);
    }
}

module.exports = { createNotification, setIo };
