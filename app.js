// Configuration
const NETWORK = 'mocha-4';
const NAMESPACE = '0000007477696e6b6c65'; // "twinkle" in hex (10 bytes)

// Supabase config - replaced by Netlify build
const SUPABASE_URL = 'PLACEHOLDER_SUPABASE_URL';
const SUPABASE_KEY = 'PLACEHOLDER_SUPABASE_ANON_KEY';

// Initialize Supabase client
let supabase = null;
let currentUser = null; // Store signed-in user's credential ID

if (typeof window !== 'undefined' && window.supabase && SUPABASE_URL && SUPABASE_KEY &&
    SUPABASE_URL !== 'PLACEHOLDER_SUPABASE_URL') {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

// State
let selectedFile = null;
let currentTab = 'text';
let authMode = 'biometric'; // 'biometric' or 'password'
let retrieveAuthMode = 'biometric';
let encryptionKey = null; // Will be set after biometric auth
let credentialId = null;

// Utils
function stringToHex(str) {
    return Array.from(str)
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');
}

function hexToString(hex) {
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
}

// Encryption/Decryption using AES
function encryptData(data, passkey) {
    return CryptoJS.AES.encrypt(data, passkey).toString();
}

function decryptData(encryptedData, passkey) {
    try {
        const bytes = CryptoJS.AES.decrypt(encryptedData, passkey);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        if (!decrypted) {
            throw new Error('Decryption failed');
        }
        return decrypted;
    } catch (e) {
        throw new Error('Wrong passkey or corrupted data');
    }
}

// WebAuthn Passkey functions
async function isWebAuthnSupported() {
    return window.PublicKeyCredential !== undefined &&
           navigator.credentials !== undefined;
}

async function registerPasskey() {
    if (!await isWebAuthnSupported()) {
        showStatus('Biometric authentication not supported on this device', true);
        return false;
    }

    try {
        // Generate a random challenge
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);

        // Create credential options
        const createCredentialOptions = {
            publicKey: {
                challenge: challenge,
                rp: {
                    name: "Celestia Bulletin Board",
                    id: window.location.hostname
                },
                user: {
                    id: new Uint8Array(16),
                    name: "user@celestia-bulletin",
                    displayName: "Celestia User"
                },
                pubKeyCredParams: [{alg: -7, type: "public-key"}],
                authenticatorSelection: {
                    authenticatorAttachment: "platform",
                    userVerification: "required"
                },
                timeout: 60000,
                attestation: "none"
            }
        };

        // Create the credential
        const credential = await navigator.credentials.create(createCredentialOptions);

        if (!credential) {
            throw new Error('Failed to create credential');
        }

        // Generate encryption key
        const generatedKey = CryptoJS.lib.WordArray.random(256/8).toString();

        // Store credential ID and encryption key
        credentialId = Array.from(new Uint8Array(credential.rawId))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        localStorage.setItem('credentialId', credentialId);
        localStorage.setItem('encryptionKey', generatedKey);

        encryptionKey = generatedKey;

        return true;
    } catch (error) {
        console.error('Passkey registration error:', error);
        showStatus(`Failed to register biometric: ${error.message}`, true);
        return false;
    }
}

async function authenticatePasskey() {
    if (!await isWebAuthnSupported()) {
        showStatus('Biometric authentication not supported on this device', true);
        return false;
    }

    const storedCredentialId = localStorage.getItem('credentialId');
    if (!storedCredentialId) {
        showStatus('No biometric set up. Please set up biometric first.', true);
        return false;
    }

    try {
        // Generate a random challenge
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);

        // Convert stored credential ID back to bytes
        const credentialIdBytes = new Uint8Array(
            storedCredentialId.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );

        // Get credential options
        const getCredentialOptions = {
            publicKey: {
                challenge: challenge,
                allowCredentials: [{
                    id: credentialIdBytes,
                    type: 'public-key',
                    transports: ['internal']
                }],
                timeout: 60000,
                userVerification: "required"
            }
        };

        // Authenticate
        const assertion = await navigator.credentials.get(getCredentialOptions);

        if (!assertion) {
            throw new Error('Authentication failed');
        }

        // Retrieve encryption key
        encryptionKey = localStorage.getItem('encryptionKey');

        if (!encryptionKey) {
            throw new Error('Encryption key not found');
        }

        return true;
    } catch (error) {
        console.error('Passkey authentication error:', error);
        showStatus(`Authentication failed: ${error.message}`, true);
        return false;
    }
}

function arrayBufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToArrayBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes.buffer;
}

function decodeNamespace(hexNamespace) {
    // Remove trailing zeros and decode
    const cleaned = hexNamespace.replace(/0+$/, '');
    if (cleaned.length === 0) return hexNamespace;
    try {
        return hexToString(cleaned);
    } catch {
        return hexNamespace;
    }
}

function showStatus(message, isError = false) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = isError ? 'error' : 'success';
    status.style.display = 'block';

    setTimeout(() => {
        status.style.display = 'none';
    }, 5000);
}

function showRetrieveStatus(message, isError = false) {
    const status = document.getElementById('retrieveStatus');
    status.textContent = message;
    status.className = isError ? 'error' : 'success';
    status.style.display = 'block';

    setTimeout(() => {
        status.style.display = 'none';
    }, 5000);
}

// Supabase functions
async function signInWithPasskey() {
    if (!await isWebAuthnSupported()) {
        showStatus('Passkey authentication not supported on this device', true);
        return false;
    }

    const storedCredentialId = localStorage.getItem('credentialId');

    // If no passkey exists, create one (register)
    if (!storedCredentialId) {
        const success = await registerPasskey();
        if (success) {
            currentUser = credentialId;
            showStatus('✅ Signed in with passkey!');
            await loadHistory();
            updateUI();
        }
        return success;
    }

    // If passkey exists, authenticate
    const success = await authenticatePasskey();
    if (success) {
        currentUser = storedCredentialId;
        credentialId = storedCredentialId;
        showStatus('✅ Signed in with passkey!');
        await loadHistory();
        updateUI();
    }
    return success;
}

async function saveToSupabase(result, contentType, originalContent) {
    if (!supabase || !currentUser) {
        return;
    }

    try {
        const { error } = await supabase
            .from('posts')
            .insert([{
                credential_id: currentUser,
                content_type: contentType,
                encrypted_content: originalContent,
                block_height: result.blockHeight,
                tx_id: result.celestiaTransactionId,
                commitment: result.commitment,
                gas_fee_cents: result.gasFeeUsdCents,
                twinkle_request_id: result.twinkleRequestId,
                block_explorer_tx_url: result.blockExplorer.transaction,
                block_explorer_block_url: result.blockExplorer.block
            }]);

        if (error) {
            console.error('Error saving to Supabase:', error);
        } else {
            await loadHistory();
        }
    } catch (error) {
        console.error('Error saving to Supabase:', error);
    }
}

async function loadHistory() {
    if (!supabase || !currentUser) {
        return;
    }

    const historySection = document.getElementById('historySection');
    const historyLoading = document.getElementById('historyLoading');
    const historyContent = document.getElementById('historyContent');
    const historyEmpty = document.getElementById('historyEmpty');

    historySection.style.display = 'block';
    historyLoading.style.display = 'block';
    historyContent.innerHTML = '';
    historyEmpty.style.display = 'none';

    try {
        const { data, error } = await supabase
            .from('posts')
            .select('*')
            .eq('credential_id', currentUser)
            .order('created_at', { ascending: false });

        historyLoading.style.display = 'none';

        if (error) {
            console.error('Error loading history:', error);
            return;
        }

        if (!data || data.length === 0) {
            historyEmpty.style.display = 'block';
            return;
        }

        displayHistory(data);
    } catch (error) {
        console.error('Error loading history:', error);
        historyLoading.style.display = 'none';
    }
}

function displayHistory(posts) {
    const historyContent = document.getElementById('historyContent');
    historyContent.innerHTML = '';

    posts.forEach(post => {
        const card = document.createElement('div');
        card.className = 'history-card';

        const date = new Date(post.created_at).toLocaleString();
        const contentPreview = post.content_type === 'text' ? '📝 Text message' : '🖼️ Image';

        card.innerHTML = `
            <div class="history-card-header">
                <span class="history-type">${contentPreview}</span>
                <span class="history-date">${date}</span>
            </div>
            <div class="history-card-body">
                <div class="history-field">
                    <strong>Block Height:</strong> ${post.block_height}
                </div>
                <div class="history-field">
                    <strong>Transaction ID:</strong>
                    <a href="${post.block_explorer_tx_url}" target="_blank" rel="noopener">
                        ${post.tx_id.substring(0, 16)}...
                    </a>
                </div>
                <div class="history-field">
                    <strong>Commitment:</strong>
                    <code class="commitment-code">${post.commitment}</code>
                </div>
                <div class="history-actions">
                    <button class="history-btn" onclick="loadPostToRetrieve('${post.block_height}', '${post.commitment}')">
                        🔍 Retrieve This
                    </button>
                    <a href="${post.block_explorer_tx_url}" target="_blank" rel="noopener" class="history-btn">
                        🔗 View on Explorer
                    </a>
                </div>
            </div>
        `;

        historyContent.appendChild(card);
    });
}

