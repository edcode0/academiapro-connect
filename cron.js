const db = require('./db');
const { createNotification } = require('./notifications');
const { generateRecurringSlots } = require('./services/recurring');
const { generateMonthlyPayments } = require('./services/billing');
const { checkInactivityRisk } = require('./services/risk');

function runDailyJobs() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const isFirstOfMonth = now.getDate() === 1;

    // Daily: flag students who stopped attending as at_risk
    checkInactivityRisk(now)
        .then(n => n && console.log(`[Risk] Inactivity sweep flagged ${n} student(s)`))
        .catch(e => console.error('[Risk] Inactivity sweep error:', e.message));

    // Monthly (1st): auto-generate each academy's pending payments
    if (isFirstOfMonth) {
        db.query('SELECT id FROM academies', [], async (err, acadRes) => {
            if (err || !acadRes?.rows) return;
            let total = 0;
            for (const a of acadRes.rows) {
                try { total += await generateMonthlyPayments(a.id, now); }
                catch (e) { console.error('[Billing] Auto-generate error for academy', a.id, ':', e.message); }
            }
            console.log(`[Billing] Monthly auto-generate: ${total} payment(s) created`);
        });
    }

    // 1. PAYMENT REMINDERS & OVERDUE NOTIFICATIONS
    db.query(`SELECT p.id, p.amount, p.due_date, st.name as student_name, st.academy_id, st.parent_email,
                     u_admin.id as admin_id, a.name as academy_name
              FROM payments p
              JOIN students st ON p.student_id = st.id
              JOIN academies a ON st.academy_id = a.id
              LEFT JOIN users u_admin ON u_admin.academy_id = st.academy_id AND u_admin.role = 'admin'
              WHERE p.status = 'pendiente' AND p.due_date < $1`, [today], (err, pRes) => {
        if (!err && pRes && pRes.rows) {
            pRes.rows.forEach(p => {
                // In-app notification for admin (deduplicate: only if no notification in last 24h for this payment)
                if (p.admin_id) {
                    db.query(
                        `SELECT 1 FROM notifications WHERE user_id=$1 AND type='payment_overdue' AND link=$2
                         AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
                        [p.admin_id, `/payments?id=${p.id}`],
                        (e, r) => {
                            if (!e && !r?.rows?.length) {
                                createNotification(p.admin_id, p.academy_id, 'payment_overdue',
                                    `💳 Pago vencido: ${p.student_name}`,
                                    `${p.amount}€ pendiente desde ${p.due_date}`,
                                    `/payments?id=${p.id}`
                                );
                            }
                        }
                    );
                }
                // Email to parent
                if (p.parent_email && process.env.RESEND_API_KEY) {
                    fetch('https://api.resend.com/emails', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            from: 'AcademiaPro <no-reply@academiapro.academy>',
                            to: p.parent_email,
                            subject: `Aviso: Pago vencido de ${p.student_name}`,
                            html: `<p>Hola, le informamos que el pago correspondiente a ${p.amount}€ en la academia ${p.academy_name} se encuentra vencido desde ${p.due_date}. Por favor, póngase al corriente.</p>`
                        })
                    }).catch(e => console.error(e));
                }
            });
        }
    });

    // 3. RECURRING SESSIONS — maintain 8-week rolling horizon
    db.query('SELECT * FROM recurring_sessions WHERE active = TRUE', [], async (err, rRes) => {
        if (err || !rRes?.rows?.length) return;
        for (const rule of rRes.rows) {
            try {
                await generateRecurringSlots(rule, 8);
            } catch (e) {
                console.error('[Recurring] Cron error for rule', rule.id, ':', e.message);
            }
        }
        console.log(`[Recurring] Cron: processed ${rRes.rows.length} rule(s)`);
    });

    // 2. TEACHER REPORT NOTIFICATION TO ADMIN ON 1ST OF MONTH
    if (isFirstOfMonth) {
        db.query('SELECT id, owner_id, name FROM academies', (err, acads) => {
            if (err || !acads || !acads.rows) return;
            acads.rows.forEach(async (acad) => {
                const month = now.getMonth() === 0 ? 12 : now.getMonth();
                const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

                // Dedup key: this cron can fire more than once per day-1 (a redeploy
                // re-triggers the 10s-after-boot run in initCrons) — without this, every
                // redeploy landing on the 1st resends the same summary email.
                const dedupLink = `/payments?monthlySummary=${acad.id}-${month}-${year}`;
                try {
                    db.query(
                        `SELECT 1 FROM notifications WHERE user_id=$1 AND type='monthly_teacher_summary' AND link=$2 LIMIT 1`,
                        [acad.owner_id, dedupLink],
                        (dedupErr, dedupRes) => {
                            if (dedupErr || dedupRes?.rows?.length) return; // already sent, or can't tell — don't risk a dupe

                            db.query('SELECT email FROM users WHERE id = $1', [acad.owner_id], async (eErr, userRes) => {
                                const adminEmail = userRes?.rows[0]?.email;
                                if (!adminEmail || !process.env.RESEND_API_KEY) return;

                                db.query(`SELECT p.*, u.name as teacher_name
                                          FROM teacher_payments p
                                          JOIN users u ON p.teacher_id = u.id
                                          WHERE u.academy_id = $1 AND month = $2 AND year = $3`, [acad.id, month, year], (err, r) => {
                                    if (!err && r && r.rows && r.rows.length > 0) {
                                        let tableHtml = '<table border="1" cellpadding="5" cellspacing="0" style="width:100%; border-collapse:collapse; text-align:left;">';
                                        tableHtml += '<tr style="background:#f1f5f9;"><th>Profesor</th><th>Horas</th><th>Tarifa</th><th>Total</th></tr>';
                                        let grandTotal = 0;
                                        r.rows.forEach(t => {
                                            tableHtml += `<tr><td>${t.teacher_name}</td><td>${t.hours.toFixed(1)}h</td><td>${t.hourly_rate}€/h</td><td>${t.total_amount}€</td></tr>`;
                                            grandTotal += t.total_amount;
                                        });
                                        tableHtml += `<tr><td colspan="3" align="right"><strong>Total:</strong></td><td><strong>${grandTotal}€</strong></td></tr></table>`;

                                        fetch('https://api.resend.com/emails', {
                                            method: 'POST',
                                            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                from: 'AcademiaPro <no-reply@academiapro.academy>',
                                                to: adminEmail,
                                                subject: `Resumen mensual de profesores - ${acad.name} - ${month}/${year}`,
                                                html: `<h2>Resumen mensual</h2>${tableHtml}`
                                            })
                                        }).catch(e => console.error(e));

                                        createNotification(acad.owner_id, acad.id, 'monthly_teacher_summary',
                                            '📊 Resumen mensual de profesores enviado',
                                            `Se ha enviado a ${adminEmail} el resumen de ${month}/${year}.`,
                                            dedupLink
                                        );
                                    }
                                });
                            });
                        }
                    );
                } catch (e) { }
            });
        });
    }
}

function initCrons() {
    if (global.cronsInitialized) return;
    global.cronsInitialized = true;

    if (global.dailyJobsTimeout) clearTimeout(global.dailyJobsTimeout);
    global.dailyJobsTimeout = setTimeout(runDailyJobs, 10000);

    if (global.dailyJobsInterval) clearInterval(global.dailyJobsInterval);
    global.dailyJobsInterval = setInterval(runDailyJobs, 1000 * 60 * 60 * 24);

    console.log('Crons initialized globally');
}

module.exports = initCrons;
