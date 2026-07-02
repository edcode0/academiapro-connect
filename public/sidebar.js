// Single source of truth for the dashboard sidebar.
// Each page carries <div id="sidebar-mount" data-role="admin|teacher|student"></div>;
// this script fills it with the shared shell + role-specific nav and marks the
// active link from location.pathname. IDs (userName / teacher-name / sidebar-name
// and the code spans) are preserved so each page's existing fill logic still works.
(function () {
    const LOGOUT_SVG = '<svg viewBox="0 0 512 512"><path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1-128 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l128 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z"></path></svg>';

    const CHAT_LINK = '/chat', CHAT_BADGE = ' <span class="unread-badge-sidebar" id="global-unread"></span>';

    const ROLES = {
        admin: {
            userInfo:
                '<strong id="userName">Administrador</strong>' +
                '<span class="badge-admin">Admin</span>',
            nav: [
                { section: 'Gestión de Academia' },
                { href: '/', label: '🏠 Dashboard' },
                { href: '/students', label: '👥 Estudiantes' },
                { href: '/admin/teachers', label: '👨‍🏫 Profesores' },
                { href: '/payments', label: '💳 Pagos' },
                { href: CHAT_LINK, label: '💬 Chat', badge: true },
                { href: '/settings', label: '⚙️ Configuración' },
                { section: 'Mi actividad docente' },
                { href: '/teacher/dashboard', label: '👥 Mis Alumnos' },
                { href: '/teacher/sessions', label: '📅 Sesiones' },
                { href: '/teacher/exams', label: '📝 Exámenes' },
                { href: '/teacher/transcripts', label: '📝 Transcripciones' },
                { href: '/teacher/calendar', label: '🗓️ Calendario' },
                { href: '/ai-tutor', label: '🤖 Asistente IA' }
            ]
        },
        teacher: {
            userInfo:
                '<strong id="teacher-name" style="display:block;color:white;font-size:0.95rem;margin-bottom:0.4rem;">Cargando...</strong>' +
                '<span id="teacher-role-badge" class="badge-teacher">PROFESOR</span>' +
                '<div style="margin-top:0.5rem;font-size:0.8rem;color:#94a3b8;"><b id="teacher-code" style="color:white;">Código: ---</b></div>',
            nav: [
                { href: '/teacher/dashboard', label: '👥 Mis Alumnos' },
                { href: '/teacher/sessions', label: '📅 Sesiones' },
                { href: '/teacher/exams', label: '📝 Exámenes' },
                { href: '/teacher/transcripts', label: '📝 Transcripciones' },
                { href: '/teacher/calendar', label: '🗓️ Calendario' },
                { href: '/ai-tutor', label: '🤖 Asistente IA' },
                { href: CHAT_LINK, label: '💬 Chat', badge: true },
                { href: '/teacher/settings', label: '⚙️ Configuración' }
            ]
        },
        student: {
            userInfo:
                '<strong id="sidebar-name">Cargando...</strong>' +
                '<span class="badge-student">ALUMNO</span>' +
                '<div style="margin-top: 0.5rem; font-size: 0.8rem; color: #94a3b8;">Código: <b id="sidebar-code" style="color: white;">---</b></div>',
            nav: [
                { href: '/student-portal', label: '🏠 Mi Panel' },
                { href: '/student-portal/calendar', label: '📅 Mi Calendario' },
                { href: '/student-portal/exams', label: '📝 Mis Notas' },
                { href: '/student-portal/payments', label: '💳 Mis Pagos' },
                { href: '/exam-simulator', label: '📋 Simulacro' },
                { href: '/ai-tutor', label: '🤖 Tutor IA' },
                { href: CHAT_LINK, label: '💬 Chat' }
            ]
        }
    };

    function isActive(href) {
        const path = location.pathname.replace(/\/$/, '') || '/';
        const h = href.replace(/\/$/, '') || '/';
        return h === '/' ? path === '/' : (path === h || path.startsWith(h + '/'));
    }

    function render(role) {
        const cfg = ROLES[role] || ROLES.admin;
        const nav = cfg.nav.map(item => {
            if (item.section) return `<div class="nav-section-title">${item.section}</div>`;
            const active = isActive(item.href) ? ' class="active"' : '';
            const badge = item.badge ? CHAT_BADGE : '';
            return `<a href="${item.href}"${active}>${item.label}${badge}</a>`;
        }).join('\n');

        return `<aside>
            <h1>AcademiaPro</h1>
            <div class="user-info">${cfg.userInfo}</div>
            <nav id="mainNav">${nav}</nav>
            <div style="margin-top: auto;">
                <button class="Btn" onclick="window.location.href='/auth/logout'">
                    <div class="sign">${LOGOUT_SVG}</div>
                    <div class="text">Logout</div>
                </button>
            </div>
        </aside>`;
    }

    function mount() {
        const el = document.getElementById('sidebar-mount');
        if (!el) return;
        el.outerHTML = render(el.getAttribute('data-role') || 'admin');
    }

    // Mount synchronously if the placeholder is already parsed (script placed right
    // after it); otherwise wait for DOMContentLoaded. Running before the page's own
    // scripts matters — they populate #userName / nav right after.
    if (document.getElementById('sidebar-mount')) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();
