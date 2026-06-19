/**
 * LMS Colab Platform — Main Express Server (reloaded 2)
 */
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const testFlowRoutes = require('./routes/testFlow');
const db = require('./db');


const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
}));


// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ─────────────────────────────────────────────────

app.use('/auth', authRoutes);
app.use('/api', testFlowRoutes);

// --- Teacher Dashboard (Mock LMS) ---
app.get('/dashboard', (req, res) => {
    const submissions = db.prepare('SELECT * FROM submissions ORDER BY id ASC').all();
    const totalSubmissions = submissions.length;
    const uniqueStudents = [...new Set(submissions.map(s => s.studentId))].length;
    const latestTime = totalSubmissions > 0 ? submissions[submissions.length - 1].timestamp : '—';
    
    let cardsHtml = '';

    if (totalSubmissions === 0) {
        cardsHtml = `<div class="empty-state">
            <div class="empty-icon">📭</div>
            <h3>No Submissions Yet</h3>
            <p>When students submit their assignments from Google Colab, they will appear here in real time.</p>
            <a href="/" class="btn-primary">← Back to Portal</a>
        </div>`;
    } else {
        [...submissions].reverse().forEach((sub, index) => {
            const num = totalSubmissions - index;
            let escapedCode = (sub.code || '# No code provided')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
            // Render inline graph images
            escapedCode = escapedCode.replace(
                /# \[IMAGE: ([A-Za-z0-9+/=]+)\]/g, 
                '</br><div style="margin-top: 15px; padding: 10px; background: white; display: inline-block; border-radius: 8px;"><img src="data:image/png;base64,$1" style="max-width: 100%; height: auto; border-radius: 4px;" alt="Graph Output"/></div></br>'
            );

            cardsHtml += `
            <div class="submission-card" style="animation-delay: ${index * 0.08}s">
                <div class="card-header">
                    <div class="card-badge">#${num}</div>
                    <div class="card-meta">
                        <div class="meta-row"><span class="meta-label">Student</span><span class="meta-value">${sub.studentId}</span></div>
                        <div class="meta-row"><span class="meta-label">Module</span><span class="meta-value">${sub.moduleId}</span></div>
                        <div class="meta-row"><span class="meta-label">Allocation</span><span class="meta-value">${sub.allocationId}</span></div>
                        <div class="meta-row"><span class="meta-label">Time</span><span class="meta-value">${sub.timestamp}</span></div>
                    </div>
                    <div class="card-actions">
                        <a href="/api/download-code/${sub.id}" class="btn-action" title="Download Python Code">
                            🐍 Code
                        </a>
                        ${sub.notebookId ? `
                        <a href="/api/download-notebook/${sub.id}" class="btn-action" title="Download Notebook (.ipynb)">
                            📓 Notebook
                        </a>
                        <a href="https://colab.research.google.com/drive/${sub.notebookId}" target="_blank" class="btn-action colab" title="Open in Google Colab">
                            ⚡ Colab
                        </a>
                        ` : ''}
                    </div>
                </div>
                <div class="code-block">
                    <div class="code-header"><span class="code-dot red"></span><span class="code-dot yellow"></span><span class="code-dot green"></span><span class="code-title">student_code.py</span></div>
                    <pre><code>${escapedCode}</code></pre>
                </div>
            </div>`;
        });
    }

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Amypo Teacher Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0f172a;
            --surface: rgba(30, 41, 59, 0.6);
            --surface-solid: #1e293b;
            --border: rgba(255,255,255,0.08);
            --primary: #6366f1;
            --primary-glow: rgba(99,102,241,0.25);
            --accent: #ec4899;
            --green: #22c55e;
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --text-dim: #64748b;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            background-image:
                radial-gradient(circle at 10% 20%, rgba(99,102,241,0.12), transparent 30%),
                radial-gradient(circle at 90% 80%, rgba(236,72,153,0.08), transparent 30%);
        }

        /* Navbar */
        .navbar {
            display: flex; justify-content: space-between; align-items: center;
            padding: 1rem 2.5rem;
            border-bottom: 1px solid var(--border);
            backdrop-filter: blur(12px);
            position: sticky; top: 0; z-index: 100;
            background: rgba(15,23,42,0.85);
        }
        .nav-brand { display: flex; align-items: center; gap: 12px; font-size: 1.25rem; font-weight: 700; }
        .nav-logo {
            width: 36px; height: 36px; border-radius: 10px;
            background: linear-gradient(135deg, var(--primary), var(--accent));
            display: flex; align-items: center; justify-content: center; font-size: 18px;
        }
        .nav-links { display: flex; gap: 10px; }
        .btn-nav {
            padding: 8px 18px; border-radius: 8px; text-decoration: none;
            font-weight: 500; font-size: 0.9rem; transition: all 0.2s;
        }
        .btn-ghost { color: var(--text-muted); border: 1px solid var(--border); }
        .btn-ghost:hover { color: var(--text); border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); }
        .btn-primary { background: var(--primary); color: white; border: none; text-decoration: none; padding: 8px 18px; border-radius: 8px; font-weight: 500; font-size: 0.9rem; }
        .btn-primary:hover { background: #4f46e5; }

        /* Stats */
        .stats-grid {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 1rem; padding: 2rem 2.5rem 0;
        }
        .stat-card {
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 16px; padding: 1.5rem;
            backdrop-filter: blur(12px);
            animation: fadeIn 0.5s ease forwards; opacity: 0;
        }
        .stat-card:nth-child(1) { animation-delay: 0.1s; }
        .stat-card:nth-child(2) { animation-delay: 0.2s; }
        .stat-card:nth-child(3) { animation-delay: 0.3s; }
        .stat-label { font-size: 0.85rem; color: var(--text-dim); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
        .stat-value { font-size: 2rem; font-weight: 700; }
        .stat-value.purple { color: var(--primary); }
        .stat-value.pink { color: var(--accent); }
        .stat-value.green { color: var(--green); }

        /* Content */
        .content { padding: 2rem 2.5rem 3rem; }
        .section-title { font-size: 1.1rem; font-weight: 600; color: var(--text-muted); margin-bottom: 1.5rem; }

        /* Empty State */
        .empty-state {
            text-align: center; padding: 4rem 2rem;
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 20px; max-width: 500px; margin: 0 auto;
        }
        .empty-icon { font-size: 3rem; margin-bottom: 1rem; }
        .empty-state h3 { font-size: 1.3rem; margin-bottom: 0.5rem; }
        .empty-state p { color: var(--text-dim); margin-bottom: 1.5rem; line-height: 1.6; }

        /* Submission Cards */
        .submission-card {
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 16px; margin-bottom: 1.25rem; overflow: hidden;
            transition: border-color 0.3s, box-shadow 0.3s;
            animation: fadeSlideUp 0.5s ease forwards; opacity: 0;
        }
        .submission-card:hover {
            border-color: rgba(99,102,241,0.3);
            box-shadow: 0 0 30px var(--primary-glow);
        }
        .card-header { display: flex; gap: 1.25rem; padding: 1.25rem 1.5rem; align-items: center; }
        .card-badge {
            background: linear-gradient(135deg, var(--primary), var(--accent));
            color: white; font-weight: 700; font-size: 0.85rem;
            padding: 6px 14px; border-radius: 8px; white-space: nowrap;
        }
        .card-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 2rem; flex: 1; }
        .meta-row { display: flex; gap: 8px; }
        .meta-label { font-size: 0.8rem; color: var(--text-dim); min-width: 75px; }
        .meta-value { font-size: 0.85rem; color: var(--text-muted); font-weight: 500; word-break: break-all; }

        /* Actions */
        .card-actions {
            display: flex; gap: 8px; align-items: center; margin-left: auto;
        }
        .btn-action {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 6px 12px; border-radius: 8px; text-decoration: none;
            font-size: 0.85rem; font-weight: 600; border: 1px solid var(--border);
            color: var(--text-muted); background: rgba(255,255,255,0.02);
            transition: all 0.2s;
        }
        .btn-action:hover {
            color: var(--text); border-color: rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.05); transform: translateY(-1px);
        }
        .btn-action.colab {
            background: rgba(235,130,0,0.1); border-color: rgba(235,130,0,0.2);
            color: #f59e0b;
        }
        .btn-action.colab:hover {
            background: rgba(235,130,0,0.2); border-color: rgba(235,130,0,0.4);
            color: #fbbf24;
        }

        /* Code Block */
        .code-block { border-top: 1px solid var(--border); }
        .code-header {
            display: flex; align-items: center; gap: 6px;
            padding: 10px 1.5rem; background: rgba(0,0,0,0.2);
            border-bottom: 1px solid var(--border);
        }
        .code-dot { width: 10px; height: 10px; border-radius: 50%; }
        .code-dot.red { background: #ef4444; }
        .code-dot.yellow { background: #eab308; }
        .code-dot.green { background: #22c55e; }
        .code-title { font-size: 0.75rem; color: var(--text-dim); margin-left: 8px; font-family: monospace; }
        pre {
            margin: 0; padding: 1.25rem 1.5rem; overflow-x: auto;
            background: rgba(0,0,0,0.15); font-size: 0.85rem; line-height: 1.7;
        }
        code { font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace; color: #e2e8f0; }

        @keyframes fadeIn { to { opacity: 1; } }
        @keyframes fadeSlideUp { to { opacity: 1; transform: translateY(0); } }
        .submission-card { transform: translateY(12px); }

        @media (max-width: 640px) {
            .navbar { padding: 1rem; }
            .stats-grid, .content { padding-left: 1rem; padding-right: 1rem; }
            .card-meta { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="nav-brand"><div class="nav-logo">🎓</div> Amypo Dashboard</div>
        <div class="nav-links">
            <a href="/" class="btn-nav btn-ghost">← Portal</a>
        </div>
    </nav>

    <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Total Submissions</div><div class="stat-value purple">${totalSubmissions}</div></div>
        <div class="stat-card"><div class="stat-label">Unique Students</div><div class="stat-value pink">${uniqueStudents}</div></div>
        <div class="stat-card"><div class="stat-label">Latest Submission</div><div class="stat-value green" style="font-size:1rem">${latestTime}</div></div>
    </div>

    <div class="content">
        <div class="section-title">Recent Submissions</div>
        ${cardsHtml}
    </div>
</body>
</html>`);
});

// Catch-all: serve index.html for any unmatched route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error handling ─────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ─── Start server ───────────────────────────────────────────

const server = app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║   🎓 LMS Colab Platform — Running on port ${PORT}       ║
║   📍 http://localhost:${PORT}                          ║
║   🔐 OAuth callback: /auth/google/callback           ║
╚══════════════════════════════════════════════════════╝
    `);
});

// Clean shutdown on nodemon restart (SIGUSR2)
process.once('SIGUSR2', () => {
    server.close(() => {
        process.kill(process.pid, 'SIGUSR2');
    });
});

// Clean shutdown on Ctrl+C (SIGINT) and termination (SIGTERM)
process.on('SIGINT', () => {
    server.close(() => {
        process.exit(0);
    });
});
process.on('SIGTERM', () => {
    server.close(() => {
        process.exit(0);
    });
});
