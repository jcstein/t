import CryptoJS from 'crypto-js';

// API Configuration
// The API key will be injected during GitHub Actions build
const TWINKLE_API_KEY = 'wUgjkHpAR9u3q7zAFViM+w==';
const TWINKLE_API_BASE = 'https://t.tech/v0';
const NETWORK = 'mocha-4';
const NAMESPACE_HEX = '62756c6c6574696e2d626f617264000000'; // "bulletin-board" in hex (20 chars)
const NAMESPACE_BASE64 = 'YnVsbGV0aW4tYm9hcmQAAAAA'; // same namespace in base64

// Store encrypted and decrypted messages
let encryptedBlobs = [];
let decryptedMessages = [];
let currentPasskey = '';

// Utility functions
function stringToHex(str) {
    return Array.from(str)
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');
}

function hexToString(hex) {
    const bytes = hex.match(/.{1,2}/g) || [];
    return bytes.map(byte => String.fromCharCode(parseInt(byte, 16))).join('');
}

function base64ToHex(base64) {
    const binary = atob(base64);
    return Array.from(binary)
        .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');
}

// Encryption functions
function encryptMessage(messageData, passkey) {
    try {
        const jsonString = JSON.stringify(messageData);
        const encrypted = CryptoJS.AES.encrypt(jsonString, passkey).toString();
        return encrypted;
    } catch (error) {
        console.error('Encryption error:', error);
        throw new Error('Failed to encrypt message');
    }
}

function decryptMessage(encryptedData, passkey) {
    try {
        const decrypted = CryptoJS.AES.decrypt(encryptedData, passkey);
        const jsonString = decrypted.toString(CryptoJS.enc.Utf8);

        if (!jsonString) {
            return null; // Decryption failed (wrong passkey)
        }

        return JSON.parse(jsonString);
    } catch (error) {
        return null; // Decryption failed
    }
}

