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
document.addEventListener('DOMContentLoaded', initSidebarAvatar);

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

// Escape untrusted text before interpolating into innerHTML (audit F5 — XSS guard).
// Global so every page (all load global.js) can use it; pages with a local
// escapeHtml keep theirs.
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
window.escapeHtml = window.escapeHtml || escapeHtml;