function loadPostToRetrieve(blockHeight, commitment) {
    document.getElementById('heightInput').value = blockHeight;
    document.getElementById('commitmentInput').value = commitment;
    document.querySelector('.retrieve-section').scrollIntoView({ behavior: 'smooth' });
}

async function postMessage() {
    const btn = document.getElementById('postBtn');
    const resultSection = document.getElementById('resultSection');
    let passkey;
    let dataHex;
    let contentType = 'text';

    // Get passkey based on auth mode
    if (authMode === 'biometric') {
        if (!encryptionKey) {
            showStatus('Please unlock with biometric first', true);
            return;
        }
        passkey = encryptionKey;
    } else {
        const passkeyInput = document.getElementById('passkeyInput');
        passkey = passkeyInput.value.trim();

        if (!passkey) {
            showStatus('Please enter a password to encrypt your data', true);
            passkeyInput.focus();
            return;
        }
    }

    // Determine what we're posting
    if (currentTab === 'text') {
        const textarea = document.getElementById('messageInput');
        const message = textarea.value.trim();

        if (!message) {
            showStatus('Please enter a message', true);
            return;
        }

        // Encrypt then prefix with "TEXT:" for type detection
        const encrypted = encryptData(message, passkey);
        dataHex = stringToHex('TEXT:' + encrypted);
    } else {
        // Image tab
        if (!selectedFile) {
            showStatus('Please select an image', true);
            return;
        }

        // Show loading state early for images
        btn.disabled = true;
        btn.innerHTML = '⏳ Processing image...';
        showStatus('⏳ Processing your image...');

        try {
            const arrayBuffer = await selectedFile.arrayBuffer();
            const imageHex = arrayBufferToHex(arrayBuffer);
            // Encrypt the hex string
            const encrypted = encryptData(imageHex, passkey);
            // Prefix with content type for proper retrieval
            dataHex = stringToHex(`IMG:${selectedFile.type}:`) + stringToHex(encrypted);
            contentType = 'image';
        } catch (error) {
            console.error('Error processing image:', error);
            showStatus(`❌ Failed to process image: ${error.message}`, true);
            btn.disabled = false;
            btn.innerHTML = 'Post to Celestia';
            return;
        }
    }

    // Hide previous results
    resultSection.style.display = 'none';

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '⏳ Posting to Celestia...';
    showStatus('⏳ Posting to Celestia...');

    try {
        const response = await fetch('/.netlify/functions/twinkle', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                namespace: NAMESPACE,
                data: dataHex,
                network: NETWORK
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.details || errorData.error || errorData.message || `HTTP ${response.status}`;
            console.error('POST error details:', errorData);
            throw new Error(errorMsg);
        }

        const result = await response.json();

        // Display result
        displayResult(result, contentType);

        // Save to Supabase if signed in
        if (currentUser) {
            const originalContent = currentTab === 'text' ?
                document.getElementById('messageInput').value.trim() :
                '';
            await saveToSupabase(result, contentType, originalContent);
        }

        // Store passkey in session for convenience
        sessionStorage.setItem('passkey', passkey);

        // Clear inputs
        if (currentTab === 'text') {
            document.getElementById('messageInput').value = '';
        } else {
            clearFileSelection();
        }
        // Don't clear passkey - keep it for retrieval

        showStatus('✅ Posted successfully!');

    } catch (error) {
        console.error('Error:', error);
        showStatus(`❌ Failed: ${error.message}`, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Post to Celestia';
    }
}

function displayResult(result, message) {
    const section = document.getElementById('resultSection');
    section.style.display = 'block';

    document.getElementById('blockHeight').textContent = result.blockHeight;
    document.getElementById('commitment').textContent = result.commitment;
    document.getElementById('gasFee').textContent = `$${(result.gasFeeUsdCents / 100).toFixed(2)}`;
    document.getElementById('requestId').textContent = result.twinkleRequestId;

    const txId = result.celestiaTransactionId;
    const txLink = document.getElementById('txLink');
    txLink.textContent = `${txId.substring(0, 16)}...`;
    txLink.href = result.blockExplorer.transaction;

    document.getElementById('txExplorer').href = result.blockExplorer.transaction;
    document.getElementById('blockExplorer').href = result.blockExplorer.block;

    // Pre-fill retrieve form for easy testing
    // Commitment from POST is already in base64 format (exactly what GET needs)
    document.getElementById('heightInput').value = result.blockHeight;
    document.getElementById('commitmentInput').value = result.commitment;

    // Scroll to result
    section.scrollIntoView({ behavior: 'smooth' });
}

async function retrieveBlob() {
    const heightInput = document.getElementById('heightInput');
    const commitmentInput = document.getElementById('commitmentInput');
    const height = heightInput.value.trim();
    const commitment = commitmentInput.value.trim();
    let passkey;
    const btn = document.getElementById('retrieveBtn');
    const retrievedSection = document.getElementById('retrievedSection');

    if (!height || !commitment) {
        showRetrieveStatus('Please enter both block height and commitment', true);
        return;
    }

    // Get passkey based on auth mode
    if (retrieveAuthMode === 'biometric') {
        if (!encryptionKey) {
            showRetrieveStatus('Please unlock with biometric first', true);
            return;
        }
        passkey = encryptionKey;
    } else {
        const passkeyInput = document.getElementById('retrievePasskeyInput');
        passkey = passkeyInput.value.trim();

        if (!passkey) {
            showRetrieveStatus('Please enter the password to decrypt', true);
            passkeyInput.focus();
            return;
        }
    }

    // Hide previous results
    retrievedSection.style.display = 'none';

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '⏳ Retrieving blob...';
    showRetrieveStatus('⏳ Retrieving blob from Celestia...');

    try {
        const response = await fetch(
            `/.netlify/functions/twinkle?height=${height}&namespace=${NAMESPACE}&commitment=${encodeURIComponent(commitment)}&network=${NETWORK}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.message || errorData.error || `HTTP ${response.status}`;
            throw new Error(`${errorMsg}`);
        }

        const result = await response.json();

        // Display retrieved blob
        displayRetrievedBlob(result, height, commitment, passkey);
        showRetrieveStatus('✅ Blob retrieved and decrypted successfully!');

    } catch (error) {
        console.error('Error:', error);
        showRetrieveStatus(`❌ Failed: ${error.message}`, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Retrieve Blob';
    }
}

function displayRetrievedBlob(result, height, commitment, passkey) {
    const section = document.getElementById('retrievedSection');
    section.style.display = 'block';

    const blobContent = document.getElementById('blobContent');
    const hexData = result.data;

    // Check content type
    const decoded = hexToString(hexData.substring(0, Math.min(100, hexData.length)));

    try {
        if (decoded.startsWith('TEXT:')) {
            // It's text content
            const fullText = hexToString(hexData);
            const encryptedMessage = fullText.substring(5); // Remove "TEXT:" prefix

            // Decrypt the message
            const message = decryptData(encryptedMessage, passkey);

            blobContent.innerHTML = '';
            blobContent.textContent = message;
            blobContent.style.whiteSpace = 'pre-wrap';
        } else if (decoded.startsWith('IMG:')) {
            // It's an image
            const fullText = hexToString(hexData.substring(0, 200)); // Just read the header
            const parts = fullText.split(':');
            const mimeType = parts[1];
            const headerLength = stringToHex(`IMG:${mimeType}:`).length;
            const encryptedHexString = hexToString(hexData.substring(headerLength));

            // Decrypt the hex string
            const imageHex = decryptData(encryptedHexString, passkey);

            const imageBuffer = hexToArrayBuffer(imageHex);
            const blob = new Blob([imageBuffer], { type: mimeType });
            const imageUrl = URL.createObjectURL(blob);

            blobContent.innerHTML = `<img src="${imageUrl}" alt="Retrieved image" style="max-width: 100%; border-radius: 8px;" />`;
            blobContent.style.whiteSpace = 'normal';
        } else {
            // Unknown format, display as text
            const message = hexToString(hexData);
            blobContent.innerHTML = '';
            blobContent.textContent = message;
            blobContent.style.whiteSpace = 'pre-wrap';
        }

        document.getElementById('retrievedHeight').textContent = height;
        document.getElementById('retrievedNamespace').textContent = decodeNamespace(NAMESPACE);
        document.getElementById('retrievedCommitment').textContent = commitment;

        // Scroll to result
        section.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        blobContent.innerHTML = '';
        blobContent.innerHTML = `<div style="color: #721c24; background: #f8d7da; padding: 15px; border-radius: 8px; border: 1px solid #f5c6cb;">
            <strong>❌ Decryption Failed</strong><br>
            ${error.message}<br><br>
            Make sure you're using the same passkey that was used to encrypt this data.
        </div>`;
        section.scrollIntoView({ behavior: 'smooth' });
    }
}

// Tab switching
function switchTab(tabName) {
    currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        }
    });

    // Update tab content
    if (tabName === 'text') {
        document.getElementById('textTab').style.display = 'block';
        document.getElementById('imageTab').style.display = 'none';
    } else {
        document.getElementById('textTab').style.display = 'none';
        document.getElementById('imageTab').style.display = 'block';
    }
}

// File upload handlers
async function stripImageMetadata(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Create canvas and draw image (this strips EXIF data)
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // Convert back to blob without metadata
                canvas.toBlob((blob) => {
                    if (blob) {
                        // Create a new File object with the same name and type
                        const strippedFile = new File([blob], file.name, {
                            type: file.type,
                            lastModified: Date.now()
                        });
                        resolve(strippedFile);
                    } else {
                        reject(new Error('Failed to strip metadata'));
                    }
                }, file.type, 0.95); // 95% quality
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

async function handleFileSelect(file) {
    if (!file || !file.type.startsWith('image/')) {
        showStatus('Please select a valid image file', true);
        return;
    }

    // Strip metadata from image
    showStatus('🔒 Stripping location & metadata from image...');
    try {
        selectedFile = await stripImageMetadata(file);
        showStatus('✅ Metadata stripped! Image is now safe to post.');
    } catch (error) {
        console.error('Error stripping metadata:', error);
        showStatus('⚠️ Could not strip metadata, using original file', true);
        selectedFile = file;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('previewImage').src = e.target.result;
        document.getElementById('fileUploadArea').querySelector('.upload-prompt').style.display = 'none';
        document.getElementById('filePreview').style.display = 'block';
    };
    reader.readAsDataURL(selectedFile);
}

function clearFileSelection() {
    selectedFile = null;
    document.getElementById('imageInput').value = '';
    document.getElementById('previewImage').src = '';
    document.getElementById('fileUploadArea').querySelector('.upload-prompt').style.display = 'block';
    document.getElementById('filePreview').style.display = 'none';
}

// UI update functions
function updatePasskeyUI() {
    const biometricMode = document.getElementById('biometricMode');
    const passwordMode = document.getElementById('passwordMode');
    const registerBtn = document.getElementById('registerPasskeyBtn');
    const authenticateBtn = document.getElementById('authenticatePasskeyBtn');
    const hint = document.getElementById('biometricHint');

    if (authMode === 'biometric') {
        biometricMode.style.display = 'block';
        passwordMode.style.display = 'none';

        const hasCredential = localStorage.getItem('credentialId');
        if (hasCredential && encryptionKey) {
            // Already authenticated
            registerBtn.style.display = 'none';
            authenticateBtn.style.display = 'none';
            hint.textContent = '✅ Biometric unlocked';
            hint.style.color = '#155724';
        } else if (hasCredential) {
            // Has credential but not authenticated
            registerBtn.style.display = 'none';
            authenticateBtn.style.display = 'block';
            hint.textContent = 'Unlock with biometric to encrypt your data';
            hint.style.color = '#999';
        } else {
            // No credential set up
            registerBtn.style.display = 'block';
            authenticateBtn.style.display = 'none';
            hint.textContent = 'Set up biometric authentication to secure your data';
            hint.style.color = '#999';
        }
    } else {
        biometricMode.style.display = 'none';
        passwordMode.style.display = 'block';
    }
}

function updateRetrievePasskeyUI() {
    const biometricMode = document.getElementById('retrieveBiometricMode');
    const passwordMode = document.getElementById('retrievePasswordMode');
    const authenticateBtn = document.getElementById('retrieveAuthenticatePasskeyBtn');
    const hint = document.getElementById('retrieveBiometricHint');

    if (retrieveAuthMode === 'biometric') {
        biometricMode.style.display = 'block';
        passwordMode.style.display = 'none';

        const hasCredential = localStorage.getItem('credentialId');
        if (hasCredential && encryptionKey) {
            // Already authenticated
            authenticateBtn.style.display = 'none';
            hint.textContent = '✅ Biometric unlocked';
            hint.style.color = '#155724';
        } else if (hasCredential) {
            // Has credential but not authenticated
            authenticateBtn.style.display = 'block';
            hint.textContent = 'Unlock with biometric to decrypt';
            hint.style.color = '#999';
        } else {
            // No credential set up
            authenticateBtn.style.display = 'none';
            hint.textContent = 'No biometric set up. Use password or set up biometric above.';
            hint.style.color = '#999';
        }
    } else {
        biometricMode.style.display = 'none';
        passwordMode.style.display = 'block';
    }
}

function updateUI() {
    const signInBtn = document.getElementById('signInBtn');
    const signInSection = document.getElementById('signInSection');

    if (signInBtn) {
        if (currentUser) {
            signInBtn.textContent = '✅ Signed in';
            signInBtn.disabled = true;
            if (signInSection) {
                signInSection.style.display = 'none';
            }
        } else {
            signInBtn.textContent = '🔐 Sign in with Passkey';
            signInBtn.disabled = false;
            if (signInSection) {
                signInSection.style.display = 'block';
            }
        }
    }

    updatePasskeyUI();
    updateRetrievePasskeyUI();
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    // Load passkey from session if available (for password mode)
    const savedPasskey = sessionStorage.getItem('passkey');
    if (savedPasskey) {
        document.getElementById('passkeyInput').value = savedPasskey;
        document.getElementById('retrievePasskeyInput').value = savedPasskey;
    }

    // Check WebAuthn support
    isWebAuthnSupported().then(supported => {
        if (!supported) {
            // Hide biometric options if not supported
            document.querySelectorAll('.passkey-option-btn[data-mode="biometric"]').forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.title = 'Biometric authentication not supported on this device';
            });
            authMode = 'password';
            retrieveAuthMode = 'password';
            updatePasskeyUI();
            updateRetrievePasskeyUI();
        }
    });

    // Update UI based on initial state
    updatePasskeyUI();
    updateRetrievePasskeyUI();

    // Add click handlers
    document.getElementById('postBtn').addEventListener('click', postMessage);
    document.getElementById('retrieveBtn').addEventListener('click', retrieveBlob);

    // Passkey option toggle handlers
    document.querySelectorAll('.passkey-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            authMode = btn.dataset.mode;
            document.querySelectorAll('.passkey-option-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updatePasskeyUI();
        });
    });

    document.querySelectorAll('.retrieve-passkey-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            retrieveAuthMode = btn.dataset.mode;
            document.querySelectorAll('.retrieve-passkey-option-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateRetrievePasskeyUI();
        });
    });

    // Sign in button handler (if exists)
    const signInBtn = document.getElementById('signInBtn');
    if (signInBtn) {
        signInBtn.addEventListener('click', signInWithPasskey);
    }

    // Passkey registration and authentication handlers
    document.getElementById('registerPasskeyBtn').addEventListener('click', async () => {
        const success = await registerPasskey();
        if (success) {
            showStatus('✅ Biometric set up successfully!');
            updatePasskeyUI();
            updateRetrievePasskeyUI();
        }
    });

    document.getElementById('authenticatePasskeyBtn').addEventListener('click', async () => {
        const success = await authenticatePasskey();
        if (success) {
            showStatus('✅ Biometric unlocked!');
            updatePasskeyUI();
            updateRetrievePasskeyUI();
        }
    });

    document.getElementById('retrieveAuthenticatePasskeyBtn').addEventListener('click', async () => {
        const success = await authenticatePasskey();
        if (success) {
            showRetrieveStatus('✅ Biometric unlocked!');
            updateRetrievePasskeyUI();
        }
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // File upload
    const fileInput = document.getElementById('imageInput');
    const uploadArea = document.getElementById('fileUploadArea');

    uploadArea.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    document.getElementById('removeFile').addEventListener('click', (e) => {
        e.stopPropagation();
        clearFileSelection();
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#667eea';
        uploadArea.style.background = '#f8f9fa';
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#e0e0e0';
        uploadArea.style.background = '';
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#e0e0e0';
        uploadArea.style.background = '';

        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });
});
