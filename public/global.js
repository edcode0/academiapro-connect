// Global script loaded across all files
console.log('Global script loaded.');

// ===== TOAST NOTIFICATIONS =====
function showToast(msg, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { toast.classList.add('show'); });
    });
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== NEW SIDEBAR DESIGN =====

const _SB_ICONS = {
    'Dashboard':       '<path d="M3 9.5 12 3l9 6.5"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M9.5 20v-6h5v6"/>',
    'Mi Panel':        '<path d="M3 9.5 12 3l9 6.5"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M9.5 20v-6h5v6"/>',
    'Estudiantes':     '<path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/><circle cx="10" cy="8" r="3.2"/><path d="M19.5 19v-1.5a3.5 3.5 0 0 0-2.6-3.38"/><path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6"/>',
    'Profesores':      '<path d="M3 9.2 12 5l9 4.2-9 4.2-9-4.2Z"/><path d="M6.5 11v4c0 1.3 2.5 2.6 5.5 2.6s5.5-1.3 5.5-2.6v-4"/><path d="M21 9.2v4.6"/>',
    'Pagos':           '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 9.5h18"/><path d="M6.5 14.5h3"/>',
    'Mis Pagos':       '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 9.5h18"/><path d="M6.5 14.5h3"/>',
    'Chat':            '<path d="M20 14.5a2 2 0 0 1-2 2H8l-4 3.5V6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/><path d="M8.5 9.5h7"/><path d="M8.5 12.5h4"/>',
    'Configuración':   '<circle cx="12" cy="12" r="3"/><path d="M12.2 2.5h-.4a1.8 1.8 0 0 0-1.8 1.8v.16a1.8 1.8 0 0 1-.9 1.56l-.4.23a1.8 1.8 0 0 1-1.8 0l-.13-.08a1.8 1.8 0 0 0-2.46.66l-.2.34a1.8 1.8 0 0 0 .66 2.46l.13.08a1.8 1.8 0 0 1 .9 1.56v.46a1.8 1.8 0 0 1-.9 1.57l-.13.08a1.8 1.8 0 0 0-.66 2.46l.2.34a1.8 1.8 0 0 0 2.46.66l.13-.08a1.8 1.8 0 0 1 1.8 0l.4.23a1.8 1.8 0 0 1 .9 1.56v.16a1.8 1.8 0 0 0 1.8 1.8h.4a1.8 1.8 0 0 0 1.8-1.8v-.16a1.8 1.8 0 0 1 .9-1.56l.4-.23a1.8 1.8 0 0 1 1.8 0l.13.08a1.8 1.8 0 0 0 2.46-.66l.2-.35a1.8 1.8 0 0 0-.66-2.45l-.13-.08a1.8 1.8 0 0 1-.9-1.57v-.46a1.8 1.8 0 0 1 .9-1.56l.13-.08a1.8 1.8 0 0 0 .66-2.46l-.2-.34a1.8 1.8 0 0 0-2.46-.66l-.13.08a1.8 1.8 0 0 1-1.8 0l-.4-.23a1.8 1.8 0 0 1-.9-1.56v-.16a1.8 1.8 0 0 0-1.8-1.8Z"/>',
    'Mis Alumnos':     '<path d="M14.5 19v-1.5a3.5 3.5 0 0 0-3.5-3.5H6a3.5 3.5 0 0 0-3.5 3.5V19"/><circle cx="8.5" cy="8" r="3.2"/><path d="m16 12 1.8 1.8L21.5 10"/>',
    'Sesiones':        '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
    'Exámenes':        '<rect x="8" y="3" width="8" height="3.6" rx="1.2"/><path d="M16 4.8h2a2 2 0 0 1 2 2v12.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.8a2 2 0 0 1 2-2h2"/><path d="m8.8 14 1.8 1.8 3.6-3.6"/>',
    'Mis Notas':       '<rect x="8" y="3" width="8" height="3.6" rx="1.2"/><path d="M16 4.8h2a2 2 0 0 1 2 2v12.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.8a2 2 0 0 1 2-2h2"/><path d="m8.8 14 1.8 1.8 3.6-3.6"/>',
    'Transcripciones': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8.5 13h7"/><path d="M8.5 16.5h7"/><path d="M8.5 9.5h2"/>',
    'Calendario':      '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    'Mi Calendario':   '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    'Asistente IA':    '<path d="M12 3.5 13.6 8.4 18.5 10 13.6 11.6 12 16.5 10.4 11.6 5.5 10 10.4 8.4Z"/><path d="M18.5 16.5l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6Z"/>',
    'Tutor IA':        '<path d="M12 3.5 13.6 8.4 18.5 10 13.6 11.6 12 16.5 10.4 11.6 5.5 10 10.4 8.4Z"/><path d="M18.5 16.5l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6Z"/>',
    'Simulacro':       '<rect x="8" y="3" width="8" height="3.6" rx="1.2"/><path d="M16 4.8h2a2 2 0 0 1 2 2v12.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.8a2 2 0 0 1 2-2h2"/><path d="M8.5 13h7"/><path d="M8.5 9.5h2"/>',
};

