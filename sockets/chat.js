'use strict';

const db = require('../db');
const { createNotification } = require('../notifications');

module.exports = function initChatSocket(io) {
    io.on('error', (err) => console.error('Socket error:', err));

    io.on('connection', (socket) => {
        console.log('Socket connected:', socket.id);

        const user = socket.user;
        if (!user) {
            console.log('No user on socket, disconnecting');
            socket.disconnect();
            return;
        }

        console.log('Socket authenticated, userId:', user.id, 'role:', user.role);

        socket.join(`academy_${user.academy_id}`);
        socket.join(`user_${user.id}`);

        // Tenant-scoped membership check: ensures user is in room_members AND room belongs to their academy
        const isRoomMember = async (roomId) => {
            if (roomId == null || !Number.isFinite(+roomId)) return false;
            const result = await db.query(
                `SELECT 1 FROM room_members rm
                 JOIN rooms r ON r.id = rm.room_id
                 WHERE rm.room_id = $1 AND rm.user_id = $2 AND r.academy_id = $3`,
                [+roomId, user.id, user.academy_id]
            );
            return (result.rows || []).length > 0;
        };

        socket.on('join_rooms', async (roomIds) => {
            if (!Array.isArray(roomIds)) return;
            const allowed = [];
            for (const roomId of roomIds) {
                if (await isRoomMember(roomId)) {
                    socket.join(`room_${roomId}`);
                    allowed.push(roomId);
                }
            }
            console.log('User', user.id, 'joined rooms:', allowed);
        });

        socket.on('join_room', async (roomId) => {
            if (await isRoomMember(roomId)) {
                socket.join(`room_${roomId}`);
            } else {
                socket.emit('error', { message: 'Not a member of this room' });
            }
        });

        socket.on('sendMessage', async ({ roomId, content, tempId }) => {
            console.log('sendMessage from', user.id, 'to room', roomId, ':', content);
            try {
                if (!roomId || !content?.trim()) return;

                if (!(await isRoomMember(roomId))) {
                    console.log('User', user.id, 'not member of room', roomId);
                    socket.emit('error', { message: 'Not a member of this room' });
                    return;
                }

                const nowSql = db.isPostgres ? 'NOW()' : "datetime('now')";
                const result = await db.query(
                    `INSERT INTO messages (room_id, sender_id, academy_id, content, created_at)
                     VALUES ($1, $2, $3, $4, ${nowSql}) RETURNING *`,
                    [roomId, user.id, user.academy_id, content.trim()]
                );
                const message = result.rows[0];
                console.log('Message saved to DB, id:', message.id);

                io.to(`room_${roomId}`).emit('new_message', {
                    ...message,
                    sender_name: user.name,
                    sender_role: user.role,
                    sender_id: user.id,
                    tempId: tempId || null
                });

                const membersRes = await db.query(
                    'SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2',
                    [roomId, user.id]
                );
                const preview = content.trim().length > 60 ? content.trim().slice(0, 60) + '…' : content.trim();
                for (const m of membersRes.rows) {
                    createNotification(m.user_id, user.academy_id, 'message',
                        `💬 Nuevo mensaje de ${user.name}`,
                        preview,
                        `/chat?room=${roomId}`
                    );
                }
            } catch (err) {
                console.error('sendMessage error:', err.message);
                socket.emit('error', { message: 'Error sending message' });
            }
        });

        socket.on('typing', async ({ roomId }) => {
            if (!(await isRoomMember(roomId))) return;
            socket.to(`room_${roomId}`).emit('typing', {
                userId: user.id,
                userName: user.name
            });
        });

        socket.on('disconnect', () => {
            console.log('Socket disconnected:', user.id);
        });
    });
};
