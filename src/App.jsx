import { useState, useEffect } from 'react'
import CryptoJS from 'crypto-js'

// API Configuration
// Always use our proxy to avoid CORS issues
const TWINKLE_API_BASE = '/api/twinkle'
const NETWORK = 'mocha-4'
const NAMESPACE_HEX = '62756c6c6574696e2d626f617264000000'
const NAMESPACE_BASE64 = 'YnVsbGV0aW4tYm9hcmQAAAAA'

function App() {
  const [postPasskey, setPostPasskey] = useState('')
  const [author, setAuthor] = useState('')
  const [message, setMessage] = useState('')
  const [decryptPasskey, setDecryptPasskey] = useState('')
  const [encryptedBlobs, setEncryptedBlobs] = useState([])
  const [decryptedMessages, setDecryptedMessages] = useState([])
  const [isDecrypted, setIsDecrypted] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState('')
  const [statusError, setStatusError] = useState(false)

  // Utility functions
  const stringToHex = (str) => {
    return Array.from(str)
      .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  }

  const hexToString = (hex) => {
    const bytes = hex.match(/.{1,2}/g) || []
    return bytes.map(byte => String.fromCharCode(parseInt(byte, 16))).join('')
  }

  const base64ToHex = (base64) => {
    const binary = atob(base64)
    return Array.from(binary)
      .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  }

  const encryptMessage = (messageData, passkey) => {
    const jsonString = JSON.stringify(messageData)
    return CryptoJS.AES.encrypt(jsonString, passkey).toString()
  }

  const decryptMessage = (encryptedData, passkey) => {
    try {
      const decrypted = CryptoJS.AES.decrypt(encryptedData, passkey)
      const jsonString = decrypted.toString(CryptoJS.enc.Utf8)
      if (!jsonString) return null
      return JSON.parse(jsonString)
    } catch (error) {
      return null
    }
  }

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return date.toLocaleDateString()
  }

  const showStatus = (msg, isError = false) => {
    setStatusMessage(msg)
    setStatusError(isError)
    setTimeout(() => setStatusMessage(''), 5000)
  }

  // Post encrypted message
  const postEncryptedMessage = async (e) => {
    e.preventDefault()
    if (!message || !postPasskey) return

    setIsPosting(true)

    try {
      const messageData = {
        author: author || 'Anonymous',
        message,
        timestamp: new Date().toISOString()
      }

      const encryptedData = encryptMessage(messageData, postPasskey)
      const dataHex = stringToHex(encryptedData)

      const response = await fetch(`${TWINKLE_API_BASE}/blob`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          namespace: NAMESPACE_HEX,
          data: dataHex,
          network: NETWORK
        })
      })

      if (!response.ok) {
        const errorData = await response.text()
        throw new Error(`Failed to post: ${response.status} - ${errorData}`)
      }

      showStatus('✅ Message encrypted and posted to Celestia!')
      setAuthor('')
      setMessage('')

      // Refresh if using same passkey
      if (decryptPasskey === postPasskey) {
        setTimeout(() => loadAndDecrypt(postPasskey), 3000)
      }
    } catch (error) {
      showStatus(`❌ Failed to post: ${error.message}`, true)
    } finally {
      setIsPosting(false)
    }
  }

  // Retrieve encrypted blobs
  const retrieveEncryptedBlobs = async () => {
    try {
      const response = await fetch(
        `${TWINKLE_API_BASE}/namespace/blobs?namespace=${encodeURIComponent(NAMESPACE_BASE64)}&network=${NETWORK}`
      )

      if (!response.ok) {
        throw new Error(`Failed to retrieve: ${response.status}`)
      }

      const data = await response.json()
      return (data.blobs || []).map(blob => ({
        data: blob.data,
        height: blob.height,
        commitment: blob.commitment
      }))
    } catch (error) {
      console.error('Error retrieving blobs:', error)
      return []
    }
  }

  // Decrypt blobs with passkey
  const decryptBlobs = (blobs, passkey) => {
    const decrypted = []

    for (const blob of blobs) {
      try {
        const hexData = base64ToHex(blob.data)
        const encryptedString = hexToString(hexData)
        const messageData = decryptMessage(encryptedString, passkey)

        if (messageData) {
          decrypted.push({
            ...messageData,
            blockHeight: blob.height,
            commitment: blob.commitment
          })
        }
      } catch (e) {
        console.debug('Failed to decrypt blob:', e)
      }
    }

    decrypted.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    return decrypted
  }

  // Load and decrypt
  const loadAndDecrypt = async (passkey) => {
    setIsLoading(true)
    try {
      const blobs = await retrieveEncryptedBlobs()
      setEncryptedBlobs(blobs)
      const decrypted = decryptBlobs(blobs, passkey)
      setDecryptedMessages(decrypted)
      setIsDecrypted(true)
    } catch (error) {
      showStatus('Failed to load messages', true)
    } finally {
      setIsLoading(false)
    }
  }

  // Handle decrypt button
  const handleDecrypt = async () => {
    if (!decryptPasskey) {
      alert('Please enter a passkey')
      return
    }
    await loadAndDecrypt(decryptPasskey)
  }

  // Initial load
  useEffect(() => {
    const loadBlobs = async () => {
      const blobs = await retrieveEncryptedBlobs()
      setEncryptedBlobs(blobs)
      setIsLoading(false)
    }
    loadBlobs()
  }, [])

  return (
    <div className="container">
      <header>
        <h1>🔐 Celestia Private Board</h1>
        <p className="subtitle">
          Encrypted messages powered by <a href="https://t.tech" target="_blank" rel="noopener noreferrer">Twinkle</a> & Celestia DA
        </p>
      </header>

      <main>
        <section className="post-section">
          <h2>Post an Encrypted Message</h2>
          <form onSubmit={postEncryptedMessage}>
            <div className="form-group">
              <label htmlFor="postPasskey">🔑 Passkey:</label>
              <input
                type="password"
                id="postPasskey"
                value={postPasskey}
                onChange={(e) => setPostPasskey(e.target.value)}
                required
                minLength="4"
                placeholder="Enter your passkey to encrypt"
              />
              <small className="help-text">Remember this! You'll need it to decrypt messages.</small>
            </div>
            <div className="form-group">
              <label htmlFor="author">Your Name:</label>
              <input
                type="text"
                id="author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                maxLength="50"
                placeholder="Anonymous"
              />
            </div>
            <div className="form-group">
              <label htmlFor="message">Message:</label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                maxLength="500"
                rows="4"
                placeholder="Share your thoughts..."
              />
            </div>
            <button type="submit" disabled={isPosting}>
              {isPosting ? '🔒 Encrypting & Posting...' : '🔒 Encrypt & Post to Celestia'}
            </button>
          </form>
          {statusMessage && (
            <div className={`status-message ${statusError ? 'error' : 'success'}`}>
              {statusMessage}
            </div>
          )}
        </section>

        <section className="messages-section">
          <div className="messages-header">
            <h2>Decrypt Messages</h2>
            <button onClick={() => handleDecrypt()}>🔄 Refresh</button>
          </div>
          <div className="decrypt-section">
            <div className="form-group-inline">
              <label htmlFor="decryptPasskey">🔑 Passkey:</label>
              <input
                type="password"
                id="decryptPasskey"
                value={decryptPasskey}
                onChange={(e) => setDecryptPasskey(e.target.value)}
                placeholder="Enter passkey to decrypt"
                onKeyPress={(e) => e.key === 'Enter' && handleDecrypt()}
              />
              <button onClick={handleDecrypt}>🔓 Decrypt</button>
            </div>
            <small className="help-text">Enter your passkey to view encrypted messages</small>
          </div>

          {isLoading ? (
            <div className="loading">Loading encrypted messages...</div>
          ) : !isDecrypted ? (
            <div className="encrypted-notice">
              🔒 Messages are encrypted. Enter your passkey to decrypt and view them.
            </div>
          ) : decryptedMessages.length === 0 ? (
            <div className="no-messages">
              No messages found with this passkey. Try a different passkey or post a new message!
            </div>
          ) : (
            <div className="messages-list">
              {decryptedMessages.map((msg, idx) => (
                <div key={idx} className="message-card">
                  <div className="message-header">
                    <span className="message-author">{msg.author}</span>
                    <span className="message-time">{formatTimestamp(msg.timestamp)}</span>
                  </div>
                  <div className="message-content">{msg.message}</div>
                  <div className="message-footer">
                    <small>Block: {msg.blockHeight || 'pending'}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer>
        <p>Built with <a href="https://celestia.org" target="_blank" rel="noopener noreferrer">Celestia</a> • Encrypted data persists on-chain forever</p>
        <p className="tech-info">Network: Mocha-4 Testnet • Namespace: bulletin-board • AES-256 Encryption</p>
      </footer>
    </div>
  )
}

export default App
