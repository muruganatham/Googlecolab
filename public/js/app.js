/**
 * LMS Colab Platform — Main Frontend JavaScript
 * Handles authentication state, API calls, dashboard rendering, and navigation.
 */

// ═══════════════════════════════════════════════════════════════
//  GLOBAL STATE & UTILITIES
// ═══════════════════════════════════════════════════════════════

let currentUser = null;

/**
 * API wrapper with error handling.
 */
async function api(url, options = {}) {
    try {
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options
        });

        if (res.status === 401) {
            window.location.href = '/';
            return null;
        }

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Request failed');
        }

        return data;
    } catch (err) {
        console.error(`API error (${url}):`, err);
        throw err;
    }
}

/**
 * Show a toast notification.
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
        <span class="toast-message">${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        toast.style.transition = 'all 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/**
 * Format a date string for display.
 */
function formatDate(dateStr) {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Get gradient class for course thumbnails.
 */
function getThumbGradient(index) {
    const gradients = ['thumb-gradient-1', 'thumb-gradient-2', 'thumb-gradient-3'];
    return gradients[index % gradients.length];
}

/**
 * Get category emoji.
 */
function getCategoryEmoji(category) {
    const emojis = {
        'Machine Learning': '🤖',
        'Deep Learning': '🧠',
        'Natural Language Processing': '💬',
        'Computer Vision': '👁️',
        'Data Science': '📊',
        'Reinforcement Learning': '🎮'
    };
    return emojis[category] || '📚';
}

// ═══════════════════════════════════════════════════════════════
//  AUTHENTICATION
// ═══════════════════════════════════════════════════════════════

async function loadUser() {
    try {
        const data = await api('/auth/me');
        if (!data || !data.authenticated) {
            window.location.href = '/';
            return;
        }

        currentUser = data.user;

        // Update navbar
        const avatarEl = document.getElementById('user-avatar');
        const nameEl = document.getElementById('user-name');

        if (avatarEl) {
            avatarEl.src = currentUser.avatar_url || '';
            avatarEl.alt = currentUser.name;
        }
        if (nameEl) {
            nameEl.textContent = currentUser.name;
        }

        // Update welcome heading if on dashboard
        const welcomeEl = document.getElementById('welcome-heading');
        if (welcomeEl) {
            const firstName = currentUser.name.split(' ')[0];
            welcomeEl.textContent = `Welcome back, ${firstName}! 👋`;
        }

    } catch (err) {
        console.error('Auth check failed:', err);
        window.location.href = '/';
    }
}

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD LOGIC
// ═══════════════════════════════════════════════════════════════

async function loadDashboard() {
    try {
        // Load all data in parallel
        const [enrollmentsData, coursesData, submissionsData] = await Promise.all([
            api('/api/my-courses'),
            api('/api/courses'),
            api('/api/submissions')
        ]);

        const enrollments = enrollmentsData?.enrollments || [];
        const courses = coursesData?.courses || [];
        const submissions = submissionsData?.submissions || [];

        // Hide loading, show content
        const loadingEl = document.getElementById('loading-state');
        const contentEl = document.getElementById('dashboard-content');
        if (loadingEl) loadingEl.classList.add('hidden');
        if (contentEl) contentEl.classList.remove('hidden');

        // Update stats
        updateDashboardStats(enrollments, submissions);

        // Render my courses
        renderMyCourses(enrollments);

        // Render all courses
        renderAllCourses(courses);

        // Render submissions
        renderSubmissions(submissions);

    } catch (err) {
        console.error('Dashboard load failed:', err);
        showToast('Failed to load dashboard data', 'error');
    }
}

function updateDashboardStats(enrollments, submissions) {
    const enrolled = enrollments.length;
    const inProgress = submissions.filter(s => s.status === 'in_progress').length;
    const submitted = submissions.filter(s => s.status === 'submitted' || s.status === 'graded').length;
    const gradedSubmissions = submissions.filter(s => s.score !== null);
    const avgScore = gradedSubmissions.length > 0
        ? Math.round(gradedSubmissions.reduce((sum, s) => sum + s.score, 0) / gradedSubmissions.length)
        : null;

    const statEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val !== null && val !== undefined ? val : '—';
    };

    statEl('stat-enrolled', enrolled);
    statEl('stat-in-progress', inProgress);
    statEl('stat-submitted', submitted);
    statEl('stat-avg-score', avgScore !== null ? `${avgScore}%` : '—');
}

