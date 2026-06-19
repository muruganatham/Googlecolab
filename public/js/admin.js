/**
 * LMS Colab Platform — Admin Panel JavaScript
 */

// ═══════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD
// ═══════════════════════════════════════════════════════════════

async function loadAdminDashboard() {
    try {
        const [statsData, submissionsData] = await Promise.all([
            api('/api/admin/dashboard'),
            api('/api/admin/submissions')
        ]);

        renderAdminStats(statsData?.stats);
        renderAdminSubmissions(submissionsData?.submissions || []);
    } catch (err) {
        console.error('Admin dashboard load failed:', err);
        // If not admin, redirect
        if (err.message && err.message.includes('Admin')) {
            window.location.href = '/dashboard.html';
        }
        showToast('Failed to load admin data', 'error');
    }
}

function renderAdminStats(stats) {
    if (!stats) return;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val !== null && val !== undefined ? val : '—';
    };

    set('admin-stat-students', stats.totalStudents);
    set('admin-stat-courses', stats.totalCourses);
    set('admin-stat-submissions', stats.totalSubmissions);
    set('admin-stat-enrollments', stats.totalEnrollments);
    set('admin-stat-graded', stats.gradedCount);
    set('admin-stat-avg-score', stats.avgScore > 0 ? Math.round(stats.avgScore) : '—');
}

function renderAdminSubmissions(submissions) {
    const tbody = document.getElementById('admin-submissions-tbody');
    const emptyState = document.getElementById('admin-empty-submissions');
    if (!tbody) return;

    if (submissions.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = submissions.map(s => `
        <tr id="admin-submission-${s.id}">
            <td>
                <div style="font-weight: 600; color: var(--text-primary);">${s.student_name}</div>
                <div style="font-size: 12px; color: var(--text-muted);">${s.student_email}</div>
            </td>
            <td style="font-weight: 500;">${s.assignment_title}</td>
            <td style="font-size: 13px; color: var(--text-muted);">${s.course_title}</td>
            <td><code style="font-size: 11px; color: var(--text-accent);">${s.notebook_filename || '—'}</code></td>
            <td><span class="badge badge-status badge-${s.status}">${formatStatus(s.status)}</span></td>
            <td>${s.score !== null ? `<span style="font-weight: 700; color: var(--status-graded);">${s.score}</span>` : '—'}</td>
            <td style="font-size: 13px; color: var(--text-muted);">${formatDate(s.submitted_at)}</td>
            <td>
                ${s.status === 'submitted' ? `
                    <button class="btn btn-success btn-sm" onclick="gradeSubmission(${s.id})" id="btn-grade-${s.id}" style="font-size: 11px;">
                        Grade
                    </button>
                ` : s.status === 'graded' ? '✅' : '—'}
            </td>
        </tr>
    `).join('');
}

// ─── Grade Submission ───────────────────────────────────────

async function gradeSubmission(submissionId) {
    const score = prompt('Enter score (0-100):');
    if (score === null) return;

    const scoreNum = parseInt(score);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
        showToast('Please enter a valid score between 0 and 100', 'error');
        return;
    }

    const feedback = prompt('Enter feedback (optional):') || '';

    try {
        await api(`/api/admin/submissions/${submissionId}/grade`, {
            method: 'POST',
            body: JSON.stringify({ score: scoreNum, feedback })
        });

        showToast(`Submission graded: ${scoreNum}/100`, 'success');
        loadAdminDashboard(); // Reload
    } catch (err) {
        showToast('Failed to grade submission', 'error');
    }
}

// ─── Filters ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const filterStatus = document.getElementById('filter-status');
    if (filterStatus) {
        filterStatus.addEventListener('change', async () => {
            try {
                const status = filterStatus.value;
                const url = status ? `/api/admin/submissions?status=${status}` : '/api/admin/submissions';
                const data = await api(url);
                renderAdminSubmissions(data?.submissions || []);
            } catch (err) {
                showToast('Failed to filter submissions', 'error');
            }
        });
    }

    // Admin tab switching
    document.querySelectorAll('#admin-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            document.querySelectorAll('#admin-tabs .tab').forEach(t =>
                t.classList.toggle('active', t.dataset.tab === tabName)
            );

            document.getElementById('admin-panel-submissions').classList.toggle('hidden', tabName !== 'submissions');
            document.getElementById('admin-panel-overview').classList.toggle('hidden', tabName !== 'overview');
        });
    });
});

// ─── Initialize ─────────────────────────────────────────────
loadUser().then(() => loadAdminDashboard());
