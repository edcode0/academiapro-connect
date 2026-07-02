'use strict';

const db = require('../db');

/**
 * Generate the current month's pending payment for every student in an academy
 * that has a monthly_fee > 0. Idempotent: skips a student if a payment with the
 * same amount and due_date already exists, so it's safe to run repeatedly.
 * Returns the number of payments created.
 */
async function generateMonthlyPayments(academyId, now = new Date()) {
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const lastDayOfMonth = new Date(year, month, 0).getDate();

    const result = await db.query('SELECT * FROM students WHERE academy_id = $1 AND monthly_fee > 0', [academyId]);
    const students = result.rows || [];

    let created = 0;
    for (const s of students) {
        const payDay = s.payment_day || 1;
        const validDay = Math.min(payDay, lastDayOfMonth);
        const dueDate = `${year}-${String(month).padStart(2, '0')}-${String(validDay).padStart(2, '0')}`;

        const existing = await db.query(
            'SELECT id FROM payments WHERE student_id = $1 AND amount = $2 AND due_date = $3',
            [s.id, s.monthly_fee, dueDate]
        );
        if (!(existing.rows || []).length) {
            await db.query(
                "INSERT INTO payments (student_id, amount, due_date, status) VALUES ($1, $2, $3, 'pendiente')",
                [s.id, s.monthly_fee, dueDate]
            );
            created++;
        }
    }
    return created;
}

module.exports = { generateMonthlyPayments };
