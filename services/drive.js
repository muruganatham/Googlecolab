/**
 * Google Drive service — handles notebook operations using student's OAuth tokens.
 */
const { google } = require('googleapis');
const { Readable } = require('stream');

/**
 * Create an OAuth2 client with the student's stored tokens.
 */
function createAuthClient(accessToken, refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
    });
    return oauth2Client;
}

/**
 * Copy a template notebook into the student's Google Drive.
 * Notebook naming convention: {user_id}_{course_code}_{module_code}_{question_code}.ipynb
 *
 * @param {object} authClient - OAuth2 client with student's tokens
 * @param {string} templateFileId - Drive file ID of the template notebook
 * @param {object} naming - { userId, courseCode, moduleCode, questionCode }
 * @returns {object} - { fileId, fileName, webViewLink }
 */
async function copyTemplateToStudentDrive(authClient, templateFileId, naming) {
    const drive = google.drive({ version: 'v3', auth: authClient });

    const fileName = `${naming.userId}_${naming.courseCode}_${naming.moduleCode}_${naming.questionCode}.ipynb`;

    const response = await drive.files.copy({
        fileId: templateFileId,
        requestBody: {
            name: fileName
        },
        fields: 'id, name, webViewLink'
    });

    return {
        fileId: response.data.id,
        fileName: response.data.name,
        webViewLink: response.data.webViewLink
    };
}

/**
 * Download the .ipynb content from the student's Drive.
 */
async function getNotebookContent(authClient, fileId) {
    const drive = google.drive({ version: 'v3', auth: authClient });

    const response = await drive.files.get({
        fileId: fileId,
        alt: 'media'
    });

    return response.data;
}

/**
 * Get file metadata from Drive.
 */
async function getFileMetadata(authClient, fileId) {
    const drive = google.drive({ version: 'v3', auth: authClient });

    const response = await drive.files.get({
        fileId: fileId,
        fields: 'id, name, mimeType, modifiedTime, size, webViewLink'
    });

    return response.data;
}

/**
 * Generate a Google Colab URL for a given Drive file ID.
 */
function generateColabUrl(fileId) {
    return `https://colab.research.google.com/drive/${fileId}`;
}

/**
 * Inject student-specific metadata into a notebook before copying.
 * This modifies the first cell of the notebook to include student info
 * and LMS callback details.
 */
function generateNotebookMetadata(studentId, assignmentId, studentName, assignmentTitle, lmsCallbackUrl) {
    return {
        STUDENT_ID: studentId,
        ASSIGNMENT_ID: assignmentId,
        STUDENT_NAME: studentName,
        ASSIGNMENT_TITLE: assignmentTitle,
        LMS_CALLBACK_URL: lmsCallbackUrl
    };
}

/**
 * Upload a customized notebook file directly to the student's Google Drive.
 */
async function uploadNotebookToStudentDrive(authClient, notebookContentString, naming) {
    const drive = google.drive({ version: 'v3', auth: authClient });
    const fileName = `${naming.userId}_${naming.courseCode}_${naming.moduleCode}_${naming.questionCode}.ipynb`;

    try {
        // Search if file already exists
        const searchRes = await drive.files.list({
            q: `name = '${fileName}' and trashed = false`,
            fields: 'files(id, name, webViewLink)',
            spaces: 'drive'
        });

        if (searchRes.data.files && searchRes.data.files.length > 0) {
            const fileId = searchRes.data.files[0].id;
            console.log(`   🔄 File '${fileName}' already exists in student Drive. Updating content. ID: ${fileId}`);
            
            const response = await drive.files.update({
                fileId: fileId,
                media: {
                    mimeType: 'application/x-ipynb+json',
                    body: Readable.from([notebookContentString])
                },
                fields: 'id, name, webViewLink'
            });

            // Share the updated file so the teacher/HR dashboard can view it
            try {
                await drive.permissions.create({
                    fileId: fileId,
                    requestBody: {
                        role: 'reader',
                        type: 'anyone'
                    }
                });
                console.log(`   🔓 Shared file ${fileId} with 'anyone' (reader)`);
            } catch (permErr) {
                console.warn(`   ⚠️ Warning: Could not share updated file:`, permErr.message);
            }

            return {
                fileId: response.data.id,
                fileName: response.data.name,
                webViewLink: response.data.webViewLink
            };
        }
    } catch (err) {
        console.error(`⚠️ Failed to search for existing file in Drive, proceeding to create new:`, err);
    }

    console.log(`   🆕 File '${fileName}' does not exist in student Drive. Creating a new one.`);
    const response = await drive.files.create({
        requestBody: {
            name: fileName,
            mimeType: 'application/x-ipynb+json'
        },
        media: {
            mimeType: 'application/x-ipynb+json',
            body: Readable.from([notebookContentString])
        },
        fields: 'id, name, webViewLink'
    });

    const newFileId = response.data.id;
    // Share the new file so the teacher/HR dashboard can view it
    try {
        await drive.permissions.create({
            fileId: newFileId,
            requestBody: {
                role: 'reader',
                type: 'anyone'
            }
        });
        console.log(`   🔓 Shared new file ${newFileId} with 'anyone' (reader)`);
    } catch (permErr) {
        console.warn(`   ⚠️ Warning: Could not share new file:`, permErr.message);
    }

    return {
        fileId: newFileId,
        fileName: response.data.name,
        webViewLink: response.data.webViewLink
    };
}

module.exports = {
    createAuthClient,
    copyTemplateToStudentDrive,
    getNotebookContent,
    getFileMetadata,
    generateColabUrl,
    generateNotebookMetadata,
    uploadNotebookToStudentDrive
};