// Post an encrypted message to Celestia
async function postEncryptedMessage(author, message, passkey) {
    const messageData = {
        author: author,
        message: message,
        timestamp: new Date().toISOString()
    };

    // Encrypt the entire message data
    const encryptedData = encryptMessage(messageData, passkey);

    // Convert encrypted string to hex
    const dataHex = stringToHex(encryptedData);

    try {
        const response = await fetch(`${TWINKLE_API_BASE}/blob`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TWINKLE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                namespace: NAMESPACE_HEX,
                data: dataHex,
                network: NETWORK
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to post: ${response.status} - ${errorData}`);
        }

        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Error posting message:', error);
        throw error;
    }
}

// Retrieve encrypted blobs from Celestia
async function retrieveEncryptedBlobs() {
    try {
        const response = await fetch(
            `${TWINKLE_API_BASE}/namespace/blobs?namespace=${encodeURIComponent(NAMESPACE_BASE64)}&network=${NETWORK}`,
            {
                headers: {
                    'Authorization': `Bearer ${TWINKLE_API_KEY}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to retrieve blobs: ${response.status}`);
        }

        const data = await response.json();
        const blobs = data.blobs || [];

        // Store encrypted blobs
        encryptedBlobs = blobs.map(blob => ({
            data: blob.data,
            height: blob.height,
            commitment: blob.commitment
        }));

        return encryptedBlobs;
    } catch (error) {
        console.error('Error retrieving blobs:', error);
        return [];
    }
}

// Decrypt all blobs with the given passkey
function decryptBlobs(blobs, passkey) {
    const decrypted = [];

    for (const blob of blobs) {
        try {
            // Convert base64 blob data to hex, then to string
            const hexData = base64ToHex(blob.data);
            const encryptedString = hexToString(hexData);

            // Try to decrypt
            const messageData = decryptMessage(encryptedString, passkey);

            if (messageData) {
                decrypted.push({
                    ...messageData,
                    blockHeight: blob.height,
                    commitment: blob.commitment
                });
            }
        } catch (e) {
            // Skip blobs that fail to decrypt
            console.debug('Failed to decrypt blob:', e);
        }
    }

    // Sort by timestamp, newest first
    decrypted.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return decrypted;
}

// Display messages
function displayMessages(messages, isDecrypted = false) {
    const messagesList = document.getElementById('messagesList');

    if (!isDecrypted) {
        messagesList.innerHTML = '<div class="encrypted-notice">🔒 Messages are encrypted. Enter your passkey to decrypt and view them.</div>';
        return;
    }

    if (messages.length === 0) {
        messagesList.innerHTML = '<div class="no-messages">No messages found with this passkey. Try a different passkey or post a new message!</div>';
        return;
    }

    messagesList.innerHTML = messages.map(msg => `
        <div class="message-card">
            <div class="message-header">
                <span class="message-author">${escapeHtml(msg.author)}</span>
                <span class="message-time">${formatTimestamp(msg.timestamp)}</span>
            </div>
            <div class="message-content">${escapeHtml(msg.message)}</div>
            <div class="message-footer">
                <small>Block: ${msg.blockHeight || 'pending'}</small>
            </div>
        </div>
    `).join('');
}

// Helper functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
}

function showStatus(message, isError = false) {
    const statusEl = document.getElementById('postStatus');
    statusEl.textContent = message;
    statusEl.className = `status-message ${isError ? 'error' : 'success'}`;
    statusEl.style.display = 'block';

    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 5000);
}

// Event handlers
document.addEventListener('DOMContentLoaded', () => {
    // Post form submission
    document.getElementById('postForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const passkey = document.getElementById('passkey').value;
        const author = document.getElementById('author').value.trim() || 'Anonymous';
        const message = document.getElementById('message').value.trim();
        const submitBtn = document.getElementById('submitBtn');

        if (!message || !passkey) return;

        submitBtn.disabled = true;
        submitBtn.textContent = '🔒 Encrypting & Posting...';

        try {
            await postEncryptedMessage(author, message, passkey);
            showStatus('✅ Message encrypted and posted to Celestia!');

            // Clear form (except passkey, user might want to post again)
            document.getElementById('author').value = '';
            document.getElementById('message').value = '';

            // If they're using the same passkey, refresh decrypted messages
            const decryptPasskey = document.getElementById('decryptPasskey').value;
            if (decryptPasskey === passkey) {
                setTimeout(() => loadAndDecryptMessages(decryptPasskey), 3000);
            }
        } catch (error) {
            showStatus(`❌ Failed to post: ${error.message}`, true);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '🔒 Encrypt & Post to Celestia';
        }
    });

    // Decrypt button
    document.getElementById('decryptBtn').addEventListener('click', async () => {
        const passkey = document.getElementById('decryptPasskey').value;
        if (!passkey) {
            alert('Please enter a passkey');
            return;
        }

        currentPasskey = passkey;
        await loadAndDecryptMessages(passkey);
    });

    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        const passkey = document.getElementById('decryptPasskey').value;
        if (passkey) {
            await loadAndDecryptMessages(passkey);
        } else {
            await loadEncryptedBlobs();
        }
    });

    // Allow Enter key in decrypt passkey field
    document.getElementById('decryptPasskey').addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            document.getElementById('decryptBtn').click();
        }
    });

    // Initial load
    loadEncryptedBlobs();
});

// Load encrypted blobs
async function loadEncryptedBlobs() {
    const loadingSpinner = document.getElementById('loadingSpinner');
    const messagesList = document.getElementById('messagesList');

    loadingSpinner.style.display = 'block';
    messagesList.style.display = 'none';

    try {
        await retrieveEncryptedBlobs();
        displayMessages([], false);
    } catch (error) {
        messagesList.innerHTML = '<div class="error-message">Failed to load messages. Please try again.</div>';
    } finally {
        loadingSpinner.style.display = 'none';
        messagesList.style.display = 'block';
    }
}

// Load and decrypt messages with passkey
async function loadAndDecryptMessages(passkey) {
    const loadingSpinner = document.getElementById('loadingSpinner');
    const messagesList = document.getElementById('messagesList');
    const decryptBtn = document.getElementById('decryptBtn');

    loadingSpinner.style.display = 'block';
    messagesList.style.display = 'none';
    decryptBtn.disabled = true;
    decryptBtn.textContent = '🔓 Decrypting...';

    try {
        // Fetch latest blobs
        await retrieveEncryptedBlobs();

        // Try to decrypt with passkey
        decryptedMessages = decryptBlobs(encryptedBlobs, passkey);

        displayMessages(decryptedMessages, true);
    } catch (error) {
        messagesList.innerHTML = '<div class="error-message">Failed to decrypt messages. Please try again.</div>';
    } finally {
        loadingSpinner.style.display = 'none';
        messagesList.style.display = 'block';
        decryptBtn.disabled = false;
        decryptBtn.textContent = '🔓 Decrypt';
    }
}
