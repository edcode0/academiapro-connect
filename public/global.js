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

// ===== SIDEBAR USER AVATAR =====
function initSidebarAvatar() {
    const userInfoEl = document.querySelector('aside .user-info');
    if (!userInfoEl) return;
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const name = user.name || userInfoEl.querySelector('strong')?.textContent || '?';
        const role = user.role || 'admin';
        const initial = name.trim().charAt(0).toUpperCase();
        const avatarDiv = document.createElement('div');
        avatarDiv.className = `sidebar-avatar ${role}`;
        avatarDiv.textContent = initial;
        avatarDiv.title = name;
        userInfoEl.insertBefore(avatarDiv, userInfoEl.firstChild);
    } catch (e) { /* ignore */ }
}

// ===== SIDEBAR COLLAPSE =====
function _wrapNavLinks() {
    document.querySelectorAll('#mainNav a').forEach(a => {
        if (a.querySelector('.nav-icon')) return;
        const badge = a.querySelector('.unread-badge-sidebar');
        let rawText = '';
        a.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) rawText += n.textContent; });
        rawText = rawText.trim();
        if (!rawText) return;
        const spaceIdx = rawText.indexOf(' ');
        const icon = spaceIdx > 0 ? rawText.substring(0, spaceIdx) : rawText;
        const label = spaceIdx > 0 ? rawText.substring(spaceIdx + 1).trim() : '';
        a.textContent = '';
        const iconSpan = document.createElement('span');
        iconSpan.className = 'nav-icon';
        iconSpan.textContent = icon;
        a.appendChild(iconSpan);
        if (label) {
            const textSpan = document.createElement('span');
            textSpan.className = 'nav-text';
            textSpan.textContent = ' ' + label;
            a.appendChild(textSpan);
        }
        if (badge) a.appendChild(badge);
        a.title = label || icon;
        a.setAttribute('data-label', label || icon);
    });
}

function toggleSidebar() {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', collapsed);
    const btn = document.querySelector('.sidebar-toggle-btn');
    if (btn) btn.innerHTML = collapsed ? '&#9654;' : '&#9664;';
}

function initSidebarToggle() {
    const aside = document.querySelector('aside');
    const main = document.querySelector('main');
    if (!aside) return;

    // Set transitions via inline style to override any inline CSS
    aside.style.transition = 'width 0.25s ease, padding 0.25s ease';
    if (main) main.style.transition = 'margin-left 0.25s ease';

    // Wrap nav link text into icon + text spans
    _wrapNavLinks();

    // Create toggle button
    const btn = document.createElement('button');
    btn.className = 'sidebar-toggle-btn';
    btn.setAttribute('aria-label', 'Colapsar/Expandir menú');
    btn.title = 'Colapsar menú';

    // Restore persisted state
    const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (collapsed) document.body.classList.add('sidebar-collapsed');
    btn.innerHTML = collapsed ? '&#9654;' : '&#9664;';
    btn.onclick = toggleSidebar;

    // Wrap h1 + button in a header row
    const h1 = aside.querySelector('h1');
    if (h1) {
        const header = document.createElement('div');
        header.className = 'sidebar-header';
        aside.insertBefore(header, h1);
        header.appendChild(h1);
        header.appendChild(btn);
    } else {
        aside.insertBefore(btn, aside.firstChild);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initSidebarAvatar();
    initSidebarToggle();
});

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
