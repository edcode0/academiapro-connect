'use strict';

const express = require('express');
const db      = require('../db');
const { authenticateJWT } = require('../middleware/auth');
const { requireAdmin }    = require('../middleware/roles');
const { upload, chatUpload } = require('../utils/multer');

const isPostgres = db.isPostgres;

module.exports = function makeChatRouter(io) {
    const router = express.Router();
    const { ensureAcademyRooms } = require('../services/rooms')(io);

    router.post('/api/chat/ensure-rooms', authenticateJWT, async (req, res, next) => {
        try {
            await ensureAcademyRooms(req.user.academy_id);
            res.json({ success: true });
        } catch (e) {
            next(e);
        }
    });

    router.get('/api/chat/debug-rooms', authenticateJWT, requireAdmin, async (req, res, next) => {
        try {
            let sql = `
                SELECT r.id, r.type, r.name,
                       (SELECT GROUP_CONCAT(u.name, ', ') FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = r.id) as members
                FROM rooms r
                WHERE r.academy_id = $1
            `;
            if (isPostgres) {
                sql = `
                    SELECT r.id, r.type, r.name,
                           (SELECT STRING_AGG(u.name, ', ') FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = r.id) as members
                    FROM rooms r
                    WHERE r.academy_id = $1
                `;
            }
            let result = await db.query(sql, [req.user.academy_id]);
            res.json(result.rows || []);
        } catch (e) {
            next(e);
        }
    });

    // Chat API - New Rooms Logic
    router.get('/api/chat/rooms', authenticateJWT, (req, res, next) => {
        const sql = `
            SELECT r.id, r.type, r.academy_id,
                CASE WHEN r.type = 'group' THEN r.name
                     ELSE (SELECT u.name FROM users u
                           JOIN room_members rm_sub ON rm_sub.user_id = u.id
                           WHERE rm_sub.room_id = r.id AND u.id != $1
                           LIMIT 1)
                END as name,
                CASE WHEN r.type = 'direct' THEN
                     (SELECT u.role FROM users u
                      JOIN room_members rm_sub ON rm_sub.user_id = u.id
                      WHERE rm_sub.room_id = r.id AND u.id != $1
                      LIMIT 1)
                END as other_role,
                (SELECT CASE
                    WHEN type = 'html_card' OR content LIKE '<div%' THEN '📚 Resumen de clase'
                    WHEN content = '' OR content IS NULL THEN '📎 Archivo adjunto'
                    ELSE content
                END FROM messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT created_at FROM messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message_date,
                (SELECT COUNT(*) FROM messages WHERE room_id = r.id AND read = FALSE AND sender_id != $1) as unread_count,
                r.created_at
            FROM rooms r
            JOIN room_members rm ON r.id = rm.room_id
            WHERE rm.user_id = $2 AND r.academy_id = $3
            ORDER BY last_message_date DESC
        `;
        db.query(sql, [req.user.id, req.user.id, req.user.academy_id], (err, result) => {
            if (err) return next(err);

            const rows = result.rows || result;
            const mapped = [];
            const seenNames = new Set();

            for (const r of rows) {
                if (r.type === 'group') {
                    if (seenNames.has(r.name)) continue;
                    seenNames.add(r.name);
                }
                if (!mapped.find(x => x.id === r.id)) mapped.push(r);
            }

            res.json(mapped);
        });
    });

    // Admin backwards compatibility alias
    router.get('/api/chat/conversations', authenticateJWT, (req, res, next) => {
        res.redirect('/api/chat/rooms');
    });

    // Removed legacy POST /api/chat/messages: no membership check (could post to any room)
    // and unused by the frontend, which sends via socket or /api/chat/rooms/:roomId/messages.

    router.post('/api/chat/rooms/:roomId/messages', authenticateJWT, async (req, res, next) => {
        try {
            const { content, file_url, file_name, file_type } = req.body;
            const roomId = parseInt(req.params.roomId);
            if ((!content && !file_url) || !roomId) {
                return res.status(400).json({ error: 'content or file_url and roomId required' });
            }
            const memberCheck = await db.query(
                'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
                [roomId, req.user.id]
            );
            if (!memberCheck.rows.length) {
                return res.status(403).json({ error: 'Not a member of this room' });
            }
            const result = await db.query(
                `INSERT INTO messages (room_id, sender_id, academy_id, content, file_url, file_name, file_type, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, ${isPostgres ? 'NOW()' : "datetime('now')"}) RETURNING *`,
                [roomId, req.user.id, req.user.academy_id, content || '', file_url || null, file_name || null, file_type || null]
            );
            const message = result.rows[0];
            if (io) {
                io.to(`room_${roomId}`).emit('new_message', {
                    ...message,
                    sender_name: req.user.name,
                    sender_role: req.user.role
                });
            }
            res.json(message);
        } catch (err) {
            console.error('Send message error:', err.message);
            next(err);
        }
    });

    router.get('/api/chat/rooms/:roomId/messages', authenticateJWT, async (req, res, next) => {
        try {
            const roomId = parseInt(req.params.roomId);
            const userId = req.user.id || req.user.userId;

            console.log('Loading messages for room:', roomId, 'user:', userId);

            const membership = await db.query(
                'SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2',
                [roomId, userId]
            );
            const mRows = membership.rows || membership;
            if (!mRows || mRows.length === 0) {
                return res.status(403).json({ error: 'No tienes acceso a esta sala' });
            }

            const sql = isPostgres
                ? `SELECT m.id, m.room_id, m.sender_id, m.content,
                  m.file_url, m.file_name, m.created_at, m.read, m.type,
                  u.name as sender_name
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.room_id = $1
           ORDER BY m.created_at ASC
           LIMIT 100`
                : `SELECT m.id, m.room_id, m.sender_id, m.content,
                  m.file_url, m.file_name, m.created_at, m.read, m.type,
                  u.name as sender_name
           FROM messages m
           LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.room_id = $1
           ORDER BY m.created_at ASC
           LIMIT 100`;

            const messages = await db.query(sql, [roomId]);
            const msgRows = messages.rows || messages;
            console.log('Found', msgRows.length, 'messages for room', roomId);
            res.json(msgRows || []);
        } catch (err) {
            console.error('get messages error:', err);
            next(err);
        }
    });

    router.get('/api/chat/contacts', authenticateJWT, requireAdmin, async (req, res, next) => {
        try {
            const result = await db.query(
                'SELECT id, name, role FROM users WHERE academy_id = $1 AND id != $2 ORDER BY role, name',
                [req.user.academy_id, req.user.id]
            );
            res.json(result.rows || []);
        } catch (err) {
            next(err);
        }
    });

    router.post('/api/chat/upload', authenticateJWT, upload.single('file'), (req, res, next) => {
        if (!req.file) return res.status(400).json({ error: 'No hay archivo' });
        const fileUrl = `/uploads/chat/${req.file.filename}`;
        res.json({ url: fileUrl, name: req.file.originalname });
    });

    router.post('/api/chat/mark-read/:roomId', authenticateJWT, async (req, res, next) => {
        try {
            const roomId = parseInt(req.params.roomId);
            const memberCheck = await db.query(
                'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
                [roomId, req.user.id]
            );
            if (!memberCheck.rows.length) return res.status(403).json({ error: 'Not a member of this room' });
            await db.query(
                'UPDATE messages SET read = TRUE WHERE room_id = $1 AND sender_id != $2 AND academy_id = $3',
                [roomId, req.user.id, req.user.academy_id]
            );
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.get('/api/chat/unread-count', authenticateJWT, (req, res, next) => {
        const sql = `
            SELECT COUNT(*) as count FROM messages m
            JOIN room_members rm ON m.room_id = rm.room_id
            WHERE rm.user_id = $1 AND m.sender_id != $2 AND m.read = FALSE AND m.academy_id = $3
        `;
        db.query(sql, [req.user.id, req.user.id, req.user.academy_id], (err, result) => {
            if (err) return next(err);
            res.json({ count: result?.rows[0]?.count || 0 });
        });
    });

    router.post('/api/chat/upload-file', authenticateJWT, (req, res, next) => {
        chatUpload(req, res, (err) => {
            if (err) return res.status(400).json({ error: err.message });
            if (!req.file) return res.status(400).json({ error: 'No file received' });
            res.json({
                file_url: '/uploads/chat/' + req.file.filename,
                file_name: req.file.originalname,
                file_type: req.file.mimetype
            });
        });
    });

    return router;
};