const _LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.2 12 5l9 4.2-9 4.2-9-4.2Z"/><path d="M6.5 11v4c0 1.3 2.5 2.6 5.5 2.6s5.5-1.3 5.5-2.6v-4"/><path d="M21 9.2v4.6"/></svg>';

const _SEARCH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>';

const _LOGOUT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="m15.5 16 4-4-4-4"/><path d="M19.5 12H9"/></svg>';

const _CHEVRON_LEFT  = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
const _CHEVRON_RIGHT = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

function _makeSvgIcon(label) {
    const paths = _SB_ICONS[label];
    if (!paths) return `<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

function _extractNavData(aside) {
    const groups = [];
    const navEl = aside.querySelector('#mainNav');
    if (!navEl) return groups;

    let currentGroup = { label: null, items: [] };
    navEl.childNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.classList.contains('nav-section-title')) {
            if (currentGroup.items.length) groups.push(currentGroup);
            currentGroup = { label: node.textContent.trim(), items: [] };
        } else if (node.tagName === 'A') {
            // Extract text excluding the badge span
            let rawText = '';
            node.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) rawText += n.textContent; });
            rawText = rawText.trim();
            const spaceIdx = rawText.indexOf(' ');
            const label = spaceIdx > 0 ? rawText.substring(spaceIdx + 1).trim() : rawText;
            const badgeId = node.querySelector('.unread-badge-sidebar')?.id || null;
            const isActive = node.classList.contains('active') ||
                (() => { try { return window.location.pathname === new URL(node.href).pathname; } catch { return false; } })();
            currentGroup.items.push({ href: node.getAttribute('href'), label, badgeId, isActive });
        }
    });
    if (currentGroup.items.length) groups.push(currentGroup);
    return groups;
}

function _extractUserData(aside) {
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const strongEl = aside.querySelector('.user-info strong') || aside.querySelector('#teacher-name') || aside.querySelector('#sidebar-name');
        const name = user.name || strongEl?.textContent?.trim() || 'Usuario';
        const role = user.role || 'admin';
        return { name, role, initial: name.trim().charAt(0).toUpperCase() };
    } catch { return { name: 'Usuario', role: 'admin', initial: 'U' }; }
}

function _buildSidebarHTML(groups, user, isRail) {
    const roleLabel = { admin: 'ADMIN', teacher: 'PROFESOR', student: 'ALUMNO' }[user.role] || 'USUARIO';
    const roleClass = { admin: '', teacher: 'role-teacher', student: 'role-student' }[user.role] || '';

    let groupsHTML = '';
    for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const divider = i > 0 ? '<div class="sb-rail-div"></div>' : '';
        const glabel = g.label ? `<div class="sb-glabel">${g.label}</div>` : '';
        const itemsHTML = g.items.map(item => {
            const active = item.isActive ? ' is-active' : '';
            const icon = _makeSvgIcon(item.label);
            let extra = '';
            if (item.badgeId) extra = `<span class="sb-notif" id="${item.badgeId}-dot"></span>`;
            return `<button class="sb-item${active}" onclick="window.location.href='${item.href}'" title="${item.label}">
  <span class="sb-ico">${icon}</span>
  <span class="sb-txt">${item.label}</span>${extra}
</button>`;
        }).join('\n');
        groupsHTML += `${divider}<div class="sb-group">${glabel}<div class="sb-items">${itemsHTML}</div></div>`;
    }

    return `
<div class="sb-top">
  <div class="sb-brand">
    <div class="sb-mark">${_LOGO_SVG}</div>
    <div class="sb-word">AcademiaPro</div>
  </div>
  <div class="sb-search">
    ${_SEARCH_SVG}
    <span>Buscar...</span>
  </div>
  <button class="sb-collapse-btn" onclick="toggleSidebarRail()" title="Colapsar/Expandir">${isRail ? _CHEVRON_RIGHT : _CHEVRON_LEFT}</button>
</div>
<div class="sb-scroll">${groupsHTML}</div>
<div class="sb-bottom">
  <div class="sb-profile">
    <div class="sb-avatar ${roleClass}">${user.initial}</div>
    <div class="sb-pinfo">
      <div class="sb-pname">${user.name}</div>
      <span class="sb-badge ${roleClass}">${roleLabel}</span>
    </div>
  </div>
  <button class="sb-logout" onclick="window.location.href='/auth/logout'">
    ${_LOGOUT_SVG}
    <span class="sb-logout-txt">Cerrar sesión</span>
  </button>
</div>`;
}

function toggleSidebarRail() {
    const aside = document.querySelector('aside');
    const main = document.querySelector('main');
    if (!aside) return;
    const isRail = aside.classList.toggle('sb--rail');
    aside.classList.toggle('sb--light', !isRail);
    const btn = aside.querySelector('.sb-collapse-btn');
    if (btn) btn.innerHTML = isRail ? _CHEVRON_RIGHT : _CHEVRON_LEFT;
    if (main) {
        main.classList.toggle('sb-rail-offset', isRail);
    }
    localStorage.setItem('sidebarCollapsed', isRail);
}

function buildNewSidebar() {
    const aside = document.querySelector('aside');
    const main = document.querySelector('main');
    if (!aside) return;

    // Inject sidebar.css before building
    if (!document.querySelector('link[href="/sidebar.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/sidebar.css';
        document.head.appendChild(link);
    }

    // Extract data from existing structure
    const groups = _extractNavData(aside);
    const user = _extractUserData(aside);
    const isRail = localStorage.getItem('sidebarCollapsed') === 'true';

    // Replace aside classes and content
    aside.className = isRail ? 'sb sb--rail' : 'sb sb--light';
    aside.innerHTML = _buildSidebarHTML(groups, user, isRail);

    // Update main margin
    if (main) {
        main.classList.add('sb-offset');
        if (isRail) main.classList.add('sb-rail-offset');
    }

    // Sync unread badge (forward existing DOM badge state)
    const existingBadge = document.getElementById('global-unread');
    if (existingBadge) {
        const dot = aside.querySelector('#global-unread-dot');
        if (dot && existingBadge.style.display !== 'none' && existingBadge.textContent) {
            dot.classList.add('visible');
        }
    }
}

// ===== MOBILE NAVIGATION =====
function toggleMobileNav() {
    const aside = document.querySelector('aside');
    const overlay = document.getElementById('mobile-nav-overlay');
    if (!aside || !overlay) return;
    aside.classList.toggle('mobile-open');
    overlay.classList.toggle('active');
}

function closeMobileNav() {
    const aside = document.querySelector('aside');
    const overlay = document.getElementById('mobile-nav-overlay');
    if (!aside || !overlay) return;
    aside.classList.remove('mobile-open');
    overlay.classList.remove('active');
}

document.addEventListener('DOMContentLoaded', buildNewSidebar);
