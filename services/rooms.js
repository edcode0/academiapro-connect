'use strict';

const db = require('../db');

const isPostgres = !!process.env.DATABASE_URL;

/**
 * Factory: returns room helpers bound to the given io instance.
 * Call once: const roomsService = require('./services/rooms')(io);
 */
module.exports = function makeRoomsService(io) {

    async function createDirectRoomIfNotExists(u1, u2, academyId) {
        const exists = await db.query(
            `SELECT r.id FROM rooms r
             JOIN room_members rm1 ON rm1.room_id = r.id AND rm1.user_id = $1
             JOIN room_members rm2 ON rm2.room_id = r.id AND rm2.user_id = $2
             WHERE r.type = 'direct' AND r.academy_id = $3`,
            [u1, u2, academyId]
        );
        if (!exists.rows || exists.rows.length === 0) {
            const usersRes = await db.query(
                'SELECT id, name FROM users WHERE id = ANY($1::int[])',
                [[u1, u2]]
            );
            const usersMap = {};
            (usersRes.rows || []).forEach(u => { usersMap[u.id] = u.name; });
            const roomName = `${usersMap[u1] || u1} - ${usersMap[u2] || u2}`;

            const nowExpr = isPostgres ? 'NOW()' : "datetime('now')";
            const nrId = await db.insertReturning(`INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'direct', $2, ${nowExpr})`, [academyId, roomName]);

            const insertMemberSql = isPostgres
                ? "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
                : "INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES ($1, $2)";

            await db.query(insertMemberSql, [nrId, u1]);
            await db.query(insertMemberSql, [nrId, u2]);
        }
    }

    async function ensureAcademyRooms(academyId) {
        // Ensure "👥 Profesores & Admin" group room exists
        const groupExists = await db.query(
            "SELECT id FROM rooms WHERE academy_id = $1 AND type = 'group' AND name = '👥 Profesores & Admin'",
            [academyId]
        );
        const groupRows = groupExists.rows || groupExists;
        let groupId;

        if (!groupRows || groupRows.length === 0) {
            const nowExpr = isPostgres ? 'NOW()' : "datetime('now')";
            groupId = await db.insertReturning(`INSERT INTO rooms (academy_id, type, name, created_at) VALUES ($1, 'group', '👥 Profesores & Admin', ${nowExpr})`, [academyId]);

            // Delete old "General Profesores" if it exists
            const oldGroup = await db.query("SELECT id FROM rooms WHERE academy_id = $1 AND type = 'group' AND name = 'General Profesores'", [academyId]);
            const oldRows  = oldGroup.rows || oldGroup;
            for (const row of oldRows) {
                await db.query("DELETE FROM room_members WHERE room_id = $1", [row.id]);
                await db.query("DELETE FROM rooms WHERE id = $1", [row.id]);
            }
        } else {
            groupId = groupRows[0].id;
        }

        // Add all teachers and admin to group
        const members = await db.query(
            "SELECT id FROM users WHERE academy_id = $1 AND role IN ('admin','teacher')",
            [academyId]
        );
        const insertMemberSql = isPostgres
            ? "INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
            : "INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES ($1, $2)";

        for (const m of (members.rows || [])) {
            try { await db.query(insertMemberSql, [groupId, m.id]); } catch (e) { /* ignore */ }
        }

        // Create direct rooms for each student with teacher and admin
        const studentUsers = await db.query(
            `SELECT u.id as user_id, s.id as student_id, s.assigned_teacher_id
             FROM users u
             LEFT JOIN students s ON s.academy_id = u.academy_id AND (s.user_id = u.id OR LOWER(s.name) = LOWER(u.name))
             WHERE u.academy_id = $1 AND u.role = 'student'`,
            [academyId]
        );

        const admin     = await db.query("SELECT id FROM users WHERE academy_id = $1 AND role = 'admin' LIMIT 1", [academyId]);
        const adminUser = admin.rows && admin.rows[0] ? admin.rows[0] : null;

        for (const student of (studentUsers.rows || [])) {
            const studentUserId = student.user_id;
            if (student.assigned_teacher_id) {
                await createDirectRoomIfNotExists(studentUserId, student.assigned_teacher_id, academyId);
            }
            if (adminUser) {
                await createDirectRoomIfNotExists(studentUserId, adminUser.id, academyId);
            }
        }

        // Create direct rooms for Admin <-> Teachers
        if (adminUser) {
            const teachers = await db.query("SELECT id FROM users WHERE academy_id = $1 AND role = 'teacher'", [academyId]);
            for (const teacher of (teachers.rows || [])) {
                if (teacher.id !== adminUser.id) {
                    await createDirectRoomIfNotExists(teacher.id, adminUser.id, academyId);
                }
            }
        }
    }

    async function ensureAllChatRooms() {
        if (global.roomsEnsured) return;
        global.roomsEnsured = true;
        try {
            const academies   = await db.query('SELECT id FROM academies');
            const academyRows = academies.rows || academies;
            for (const academy of academyRows) {
                await ensureAcademyRooms(academy.id);
            }
            console.log('✅ Chat rooms ensured for all academies');
        } catch (err) {
            console.error('ensureAllChatRooms error:', err);
        }
    }

    return { ensureAcademyRooms, createDirectRoomIfNotExists, ensureAllChatRooms };
};
