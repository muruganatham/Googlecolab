const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');
const driveService = require('../services/drive');
const db = require('../db');

const router = express.Router();

// Secret key for signing submission tokens (use env var in production)
const SUBMIT_SECRET = process.env.SUBMIT_SECRET || 'amypo-colab-secret-key-2026';

/**
 * Normalizes notebook cell string content for hashing to prevent formatting/newline mismatches.
 */
function normalizeForHash(str) {
    if (!str) return '';
    return str
        .replace(/[\s\r\n\\`'""]/g, '') // Remove all whitespace, newlines, carriage returns, backslashes, and quotes
        .toLowerCase();
}

/**
 * Validates a signed submission token and extracts its payload statelessly.
 */
function validateSubmitToken(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    
    try {
        const [payloadHex, signature] = parts;
        const submissionPayload = Buffer.from(payloadHex, 'hex').toString('utf8');
        const expectedSignature = crypto.createHmac('sha256', SUBMIT_SECRET)
            .update(submissionPayload)
            .digest('hex');
        
        if (signature !== expectedSignature) {
            console.error('⚠️ Token signature mismatch');
            return null;
        }

        const [studentId, allocationId, moduleId, integrityHash] = submissionPayload.split(':');
        return { studentId, allocationId, moduleId, integrityHash };
    } catch (e) {
        console.error('Failed to parse token:', e);
        return null;
    }
}

/**
 * GET /api/take-test
 * Triggered by the Take Test button.
 */
router.get('/take-test', async (req, res) => {
    try {
        // 1. Check if user is logged in
        if (!req.session || !req.session.user) {
            // Save query params so we can return here after login
            req.session.pendingTestQuery = req.query;
            return res.redirect('/auth/google');
        }

        const user = req.session.user;

        // 2. Build the notebook based on query parameters
        const queryParams = Object.keys(req.query).length > 0 ? req.query : (req.session.pendingTestQuery || {});
        
        const allocationId = queryParams.allocate_id || queryParams.allocation_id || 'unknown_alloc';
        const moduleId = queryParams.module_id || 'unknown_mod';
        const token = queryParams.token || 'none';

        const templatePath = path.join(__dirname, '..', 'templates', 'sample_assignment.ipynb');
        
        if (!fs.existsSync(templatePath)) {
            return res.status(500).json({ error: 'Template notebook not found.' });
        }

        let templateContent = fs.readFileSync(templatePath, 'utf8');

        // ==========================================
        // DYNAMIC QUESTION INJECTION (Real API Call)
        // ==========================================
        
        let apiData = {};
        try {
            // Forward the token as a Bearer token
            const authHeader = token !== 'none' ? `Bearer ${token}` : '';
            
            // Call the real API endpoint
            const response = await fetch('https://1102amy21.amypo.ai/api/sandbox/fetchbyid', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': authHeader
                },
                body: JSON.stringify(queryParams) // Pass all URL params to the API
            });

            if (!response.ok) {
                console.error('API responded with status:', response.status);
            }
            apiData = await response.json();
            
            console.log(`\n==========================================`);
            console.log(`🔍 AMYPO API JSON RESPONSE:`);
            console.log(JSON.stringify(apiData, null, 2));
            console.log(`==========================================\n`);
        } catch (fetchErr) {
            console.error('Failed to fetch from external API:', fetchErr);
            apiData = { error: "Failed to fetch question from API.", details: fetchErr.message };
        }

        // Parse the Notebook JSON to inject the question
        let notebookJson = JSON.parse(templateContent);
        
        // --- 1. Inject Hidden Tracking Metadata ---
        // This is invisible to the student but readable by the LMS later!
        notebookJson.metadata.amypo = {
            student_google_id: user.id,
            allocation_id: allocationId,
            module_id: moduleId,
            question_id: queryParams.questionId,
            course_allocation_id: queryParams.course_allocation_id,
            test_type: queryParams.test_type,
            db: queryParams.db,
            topic_test_id: queryParams.topic_test_id,
            assessment_type: queryParams.assessmentType,
            generated_at: new Date().toISOString()
        };
        
        // --- 2. Inject the dynamic question response into the FIRST cell (index 0) ---
        if (apiData && apiData.data) {
            notebookJson.cells[0].source = [
                `# 🎓 Amypo Assessment\n`,
                `---\n`,
                `## ${apiData.data.title || 'Assignment'}\n`,
                `\n`,
                `${apiData.data.question || 'No question content provided.'}\n`,
                `\n`,
                `---\n`,
                `> **Instructions:** Write your solution in the code cell below. When finished, press **File → Save (Ctrl+S)**, then run the **Submit Assignment** cell at the bottom.\n`
            ];
            notebookJson.cells[0].metadata = { editable: false, deletable: false };

        } else {
            notebookJson.cells[0].source = [
                `## 🔬 Dynamic Assessment\n`,
                "\n",
                "**Data returned from API:**\n",
                "```json\n",
                `${JSON.stringify(apiData, null, 2)}\n`,
                "```\n"
            ];
            notebookJson.cells[0].metadata = { editable: false, deletable: false };
        }

        // --- 3. Inject Security Guard Cell (runs first, blocks cheating) ---
        const guardCell = {
            "cell_type": "code",
            "source": [
                "#@title 🔒 **EXAM MODE ACTIVATED** — Do not modify this cell { display-mode: \"form\" }\n",
                "#@markdown > This cell activates secure exam restrictions. **Do not delete or modify it.**\n",
                "\n",
                "import builtins as _b\n",
                "from IPython.display import display, HTML as _HTML\n",
                "\n",
                "# --- Block dangerous + AI modules ---\n",
                "_orig_import = _b.__import__\n",
                "_BLOCKED = {\n",
                "    'subprocess','shutil','pathlib','signal','ctypes','importlib',\n",
                "    'openai','anthropic','google.generativeai','genai',\n",
                "    'langchain','langchain_core','langchain_openai',\n",
                "    'transformers','huggingface_hub','cohere','replicate',\n",
                "    'bard','gemini','chatgpt'\n",
                "}\n",
                "def _safe_import(name, *args, **kwargs):\n",
                "    if name in _BLOCKED or any(name.startswith(b+'.') for b in _BLOCKED):\n",
                "        raise ImportError(f'⛔ Module \"{name}\" is blocked during exam mode. AI tools are not permitted.')\n",
                "    return _orig_import(name, *args, **kwargs)\n",
                "_b.__import__ = _safe_import\n",
                "\n",
                "# --- Block shell commands (!, %system, %sx) ---\n",
                "from IPython import get_ipython as _gi\n",
                "_ip = _gi()\n",
                "if _ip:\n",
                "    _ip.system = lambda *a, **k: print('⛔ Shell commands are disabled during exam mode.')\n",
                "\n",
                "# --- Show exam mode banner + tab detection + disable Colab AI ---\n",
                "display(_HTML('''\n",
                "<div style=\"background:linear-gradient(135deg,#312e81,#1e1b4b);padding:16px 24px;border-radius:12px;border:1px solid rgba(99,102,241,0.3);margin-bottom:8px\">\n",
                "  <div style=\"display:flex;align-items:center;gap:12px\">\n",
                "    <span style=\"font-size:24px\">🔒</span>\n",
                "    <div>\n",
                "      <div style=\"color:#e0e7ff;font-weight:700;font-size:15px\">Exam Mode Active</div>\n",
                "      <div style=\"color:#a5b4fc;font-size:13px\">AI tools, shell commands, and restricted modules are disabled.</div>\n",
                "    </div>\n",
                "    <div id=\"_tab_warn\" style=\"margin-left:auto;display:none;background:#ef4444;color:white;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600\">⚠️ Tab switches: <span id=\"_tab_count\">0</span></div>\n",
                "  </div>\n",
                "</div>\n",
                "<script>\n",
                "// --- Warn on close/navigate ---\n",
                "window.addEventListener(\"beforeunload\", function(e) {\n",
                "  e.preventDefault();\n",
                "  e.returnValue = \"You have an active exam. Are you sure you want to leave?\";\n",
                "  return e.returnValue;\n",
                "});\n",
                "\n",
                "// --- Detect tab switching ---\n",
                "var _tabSwitches = 0;\n",
                "document.addEventListener(\"visibilitychange\", function() {\n",
                "  if (document.hidden) {\n",
                "    _tabSwitches++;\n",
                "    var el = document.getElementById(\"_tab_count\");\n",
                "    var warn = document.getElementById(\"_tab_warn\");\n",
                "    if (el) el.textContent = _tabSwitches;\n",
                "    if (warn) warn.style.display = \"block\";\n",
                "    console.warn(\"⚠️ Tab switch detected! Count: \" + _tabSwitches);\n",
                "  }\n",
                "});\n",
                "\n",
                "// --- Disable Colab AI sidebar + hide cell controls + hide Gemini ---\n",
                "setTimeout(function() {\n",
                "  var style = document.createElement('style');\n",
                "  style.textContent = `\n",
                "    /* Hide Gemini AI button */\n",
                "    colab-ai-button, .colab-ai-button,\n",
                "    [data-p=\"AI\"], .colab-ai-sidebar, #colab-ai-button,\n",
                "    colab-recitation-button,\n",
                "    .gemini-button, [aria-label*=\"Gemini\"],\n",
                "    [aria-label*=\"AI\"], [aria-label*=\"assistant\"],\n",
                "    .gm-fab, .gm-floating-button,\n",
                "    div[style*=\"border-radius: 50%\"][style*=\"background\"][style*=\"position: fixed\"],\n",
                "    .colab-bottom-fab-container,\n",
                "    [class*=\"colab-ai\"], [id*=\"colab-ai\"],\n",
                "    .fab-container { display: none !important; visibility: hidden !important; }\n",
                "    /* Hide cell toolbar actions */\n",
                "    .cell-toolbar .cell-toolbar-actions { display: none !important; }\n",
                "    .add-cell { display: none !important; }\n",
                "    button[aria-label=\"Move cell up\"],\n",
                "    button[aria-label=\"Move cell down\"],\n",
                "    button[aria-label=\"Delete cell\"],\n",
                "    button[aria-label=\"More cell actions\"],\n",
                "    button[aria-label=\"Link to cell\"] { display: none !important; }\n",
                "    .cell-execution-container .buttonbar { pointer-events: auto !important; }\n",
                "  `;\n",
                "  document.head.appendChild(style);\n",
                "  // Also try to remove the element directly\n",
                "  document.querySelectorAll('colab-ai-button, .gm-fab, [class*=\"colab-ai\"]').forEach(function(el) { el.remove(); });\n",
                "}, 2000);\n",
                "</script>\n",
                "'''))\n"
            ],
            "metadata": { "editable": false, "deletable": false, "cellView": "form" },
            "outputs": [],
            "execution_count": null
        };
        // Insert after question cell (index 1)
        notebookJson.cells.splice(1, 0, guardCell);
        
        const appBaseUrl = process.env.BASE_URL || 'http://localhost:3000';
        
        // --- 4. Compute integrity hash of locked cells for tamper detection ---
        const questionContent = notebookJson.cells[0].source.join('');
        const integrityPayload = questionContent + user.id + allocationId + moduleId;
        const integrityHash = crypto.createHash('sha256')
            .update(normalizeForHash(integrityPayload))
            .digest('hex');

        // --- 5. Generate a stateless signed submission token (HMAC) ---
        const submissionPayload = `${user.id}:${allocationId}:${moduleId}:${integrityHash}`;
        const signature = crypto.createHmac('sha256', SUBMIT_SECRET)
            .update(submissionPayload)
            .digest('hex');
        const payloadHex = Buffer.from(submissionPayload).toString('hex');
        const submissionToken = `${payloadHex}.${signature}`;

        // Save active submission token to session for local submissions
        req.session.activeSubmissionToken = submissionToken;

        const submitUrl = `${appBaseUrl}/api/submit?t=${submissionToken}`;
        
        // --- 6. Inject SECURE Submit Code Cell (hidden via Colab Form View) ---
        const submitCell = {
            "cell_type": "code",
            "source": [
                "#@title 🚀 **SUBMIT ASSIGNMENT** — Click the ▶ Play button on the left to submit\n",
                "#@markdown > ⚠️ **Make sure you saved your work (Ctrl+S) before submitting!**\n",
                "\n",
                "from IPython.display import display, HTML as _H\n",
                "display(_H('''\n",
                "<div style=\"padding:24px;background:linear-gradient(135deg,#1e1b4b,#312e81);border-radius:16px;border:1px solid rgba(99,102,241,0.3);text-align:center;max-width:550px;margin:15px auto;box-shadow:0 10px 25px rgba(0,0,0,0.3)\">\n",
                "  <h2 style=\"color:#e0e7ff;margin-top:0;margin-bottom:8px;font-size:20px;font-weight:700\">Ready to Submit?</h2>\n",
                "  <p style=\"color:#c7d2fe;font-size:14px;margin-bottom:20px;line-height:1.6\">Make sure you have saved your work using <b>File → Save (Ctrl+S)</b>. Then, click the button below to submit your code directly to the portal:</p>\n",
                `  <a href="${submitUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#818cf8);color:white;padding:12px 32px;border-radius:100px;text-decoration:none;font-weight:700;font-size:15px;box-shadow:0 8px 20px rgba(99,102,241,0.4);border:1px solid rgba(255,255,255,0.1);transition:transform 0.2s">\n`,
                "    🚀 Submit My Assignment\n",
                "  </a>\n",
                "</div>\n",
                "'''))\n"
            ],
            "metadata": { "editable": false, "deletable": false, "cellView": "form" },
            "outputs": [],
            "execution_count": null
        };
        notebookJson.cells.push(submitCell);
        
        // Convert back to string
        templateContent = JSON.stringify(notebookJson, null, 2);

        // ==========================================
        //         UPLOAD NOTEBOOK TO DRIVE
        // ==========================================
        let fileId;
        const isMock = user.access_token === 'mock_access_token';

        if (isMock) {
            console.log('⚠️ Running in Mock Auth mode. Skipping real Google Drive upload.');
            fileId = '12j74WeMzckzwzglAFXFvNlMpkzk2Ae5W'; // Use a sample public Google Colab notebook ID
        } else {
            const authClient = driveService.createAuthClient(user.access_token, user.refresh_token);
                
            const uploadResult = await driveService.uploadNotebookToStudentDrive(authClient, templateContent, {
                userId: user.id,
                courseCode: "TEST",
                moduleCode: moduleId,
                questionCode: allocationId
            });
            
            fileId = uploadResult.fileId;
        }

        // Update tracking to indicate generation
        req.session.pendingTestQuery = null;

        const colabUrl = `https://colab.research.google.com/drive/${fileId}`;
        console.log(`✅ Redirecting to Colab: ${colabUrl}`);

        res.redirect(colabUrl);

    } catch (error) {
        console.error('❌ Error during test generation:', error);
        res.status(500).json({ error: 'Failed to generate test environment.' });
    }
});

