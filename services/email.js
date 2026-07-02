'use strict';

const { Resend } = require('resend');
const fs         = require('fs');
const path       = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'email-templates');

function loadTemplate(name, vars) {
    let html = fs.readFileSync(path.join(TEMPLATES_DIR, `${name}.html`), 'utf8');
    for (const [key, value] of Object.entries(vars))
        html = html.replaceAll(`{{${key}}}`, value);
    return html;
}

async function sendWelcomeEmail(user, academyName) {
    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
            from:    'AcademiaPro <no-reply@academiapro.academy>',
            to:      user.email,
            subject: '¡Bienvenido a AcademiaPro! 🎓',
            html: loadTemplate('welcome', {
                USER_NAME:    user.name,
                ACADEMY_NAME: academyName || 'AcademiaPro',
                BASE_URL:     process.env.BASE_URL || 'https://academiapro.academy',
            }),
        });
        console.log('[Email] Welcome email sent to user id:', user.id);
    } catch (err) {
        console.error('[Email] Welcome email error:', err.message);
    }
}

async function sendJoinWelcomeEmail(user, academyName, role) {
    try {
        const resend        = new Resend(process.env.RESEND_API_KEY);
        const roleText      = role === 'teacher' ? 'profesor' : 'alumno';
        const dashboardPath = role === 'teacher' ? '/teacher' : '/student-portal';
        const baseUrl       = process.env.BASE_URL || 'https://academiapro.academy';
        await resend.emails.send({
            from:    'AcademiaPro <no-reply@academiapro.academy>',
            to:      user.email,
            subject: `✅ Te has unido a ${academyName} en AcademiaPro`,
            html: loadTemplate('join-welcome', {
                USER_NAME:    user.name,
                ACADEMY_NAME: academyName,
                ROLE_TEXT:    roleText,
                DASHBOARD_URL: `${baseUrl}${dashboardPath}`,
            }),
        });
        console.log('[Email] Join welcome email sent to user id:', user.id);
    } catch (err) {
        console.error('[Email] Join welcome email error:', err.message);
    }
}

module.exports = { sendWelcomeEmail, sendJoinWelcomeEmail };
