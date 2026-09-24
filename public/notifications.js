// ─── In-App Notification System ───────────────────────────────────────────────
(function () {
    // Inject dropdown positioning once so all pages get consistent styling
    const style = document.createElement('style');
    style.textContent = `
        .notif-dropdown {
            position: fixed !important;
            top: 70px !important;
            right: 20px !important;
            width: min(380px, calc(100vw - 32px)) !important;
            max-height: min(500px, calc(100vh - 88px)) !important;
            overflow-y: auto !important;
            z-index: 9999 !important;
            box-shadow: 0 8px 30px rgba(0,0,0,0.15) !important;
            border-radius: 16px !important;
        }
        .notif-dropdown-header {
            gap: 12px !important;
            flex-wrap: wrap !important;
        }
        .notif-mark-all {
            flex: 0 0 auto !important;
            padding: 6px 10px !important;
            border: 1px solid #ddd6fe !important;
            border-radius: 999px !important;
            background: #ede9fe !important;
            color: #6d28d9 !important;
            font-size: 12px !important;
            line-height: 1.2 !important;
            white-space: nowrap !important;
        }
    `;
    document.head.appendChild(style);
    const ICONS = {
        message: '💬',
        session: '📅',
        at_risk: '⚠️',
        payment_overdue: '💳',
        report: '📊',
        transcript: '📝',
        default: '🔔'
    };

    function timeAgo(dateStr) {
        const diff = Date.now() - new Date(dateStr).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'ahora mismo';
        if (m < 60) return `hace ${m} min`;
        const h = Math.floor(m / 60);
        if (h < 24) return `hace ${h}h`;
        return `hace ${Math.floor(h / 24)}d`;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function loadNotifications() {
        try {
            const res = await fetch('/api/notifications', { credentials: 'include' });
            if (!res.ok) return;
            const all = await res.json();
            renderNotifications(all.slice(0, 10));
            const unread = all.filter(n => !n.read).length;
            const badge = document.getElementById('notifBadge');
            if (!badge) return;
            if (unread > 0) {
                badge.textContent = unread > 99 ? '99+' : unread;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        } catch (e) {
            console.error('[Notifications] Load error:', e);
        }
    }

    function renderNotifications(notifications) {
        const list = document.getElementById('notifList');
        if (!list) return;
        if (!notifications.length) {
            list.innerHTML = '<div class="notif-empty">No hay notificaciones</div>';
            return;
        }
        list.innerHTML = notifications.map(n => {
            const icon = ICONS[n.type] || ICONS.default;
            const href = n.link || '#';
            return `<a class="notif-item ${n.read ? '' : 'unread'}" href="${escapeHtml(href)}"
                       onclick="window._markNotifRead(${n.id}, event)">
                <span class="notif-icon">${icon}</span>
                <div class="notif-body">
                    <div class="notif-title">${escapeHtml(n.title)}</div>
                    <div class="notif-msg">${escapeHtml(n.message)}</div>
                    <div class="notif-time">${timeAgo(n.created_at)}</div>
                </div>
            </a>`;
        }).join('');
    }

    window.toggleNotifDropdown = function () {
        const dd = document.getElementById('notifDropdown');
        if (dd) dd.classList.toggle('open');
    };

    window._markNotifRead = async function (id, event) {
        await fetch(`/api/notifications/mark-read/${id}`, {
            method: 'POST',
            credentials: 'include'
        }).catch(() => {});
        const item = event.currentTarget;
        item.classList.remove('unread');
        const badge = document.getElementById('notifBadge');
        if (badge) {
            const count = (parseInt(badge.textContent) || 0) - 1;
            if (count <= 0) badge.style.display = 'none';
            else badge.textContent = count;
        }
    };

    window.markAllNotifRead = async function () {
        const res = await fetch('/api/notifications/mark-all-read', {
            method: 'POST',
            credentials: 'include'
        });
        if (!res.ok) throw new Error(`No se pudieron marcar las notificaciones (${res.status})`);
        await loadNotifications();
    };

    // Close dropdown on outside click
    document.addEventListener('click', function (e) {
        const wrap = document.getElementById('notifBellWrap');
        if (wrap && !wrap.contains(e.target)) {
            const dd = document.getElementById('notifDropdown');
            if (dd) dd.classList.remove('open');
        }
    });

    // Socket.IO real-time push (if socket.io client is loaded)
    function connectSocket() {
        if (typeof io === 'undefined') return;
        try {
            const sock = io({ withCredentials: true });
            sock.on('new_notification', function () {
                loadNotifications();
            });
        } catch (e) {
            console.error('[Notifications] Socket error:', e);
        }
    }

    window.initNotifications = function () {
        loadNotifications();
        connectSocket();
        setInterval(loadNotifications, 30000);
    };
})();
// ──────────────────────────────────────────────────────────────────────────────