router.get('/submit', async (req, res) => {
    try {
        const { t: submissionToken } = req.query;
        
        // 1. Validate the submission token
        if (!submissionToken) {
            return sendResponsePage(res, 'Access Denied', 'No submission token provided.', false);
        }

        let tokenData = validateSubmitToken(submissionToken);
        
        // Fallback to memory store for older sessions
        if (!tokenData) {
            global.validSubmitTokens = global.validSubmitTokens || {};
            const oldTokenData = global.validSubmitTokens[submissionToken];
            if (oldTokenData) {
                tokenData = {
                    studentId: oldTokenData.studentId,
                    allocationId: oldTokenData.allocationId,
                    moduleId: oldTokenData.moduleId,
                    integrityHash: oldTokenData.integrityHash
                };
            }
        }

        if (!tokenData) {
            return sendResponsePage(res, 'Access Denied', 'Invalid or expired submission token. Please start a new test environment from the portal.', false);
        }

        // Extract student info from the validated token (NOT from query params!)
        const { studentId: student_google_id, allocationId: allocation_id, moduleId: module_id, integrityHash } = tokenData;

        console.log(`\n📥 SECURE submission received!`);
        console.log(`   Token: ${submissionToken.substring(0, 12)}...`);
        console.log(`   Student: ${student_google_id} | Module: ${module_id} | Alloc: ${allocation_id}`);

        // 2. Look up the student's Google OAuth tokens from memory
        global.userTokens = global.userTokens || {};
        const user = global.userTokens[student_google_id];
        
        if (!user || !user.access_token) {
            console.error('❌ Could not find OAuth tokens for this student.');
            return sendResponsePage(res, 'Session Expired', 'Your session has expired. Please log in to the Amypo portal again.', false);
        }

        // 3. Setup Google Drive API
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({
            access_token: user.access_token,
            refresh_token: user.refresh_token
        });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        // 4. Search for the notebook file
        const notebookFilename = `${student_google_id}_TEST_${module_id}_${allocation_id}.ipynb`;
        const searchRes = await drive.files.list({
            q: `name = '${notebookFilename}' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        if (!searchRes.data.files || searchRes.data.files.length === 0) {
            return sendResponsePage(res, 'File Not Found', 'Notebook file not found in your Google Drive. Did you delete or rename it?', false);
        }

        const fileId = searchRes.data.files[0].id;
        console.log(`   Found Notebook in Drive! File ID: ${fileId}`);

        // 5. Download the notebook content
        const notebookData = await downloadNotebook(drive, fileId);



        console.log('DEBUG: notebookData type:', typeof notebookData);
        if (notebookData) {
            console.log('DEBUG: notebookData has cells:', !!notebookData.cells);
            if (notebookData.cells) {
                console.log('DEBUG: cells count:', notebookData.cells.length);
                notebookData.cells.forEach((cell, idx) => {
                    console.log(`DEBUG: Cell ${idx} type: ${cell.cell_type}, metadata:`, JSON.stringify(cell.metadata), `, source:`, JSON.stringify(cell.source));
                });
            }
        }

        // 6. Verify integrity — detect if student tampered with locked cells
        if (notebookData && notebookData.cells && integrityHash) {
            const questionCell = notebookData.cells.find(c => 
                c.cell_type === 'markdown' && 
                c.source && 
                (c.source.join('').includes('Amypo Assessment') || c.source.join('').includes('Dynamic Assessment'))
            ) || notebookData.cells.find(c => c.cell_type === 'markdown');
            const currentQuestion = questionCell ? questionCell.source.join('') : '';

            // 1. Check new stateless integrity format (question + metadata)
            const currentIntegrityPayload = currentQuestion + student_google_id + allocation_id + module_id;
            const currentHash = crypto.createHash('sha256')
                .update(normalizeForHash(currentIntegrityPayload))
                .digest('hex');

            // 2. Check old format for backward compatibility
            const oldSubmitCell = notebookData.cells.find(c => 
                c.cell_type === 'code' && 
                c.source && 
                c.source.join('').includes('SUBMIT ASSIGNMENT')
            );
            const oldSubmit = oldSubmitCell ? oldSubmitCell.source.join('') : '';
            const oldHash = crypto.createHash('sha256')
                .update(normalizeForHash(currentQuestion) + normalizeForHash(oldSubmit))
                .digest('hex');
            
            if (currentHash !== integrityHash && oldHash !== integrityHash) {
                console.error('⚠️ TAMPER DETECTED! Student modified locked cells.');
                return sendResponsePage(res, 'Submission Rejected', '⚠️ Tampering detected: Locked cells (question or submit code) were modified.', false);
            }
            console.log('   ✅ Integrity check passed — no tampering detected.');
        }
        
        // 7. Extract only the student's code (skip locked cells)
        let studentCode = '';
        if (notebookData && notebookData.cells) {
            const codeCells = notebookData.cells.filter(c => c.cell_type === 'code');
            for (const cell of codeCells) {
                const cellSource = cell.source ? cell.source.join('') : '';
                // Skip Guard Cell
                if (cellSource.includes('EXAM MODE ACTIVATED') || cellSource.includes('_safe_import')) {
                    continue;
                }
                // Skip Submit Cell
                if (cellSource.includes('SUBMIT ASSIGNMENT') || cellSource.includes('Submit My Assignment')) {
                    continue;
                }
                
                let cellOutput = '';
                if (cell.outputs && Array.isArray(cell.outputs)) {
                    for (const output of cell.outputs) {
                        if (output.output_type === 'stream' && output.text) {
                            cellOutput += (Array.isArray(output.text) ? output.text.join('') : output.text);
                        } else if ((output.output_type === 'execute_result' || output.output_type === 'display_data') && output.data && output.data['text/plain']) {
                            cellOutput += (Array.isArray(output.data['text/plain']) ? output.data['text/plain'].join('') : output.data['text/plain']) + '\n';
                        } else if (output.output_type === 'error' && output.traceback) {
                            // Strip ANSI escape codes from error tracebacks for clean saving
                            const rawTraceback = Array.isArray(output.traceback) ? output.traceback.join('\n') : output.traceback;
                            // eslint-disable-next-line no-control-regex
                            cellOutput += rawTraceback.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '') + '\n';
                        }
                    }
                }

                studentCode += cellSource + '\n';
                if (cellOutput.trim()) {
                    studentCode += '\n# --- EXECUTION OUTPUT ---\n';
                    studentCode += cellOutput.trim().split('\n').map(line => '# ' + line).join('\n') + '\n';
                }
                studentCode += '\n';
            }
            studentCode = studentCode.trim();
        }

        console.log(`\n================ STUDENT SUBMISSION CODE ================`);
        console.log(studentCode || "No code written!");
        console.log(`==========================================================\n`);

        // 7. Mark the token as USED so it cannot be reused
        tokenData.used = true;
        tokenData.submittedAt = new Date().toISOString();

        // 8. Save/Update the submission in our SQLite Database (Upsert)
        const existing = db.prepare('SELECT id FROM submissions WHERE studentId = ? AND moduleId = ? AND allocationId = ?').get(student_google_id, module_id, allocation_id);
        const timestamp = new Date().toLocaleString();

        if (existing) {
            db.prepare('UPDATE submissions SET code = ?, notebookId = ?, timestamp = ? WHERE id = ?')
              .run(studentCode, fileId, timestamp, existing.id);
            console.log(`   🔄 Updated existing submission for student ${student_google_id}`);
        } else {
            db.prepare('INSERT INTO submissions (studentId, allocationId, moduleId, timestamp, code, notebookId) VALUES (?, ?, ?, ?, ?, ?)')
              .run(student_google_id, allocation_id, module_id, timestamp, studentCode, fileId);
            console.log(`   📥 Saved new submission for student ${student_google_id}`);
        }

        // 9. Return success page
        return sendResponsePage(res, 'Submission Successful!', 'Your Google Colab notebook was downloaded successfully. Your code has been extracted and sent to your instructor.', true);

    } catch (err) {
        console.error('❌ Error during submission processing:', err);
        return sendResponsePage(res, 'Submission Failed', `An error occurred: ${err.message}`, false);
    }
});

/**
 * GET /api/active-test
 * Check if the current user session has an active test generated.
 */
router.get('/active-test', (req, res) => {
    if (req.session && req.session.activeSubmissionToken) {
        return res.json({ active: true });
    }
    res.json({ active: false });
});

/**
 * GET /api/submit-local
 * Downloads student's notebook directly from Google Drive, extracts code,
 * and records the submission. Triggered by a button on the local LMS portal.
 * Requires NO localtunnel/ngrok/public URL.
 */
router.get('/submit-local', async (req, res) => {
    try {
        // 1. Check if user is logged in
        if (!req.session || !req.session.user) {
            return res.status(401).json({ success: false, error: 'Unauthorized: No active session.' });
        }

        // 2. Check if there is an active test token in session
        const submissionToken = req.session.activeSubmissionToken;
        if (!submissionToken) {
            return res.status(400).json({ success: false, error: 'No active test found in session. Please click "Take Test Now" first.' });
        }

        let tokenData = validateSubmitToken(submissionToken);

        // Fallback to memory store for older sessions
        if (!tokenData) {
            global.validSubmitTokens = global.validSubmitTokens || {};
            const oldTokenData = global.validSubmitTokens[submissionToken];
            if (oldTokenData) {
                tokenData = {
                    studentId: oldTokenData.studentId,
                    allocationId: oldTokenData.allocationId,
                    moduleId: oldTokenData.moduleId,
                    integrityHash: oldTokenData.integrityHash
                };
            }
        }

        if (!tokenData) {
            return res.status(400).json({ success: false, error: 'Invalid or expired test token.' });
        }

        const { studentId: student_google_id, allocationId: allocation_id, moduleId: module_id, integrityHash } = tokenData;

        console.log(`\n📥 LOCAL submission received!`);
        console.log(`   Student: ${student_google_id} | Module: ${module_id} | Alloc: ${allocation_id}`);

        // 3. Setup Google Drive API using student credentials in session
        const user = req.session.user;
        if (!user || !user.access_token) {
            return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
        }

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({
            access_token: user.access_token,
            refresh_token: user.refresh_token
        });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        // 4. Search for the notebook file
        const notebookFilename = `${student_google_id}_TEST_${module_id}_${allocation_id}.ipynb`;
        const searchRes = await drive.files.list({
            q: `name = '${notebookFilename}' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        if (!searchRes.data.files || searchRes.data.files.length === 0) {
            return res.status(404).json({ success: false, error: 'Notebook file not found in your Google Drive. Did you delete or rename it?' });
        }

        const fileId = searchRes.data.files[0].id;
        console.log(`   Found Notebook in Drive! File ID: ${fileId}`);

        // 5. Download the notebook content
        const notebookData = await downloadNotebook(drive, fileId);

        // 6. Verify integrity — detect if student tampered with locked cells
        if (notebookData && notebookData.cells && integrityHash) {
            const questionCell = notebookData.cells.find(c => 
                c.cell_type === 'markdown' && 
                c.source && 
                (c.source.join('').includes('Amypo Assessment') || c.source.join('').includes('Dynamic Assessment'))
            ) || notebookData.cells.find(c => c.cell_type === 'markdown');
            const currentQuestion = questionCell ? questionCell.source.join('') : '';

            // 1. Check new stateless integrity format (question + metadata)
            const currentIntegrityPayload = currentQuestion + student_google_id + allocation_id + module_id;
            const currentHash = crypto.createHash('sha256')
                .update(normalizeForHash(currentIntegrityPayload))
                .digest('hex');

            // 2. Check old format for backward compatibility
            const oldSubmitCell = notebookData.cells.find(c => 
                c.cell_type === 'code' && 
                c.source && 
                c.source.join('').includes('SUBMIT ASSIGNMENT')
            );
            const oldSubmit = oldSubmitCell ? oldSubmitCell.source.join('') : '';
            const oldHash = crypto.createHash('sha256')
                .update(normalizeForHash(currentQuestion) + normalizeForHash(oldSubmit))
                .digest('hex');
            
            if (currentHash !== integrityHash && oldHash !== integrityHash) {
                console.error('⚠️ TAMPER DETECTED! Student modified locked cells.');
                return res.status(403).json({
                    success: false,
                    error: '⚠️ Submission Rejected: Tampering detected. Locked cells were modified.'
                });
            }
            console.log('   ✅ Integrity check passed — no tampering detected.');
        }

        // 7. Extract only the student's code (skip locked cells)
        let studentCode = '';
        if (notebookData && notebookData.cells) {
            const codeCells = notebookData.cells.filter(c => c.cell_type === 'code');
            for (const cell of codeCells) {
                const cellSource = cell.source ? cell.source.join('') : '';
                // Skip Guard Cell
                if (cellSource.includes('EXAM MODE ACTIVATED') || cellSource.includes('_safe_import')) {
                    continue;
                }
                // Skip Submit Cell
                if (cellSource.includes('SUBMIT ASSIGNMENT') || cellSource.includes('Submit My Assignment')) {
                    continue;
                }
                
                let cellOutput = '';
                if (cell.outputs && Array.isArray(cell.outputs)) {
                    for (const output of cell.outputs) {
                        if (output.output_type === 'stream' && output.text) {
                            cellOutput += (Array.isArray(output.text) ? output.text.join('') : output.text);
                        } else if ((output.output_type === 'execute_result' || output.output_type === 'display_data') && output.data && output.data['text/plain']) {
                            cellOutput += (Array.isArray(output.data['text/plain']) ? output.data['text/plain'].join('') : output.data['text/plain']) + '\n';
                        } else if (output.output_type === 'error' && output.traceback) {
                            // Strip ANSI escape codes from error tracebacks for clean saving
                            const rawTraceback = Array.isArray(output.traceback) ? output.traceback.join('\n') : output.traceback;
                            // eslint-disable-next-line no-control-regex
                            cellOutput += rawTraceback.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '') + '\n';
                        }
                    }
                }

                studentCode += cellSource + '\n';
                if (cellOutput.trim()) {
                    studentCode += '\n# --- EXECUTION OUTPUT ---\n';
                    studentCode += cellOutput.trim().split('\n').map(line => '# ' + line).join('\n') + '\n';
                }
                studentCode += '\n';
            }
            studentCode = studentCode.trim();
        }

        console.log(`\n================ STUDENT SUBMISSION CODE ================`);
        console.log(studentCode || "No code written!");
        console.log(`==========================================================\n`);

        // 8. Mark the token as USED
        tokenData.used = true;
        tokenData.submittedAt = new Date().toISOString();

        // 9. Save/Update the submission in our SQLite Database (Upsert)
        const existing = db.prepare('SELECT id FROM submissions WHERE studentId = ? AND moduleId = ? AND allocationId = ?').get(student_google_id, module_id, allocation_id);
        const timestamp = new Date().toLocaleString();

        if (existing) {
            db.prepare('UPDATE submissions SET code = ?, notebookId = ?, timestamp = ? WHERE id = ?')
              .run(studentCode, fileId, timestamp, existing.id);
            console.log(`   🔄 Updated existing submission for student ${student_google_id}`);
        } else {
            db.prepare('INSERT INTO submissions (studentId, allocationId, moduleId, timestamp, code, notebookId) VALUES (?, ?, ?, ?, ?, ?)')
              .run(student_google_id, allocation_id, module_id, timestamp, studentCode, fileId);
            console.log(`   📥 Saved new submission for student ${student_google_id}`);
        }

        // 10. Return success JSON
        res.json({
            success: true,
            message: 'Assignment submitted successfully!',
            studentId: student_google_id,
            moduleId: module_id
        });

    } catch (err) {
        console.error('❌ Error during local submission processing:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Render a styled HTML page for submission response messages.
 */
function sendResponsePage(res, title, message, isSuccess) {
    const icon = isSuccess ? '✓' : '✗';
    const themeColor = isSuccess ? '#22c55e' : '#ef4444';
    const bgGlow = isSuccess 
        ? 'radial-gradient(circle at 15% 50%, rgba(99, 102, 241, 0.15), transparent 25%)' 
        : 'radial-gradient(circle at 15% 50%, rgba(239, 68, 68, 0.1), transparent 25%)';
    const headerTitle = isSuccess ? 'Submission Successful' : 'Submission Failed';

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${headerTitle}</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #6366f1;
            --accent: #ec4899;
            --bg-color: #0f172a;
            --surface: rgba(30, 41, 59, 0.7);
            --text-main: #f8fafc;
        }
        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background-image: ${bgGlow};
            margin: 0;
        }
        .container {
            background: var(--surface);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 3rem;
            border-radius: 24px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            text-align: center;
            max-width: 500px;
            width: 90%;
        }
        .icon {
            width: 72px;
            height: 72px;
            background: ${isSuccess ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)'};
            border: 2px solid ${themeColor};
            color: ${themeColor};
            border-radius: 50%;
            display: inline-flex;
            justify-content: center;
            align-items: center;
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 1.5rem;
        }
        h1 {
            font-size: 1.75rem;
            font-weight: 700;
            margin-bottom: 1rem;
            color: #f8fafc;
        }
        p {
            color: #94a3b8;
            line-height: 1.6;
            margin-bottom: 2rem;
            font-size: 1rem;
        }
        .btn-portal {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: var(--primary);
            color: white;
            padding: 0.8rem 2rem;
            font-size: 1rem;
            font-weight: 600;
            text-decoration: none;
            border-radius: 100px;
            transition: all 0.2s;
        }
        .btn-portal:hover {
            transform: translateY(-2px);
            background: #4f46e5;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <a href="/dashboard" class="btn-portal">Go to Dashboard</a>
    </div>
</body>
</html>
    `);
}

/**
 * Downloads a file from Google Drive as a stream, buffers it to text,
 * and parses it to a JSON object.
 */
async function downloadNotebook(drive, fileId) {
    const fileRes = await drive.files.get(
        { fileId: fileId, alt: 'media' },
        { responseType: 'stream' }
    );

    let content = '';
    await new Promise((resolve, reject) => {
        fileRes.data
            .on('data', chunk => { content += chunk; })
            .on('end', () => resolve())
            .on('error', err => reject(err));
    });

    try {
        return JSON.parse(content);
    } catch (e) {
        console.error('Failed to parse notebook JSON:', e);
        throw new Error('Downloaded notebook content is not valid JSON.');
    }
}

/**
 * GET /api/download-code/:index
 * Serve the student's Python code as a downloadable .py file.
 */
router.get('/download-code/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(404).send('Invalid submission ID');
    
    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
    if (!sub) return res.status(404).send('Submission not found');
    
    const filename = `${sub.studentId}_code.py`;
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(sub.code);
});

/**
 * GET /api/download-notebook/:index
 * Serve the student's complete Google Colab notebook (.ipynb) as a download.
 */
router.get('/download-notebook/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(404).send('Invalid submission ID');
        
        const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
        if (!sub) return res.status(404).send('Submission not found');
        
        if (!sub.notebookId) {
            return res.status(400).send('Google Drive file ID not found for this submission');
        }

        // Setup Google Drive API using student credentials from global userTokens
        global.userTokens = global.userTokens || {};
        const user = global.userTokens[sub.studentId];
        
        if (!user || !user.access_token) {
            return res.status(400).send('OAuth credentials not found. The student session may have expired.');
        }

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({
            access_token: user.access_token,
            refresh_token: user.refresh_token
        });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        const fileRes = await drive.files.get(
            { fileId: sub.fileId, alt: 'media' },
            { responseType: 'stream' }
        );

        const filename = `${sub.studentId}_TEST_${sub.moduleId}_${sub.allocationId}.ipynb`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        fileRes.data.pipe(res);
    } catch (err) {
        console.error('Failed to download notebook:', err);
        res.status(500).send(`Failed to download notebook: ${err.message}`);
    }
});

module.exports = router;
