/**
 * Google OAuth 2.0 authentication routes.
 */
const express = require('express');
const { google } = require('googleapis');

const router = express.Router();

// Scopes: openid for login, email/profile for user info, drive.file for notebook access
const SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive.file'
];

function getOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

/**
 * GET /auth/google — Redirect to Google's consent screen.
 */
router.get('/google', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const isMock = !clientId || clientId === 'your_client_id_here' || req.query.mock === 'true';

    if (isMock) {
        return res.redirect(`/auth/google/callback?mock=true`);
    }

    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
        include_granted_scopes: true
    });
    res.redirect(authUrl);
});

/**
 * GET /auth/google/callback — Handle the OAuth callback, create/update user, start session.
 */
router.get('/google/callback', async (req, res) => {
    const { code, error, mock } = req.query;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const isMock = mock === 'true' || !clientId || clientId === 'your_client_id_here';

    if (isMock) {
        try {
            const user = {
                id: 'mock_user_123',
                email: 'student@lms-colab.com',
                name: 'Mock Student',
                avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
                access_token: 'mock_access_token',
                refresh_token: 'mock_refresh_token'
            };

            // Create session without DB
            req.session.user = user;

            console.log(`✅ Mock User logged in: ${user.name} (${user.email})`);

            // Redirect to pending test if exists
            if (req.session.pendingTestQuery) {
                const qs = new URLSearchParams(req.session.pendingTestQuery).toString();
                return res.redirect(`/api/take-test?${qs}`);
            }
            return res.redirect('/');
        } catch (err) {
            console.error('Mock login error:', err);
            return res.redirect('/?error=auth_failed');
        }
    }

    if (error) {
        console.error('OAuth error:', error);
        return res.redirect('/?error=auth_denied');
    }

    if (!code) {
        return res.redirect('/?error=no_code');
    }

    try {
        const oauth2Client = getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get user info from Google
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data: userInfo } = await oauth2.userinfo.get();

        // Create session without DB
        const user = {
            id: userInfo.id,
            email: userInfo.email,
            name: userInfo.name,
            avatar_url: userInfo.picture,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || null
        };
        req.session.user = user;
        
        // Save globally so the Colab webhook can fetch the notebook later without a session
        global.userTokens = global.userTokens || {};
        global.userTokens[user.id] = user;

        console.log(`✅ User logged in: ${userInfo.name} (${userInfo.email})`);

        // Redirect to pending test if exists
        if (req.session.pendingTestQuery) {
            const qs = new URLSearchParams(req.session.pendingTestQuery).toString();
            return res.redirect(`/api/take-test?${qs}`);
        }
        return res.redirect('/');
    } catch (err) {
        console.error('OAuth callback error:', err);
        res.redirect('/?error=auth_failed');
    }
});

/**
 * GET /auth/logout — Destroy session and redirect to login.
 */
router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

/**
 * GET /auth/me — Return current user info (JSON).
 */
router.get('/me', (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ authenticated: false });
    }
    const user = req.session.user;
    res.json({
        authenticated: true,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            avatar_url: user.avatar_url,
            is_mock: user.access_token === 'mock_access_token'
        }
    });
});

module.exports = router;