function renderMyCourses(enrollments) {
    const grid = document.getElementById('my-courses-grid');
    const emptyState = document.getElementById('empty-my-courses');
    if (!grid) return;

    if (enrollments.length === 0) {
        grid.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    grid.innerHTML = enrollments.map((enrollment, idx) => `
        <div class="glass-card course-card" onclick="window.location.href='/course.html?id=${enrollment.course_id}'" id="enrolled-course-${enrollment.course_id}">
            <div class="course-thumb-placeholder ${getThumbGradient(idx)}">
                ${getCategoryEmoji(enrollment.category)}
            </div>
            <div class="course-body">
                <div class="course-category">${enrollment.category || 'AI/ML'}</div>
                <div class="course-title">${enrollment.title}</div>
                <div class="course-desc">${enrollment.description || ''}</div>
                <div class="course-meta">
                    <span class="instructor">👤 ${enrollment.instructor_name || 'Instructor'}</span>
                    <span class="badge badge-${enrollment.difficulty}">${enrollment.difficulty || 'beginner'}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${enrollment.progress_percent || 0}%"></div>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 12px; color: var(--text-muted);">
                    <span>Progress</span>
                    <span>${Math.round(enrollment.progress_percent || 0)}%</span>
                </div>
            </div>
        </div>
    `).join('');
}

function renderAllCourses(courses) {
    const grid = document.getElementById('all-courses-grid');
    if (!grid) return;

    grid.innerHTML = courses.map((course, idx) => `
        <div class="glass-card course-card" onclick="window.location.href='/course.html?id=${course.id}'" id="course-card-${course.id}">
            <div class="course-thumb-placeholder ${getThumbGradient(idx)}">
                ${getCategoryEmoji(course.category)}
            </div>
            <div class="course-body">
                <div class="course-category">${course.category || 'AI/ML'}</div>
                <div class="course-title">${course.title}</div>
                <div class="course-desc">${course.description || ''}</div>
                <div class="course-meta">
                    <span class="instructor">👤 ${course.instructor_name || 'Instructor'}</span>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        ${course.is_enrolled ? '<span class="badge badge-enrolled">Enrolled</span>' : ''}
                        <span class="badge badge-${course.difficulty}">${course.difficulty || 'beginner'}</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function renderSubmissions(submissions) {
    const tbody = document.getElementById('submissions-tbody');
    const emptyState = document.getElementById('empty-submissions');
    if (!tbody) return;

    if (submissions.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = submissions.map(s => `
        <tr>
            <td style="font-weight: 600; color: var(--text-primary);">${s.assignment_title}</td>
            <td>${s.course_title}</td>
            <td><code style="font-size: 12px; color: var(--text-accent);">${s.notebook_filename || '—'}</code></td>
            <td><span class="badge badge-status badge-${s.status}">${formatStatus(s.status)}</span></td>
            <td>${s.score !== null ? `<span style="font-weight: 700; color: var(--status-graded);">${s.score}/${s.max_score}</span>` : '—'}</td>
            <td style="font-size: 13px; color: var(--text-muted);">${formatDate(s.started_at)}</td>
            <td>
                ${s.colab_url ? `<a href="${s.colab_url}" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 11px;">Open Colab</a>` : '—'}
            </td>
        </tr>
    `).join('');
}

function formatStatus(status) {
    return {
        'not_started': 'Not Started',
        'in_progress': 'In Progress',
        'submitted': 'Submitted',
        'graded': 'Graded'
    }[status] || status;
}

// ═══════════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tabs .tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Show/hide panels
    const panels = {
        'my-courses': 'panel-my-courses',
        'all-courses': 'panel-all-courses',
        'submissions': 'panel-submissions'
    };

    Object.entries(panels).forEach(([key, panelId]) => {
        const panel = document.getElementById(panelId);
        if (panel) {
            panel.classList.toggle('hidden', key !== tabName);
        }
    });
}

// Setup tab click handlers
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
        });
    });
});

// ═══════════════════════════════════════════════════════════════
//  INITIALIZE
// ═══════════════════════════════════════════════════════════════

// Auto-initialize if on dashboard page
if (document.getElementById('dashboard-content')) {
    loadUser().then(() => loadDashboard());
}

// Check URL hash for tab switching
if (window.location.hash === '#courses') {
    setTimeout(() => switchTab('all-courses'), 100);
}
