// Single source of truth for the dashboard sidebar.
// Each page carries <div id="sidebar-mount" data-role="admin|teacher|student"></div>;
// this script fills it with the shared shell + role-specific nav and marks the
// active link from location.pathname. IDs (userName / teacher-name / sidebar-name
// and the code spans) are preserved so each page's existing fill logic still works.
(function () {
    const ICON_PATHS = {
        home: '<path d="M3 9.5 12 3l9 6.5"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M9.5 20v-6h5v6"/>',
        users: '<path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/><circle cx="10" cy="8" r="3.2"/><path d="M19.5 19v-1.5a3.5 3.5 0 0 0-2.6-3.38"/><path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6"/>',
        building: '<path d="M4 21V6.2l8-3 8 3V21"/><path d="M9 21v-4.5h6V21"/><path d="M8.5 9h.01"/><path d="M15.5 9h.01"/><path d="M8.5 12.5h.01"/><path d="M15.5 12.5h.01"/>',
        bell: '<path d="M18 9a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15 18 9Z"/><path d="M13.8 20a2 2 0 0 1-3.6 0"/>',
        plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
        dots: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
        check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
        cap: '<path d="M3 9.2 12 5l9 4.2-9 4.2-9-4.2Z"/><path d="M6.5 11v4c0 1.3 2.5 2.6 5.5 2.6s5.5-1.3 5.5-2.6v-4"/><path d="M21 9.2v4.6"/>',
        card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 9.5h18"/><path d="M6.5 14.5h3"/>',
        chat: '<path d="M20 14.5a2 2 0 0 1-2 2H8l-4 3.5V6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/><path d="M8.5 9.5h7"/><path d="M8.5 12.5h4"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M12.2 2.5h-.4a1.8 1.8 0 0 0-1.8 1.8v.16a1.8 1.8 0 0 1-.9 1.56l-.4.23a1.8 1.8 0 0 1-1.8 0l-.13-.08a1.8 1.8 0 0 0-2.46.66l-.2.34a1.8 1.8 0 0 0 .66 2.46l.13.08a1.8 1.8 0 0 1 .9 1.56v.46a1.8 1.8 0 0 1-.9 1.57l-.13.08a1.8 1.8 0 0 0-.66 2.46l.2.34a1.8 1.8 0 0 0 2.46.66l.13-.08a1.8 1.8 0 0 1 1.8 0l.4.23a1.8 1.8 0 0 1 .9 1.56v.16a1.8 1.8 0 0 0 1.8 1.8h.4a1.8 1.8 0 0 0 1.8-1.8v-.16a1.8 1.8 0 0 1 .9-1.56l.4-.23a1.8 1.8 0 0 1 1.8 0l.13.08a1.8 1.8 0 0 0 2.46-.66l.2-.35a1.8 1.8 0 0 0-.66-2.45l-.13-.08a1.8 1.8 0 0 1-.9-1.57v-.46a1.8 1.8 0 0 1 .9-1.56l.13-.08a1.8 1.8 0 0 0 .66-2.46l-.2-.34a1.8 1.8 0 0 0-2.46-.66l-.13.08a1.8 1.8 0 0 1-1.8 0l-.4-.23a1.8 1.8 0 0 1-.9-1.56v-.16a1.8 1.8 0 0 0-1.8-1.8h-.4Z"/>',
        userCheck: '<path d="M14.5 19v-1.5a3.5 3.5 0 0 0-3.5-3.5H6a3.5 3.5 0 0 0-3.5 3.5V19"/><circle cx="8.5" cy="8" r="3.2"/><path d="m16 12 1.8 1.8L21.5 10"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
        clipboard: '<rect x="8" y="3" width="8" height="3.6" rx="1.2"/><path d="M16 4.8h2a2 2 0 0 1 2 2v12.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.8a2 2 0 0 1 2-2h2"/><path d="m8.8 14 1.8 1.8 3.6-3.6"/>',
        fileText: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8.5 13h7"/><path d="M8.5 16.5h7"/><path d="M8.5 9.5h2"/>',
        calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>',
        sparkles: '<path d="M12 3.5 13.6 8.4 18.5 10 13.6 11.6 12 16.5 10.4 11.6 5.5 10 10.4 8.4Z"/><path d="M18.5 16.5l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6Z"/>',
        chart: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.2" height="6.5" rx="1.1"/><rect x="10.4" y="6.5" width="3.2" height="11" rx="1.1"/><rect x="15.8" y="13.5" width="3.2" height="4" rx="1.1"/>',
        chevron: '<path d="m9 6 6 6-6 6"/>',
        logout: '<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="m15.5 16 4-4-4-4"/><path d="M19.5 12H9"/>'
    };

    const CHAT_LINK = '/chat';
    const CHAT_BADGE = '<span class="unread-badge-sidebar" id="global-unread"></span>';

    function iconSvg(name, size = 19) {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`;
    }

    function setSidebarCollapsed(collapsed) {
        if (!document.body) return;
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        const toggle = document.querySelector('.sidebar-collapse-toggle');
        if (toggle) {
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.setAttribute('aria-label', collapsed ? 'Expandir barra lateral' : 'Minimizar barra lateral');
            toggle.title = collapsed ? 'Expandir barra lateral' : 'Minimizar barra lateral';
        }
    }

    function applyStoredCollapseState() {
        try {
            setSidebarCollapsed(window.localStorage.getItem('sidebarCollapsed') === 'true');
        } catch (e) { /* ignore unavailable storage */ }
    }

    function toggleSidebarCollapse() {
        if (window.innerWidth && window.innerWidth <= 1024) return;
        const collapsed = !document.body.classList.contains('sidebar-collapsed');
        try { window.localStorage.setItem('sidebarCollapsed', String(collapsed)); } catch (e) { /* ignore unavailable storage */ }
        setSidebarCollapsed(collapsed);
    }

    applyStoredCollapseState();

    const ROLES = {
        admin: {
            userInfo:
                '<div class="sidebar-profile-text"><strong id="userName">Administrador</strong>' +
                '<span class="badge-admin">Admin</span></div>',
            nav: [
                { section: 'Gestión de Academia' },
                { href: '/', label: 'Dashboard', icon: 'home' },
                { href: '/students', label: 'Estudiantes', icon: 'users' },
                { href: '/admin/teachers', label: 'Profesores', icon: 'cap' },
                { href: '/payments', label: 'Pagos', icon: 'card' },
                { href: CHAT_LINK, label: 'Chat', icon: 'chat', badge: true },
                { href: '/settings', label: 'Configuración', icon: 'settings' },
                { section: 'Mi actividad docente' },
                { href: '/teacher/dashboard', label: 'Mis Alumnos', icon: 'userCheck' },
                { href: '/teacher/sessions', label: 'Sesiones', icon: 'clock' },
                { href: '/teacher/exams', label: 'Exámenes', icon: 'clipboard' },
                { href: '/teacher/transcripts', label: 'Transcripciones', icon: 'fileText' },
                { href: '/teacher/calendar', label: 'Calendario', icon: 'calendar' },
                { href: '/ai-tutor', label: 'Asistente IA', icon: 'sparkles' }
            ]
        },
        teacher: {
            userInfo:
                '<div class="sidebar-profile-text"><strong id="teacher-name">Cargando...</strong>' +
                '<span id="teacher-role-badge" class="badge-teacher">PROFESOR</span>' +
                '<div class="sidebar-user-code">Código: <b id="teacher-code">---</b></div></div>',
            nav: [
                { href: '/teacher/dashboard', label: 'Mis Alumnos', icon: 'userCheck' },
                { href: '/teacher/sessions', label: 'Sesiones', icon: 'clock' },
                { href: '/teacher/exams', label: 'Exámenes', icon: 'clipboard' },
                { href: '/teacher/transcripts', label: 'Transcripciones', icon: 'fileText' },
                { href: '/teacher/calendar', label: 'Calendario', icon: 'calendar' },
                { href: '/ai-tutor', label: 'Asistente IA', icon: 'sparkles' },
                { href: CHAT_LINK, label: 'Chat', icon: 'chat', badge: true },
                { href: '/teacher/settings', label: 'Configuración', icon: 'settings' }
            ]
        },
        student: {
            userInfo:
                '<div class="sidebar-profile-text"><strong id="sidebar-name">Cargando...</strong>' +
                '<span class="badge-student">ALUMNO</span>' +
                '<div class="sidebar-user-code">Código: <b id="sidebar-code">---</b></div></div>',
            nav: [
                { href: '/student-portal', label: 'Mi Panel', icon: 'home' },
                { href: '/student-portal/calendar', label: 'Mi Calendario', icon: 'calendar' },
                { href: '/student-portal/exams', label: 'Mis Notas', icon: 'clipboard' },
                { href: '/student-portal/payments', label: 'Mis Pagos', icon: 'card' },
                { href: '/exam-simulator', label: 'Simulacro', icon: 'chart' },
                { href: '/ai-tutor', label: 'Tutor IA', icon: 'sparkles' },
                { href: CHAT_LINK, label: 'Chat', icon: 'chat', badge: true }
            ]
        }
    };

    function isActive(href) {
        const path = location.pathname.replace(/\/$/, '') || '/';
        const h = href.replace(/\/$/, '') || '/';
        return h === '/' ? path === '/' : (path === h || path.startsWith(h + '/'));
    }

    function renderSidebarNavHTML(role) {
        const cfg = ROLES[role] || ROLES.admin;
        return cfg.nav.map(item => {
            if (item.section) return `<div class="nav-section-title">${item.section}</div>`;
            const active = isActive(item.href) ? ' class="active"' : '';
            const badge = item.badge ? ` ${CHAT_BADGE}` : '';
            return `<a href="${item.href}"${active}><span class="sb-nav-ico">${iconSvg(item.icon)}</span><span class="sb-nav-txt">${item.label}</span>${badge}</a>`;
        }).join('\n');
    }

    function render(role) {
        const cfg = ROLES[role] || ROLES.admin;
        return `<aside>
            <h1>
                <span class="sidebar-brand-mark">${iconSvg('cap', 20)}</span>
                <span class="sidebar-brand-text">Academia<span>Pro</span></span>
                <button type="button" class="sidebar-collapse-toggle" onclick="window.toggleSidebarCollapse()" aria-label="Minimizar barra lateral" aria-expanded="true" title="Minimizar barra lateral">${iconSvg('chevron', 18)}</button>
            </h1>
            <div class="user-info">${cfg.userInfo}</div>
            <nav id="mainNav">${renderSidebarNavHTML(role)}</nav>
            <div class="sidebar-actions">
                <button type="button" class="sidebar-logout-btn" onclick="window.location.href='/auth/logout'" aria-label="Cerrar sesión">
                    <span class="sidebar-logout-icon">${iconSvg('logout', 18)}</span>
                    <span class="sidebar-logout-text">Cerrar sesión</span>
                </button>
            </div>
        </aside>`;
    }

    // Real per-user name/code the static ROLES markup can't know ahead of time
    // (the role/badge text itself is already correct in each ROLES.*.userInfo
    // once the right config is picked, so only name+code need filling here).
    function fillUserInfo(role, user) {
        const nameId = { admin: 'userName', teacher: 'teacher-name', student: 'sidebar-name' }[role];
        const codeId = { teacher: 'teacher-code', student: 'sidebar-code' }[role];
        if (nameId && user.name) {
            const el = document.getElementById(nameId);
            if (el) el.textContent = user.name;
        }
        if (codeId) {
            const el = document.getElementById(codeId);
            if (el) el.textContent = user.user_code || user.code || '---';
        }
    }

    function replaceAside(current, role) {
        const wrap = document.createElement('div');
        wrap.innerHTML = render(role).trim();
        const next = wrap.firstElementChild;
        current.replaceWith(next);
        setSidebarCollapsed(document.body.classList.contains('sidebar-collapsed'));
        return next;
    }

    function mount() {
        const el = document.getElementById('sidebar-mount');
        if (!el) return;
        // data-role only picks the instant-paint shell (avoids a flash on the
        // common case where it already matches the logged-in user); the real
        // session role from /auth/me is the actual source of truth and wins
        // whenever a page (e.g. an admin browsing their own /teacher/* pages)
        // guessed wrong.
        const paintedRole = el.getAttribute('data-role') || 'admin';
        let asideEl = replaceAside(el, paintedRole);

        fetch('/auth/me', { credentials: 'include' })
            .then(res => res.ok ? res.json() : null)
            .then(user => {
                if (!user || !user.role) return;
                const realRole = user.role === 'admin' ? 'admin' : (user.role === 'teacher' ? 'teacher' : 'student');
                if (realRole !== paintedRole) asideEl = replaceAside(asideEl, realRole);
                fillUserInfo(realRole, user);
            })
            .catch(() => { /* offline/unauthenticated: keep the instant-paint shell */ });
    }

    window.toggleSidebarCollapse = toggleSidebarCollapse;
    window.iconSvg = iconSvg;

    // Mount synchronously if the placeholder is already parsed (script placed right
    // after it); otherwise wait for DOMContentLoaded. Running before the page's own
    // scripts matters — they populate #userName / nav right after.
    if (document.getElementById('sidebar-mount')) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();
