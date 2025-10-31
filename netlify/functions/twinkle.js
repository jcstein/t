// Netlify serverless function to proxy Twinkle API
exports.handler = async function(event, context) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    // Handle POST - submit blob
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);

      console.log('POST request body:', JSON.stringify(body));

      const response = await fetch('https://t.tech/v0/blob', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.TWINKLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      console.log('POST response status:', response.status);
      console.log('POST response:', responseText.substring(0, 500));

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error('Failed to parse POST response:', e);
        return {
          statusCode: response.status,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            error: 'Invalid response from Twinkle API',
            details: responseText.substring(0, 200)
          })
        };
      }

      return {
        statusCode: response.status,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      };
    }

    // Handle GET - retrieve blob
    if (event.httpMethod === 'GET') {
      try {
        const { height, namespace, commitment, network } = event.queryStringParameters || {};

        if (!height || !namespace || !commitment) {
          return {
            statusCode: 400,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Missing required parameters: height, namespace, commitment' })
          };
        }

        // Convert hex namespace to base64 with proper padding
        // Celestia namespaces must be 29 bytes: 1 byte version + 28 bytes namespace ID
        const hexToBytes = (hex) => {
          const bytes = [];
          for (let i = 0; i < hex.length; i += 2) {
            bytes.push(parseInt(hex.substr(i, 2), 16));
          }
          return bytes;
        };

        const namespaceBytes = hexToBytes(namespace);
        // Create 29-byte namespace for version 0:
        // - Byte 0: version (0x00)
        // - Bytes 1-18: must be zeros (18 bytes)
        // - Bytes 19-28: namespace ID (up to 10 bytes)
        const fullNamespace = new Uint8Array(29);
        fullNamespace[0] = 0x00; // version byte
        // Bytes 1-18 are already 0 (required leading zeros for version 0)
        // Copy namespace bytes starting at index 19
        const startIdx = 19;
        for (let i = 0; i < namespaceBytes.length && i < 10; i++) {
          fullNamespace[startIdx + i] = namespaceBytes[i];
        }
        // Remaining bytes after namespace are already 0 (trailing padding)

        const namespaceBase64 = Buffer.from(fullNamespace).toString('base64');

        // Build URL with encoded parameters
        const params = new URLSearchParams({
          namespace: namespaceBase64,
          blobCommitment: commitment,
          height: height
        });

        if (network) {
          params.append('network', network);
        }

        const url = `https://t.tech/v0/blob?${params.toString()}`;
        console.log('Fetching blob from:', url);
        console.log('Namespace (hex):', namespace);
        console.log('Namespace (base64):', namespaceBase64);
        console.log('Commitment:', commitment);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${process.env.TWINKLE_API_KEY}`,
          },
        });

        // Get response as text first to handle errors better
        const responseText = await response.text();
        console.log('Response status:', response.status);
        console.log('Response text:', responseText.substring(0, 500));

        // Check if response is OK
        if (!response.ok) {
          console.error('API error response:', response.status, responseText);
          return {
            statusCode: response.status,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              error: `Twinkle API returned ${response.status}`,
              message: responseText.substring(0, 200)
            })
          };
        }

        // Try to parse as JSON
        let data;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          console.error('JSON parse error:', parseError.message);
          console.error('Response was:', responseText.substring(0, 200));
          return {
            statusCode: 500,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              error: 'Invalid JSON response from Twinkle API',
              parseError: parseError.message,
              preview: responseText.substring(0, 100).replace(/[^\x20-\x7E]/g, '?')
            })
          };
        }

        // Convert base64 data back to hex for consistency
        if (data.data) {
          const dataBytes = Buffer.from(data.data, 'base64');
          data.data = dataBytes.toString('hex');
        }

        return {
          statusCode: response.status,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        };
      } catch (error) {
        console.error('Unexpected error in GET handler:', error);
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            error: 'Internal server error',
            message: error.message,
            stack: error.stack
          })
        };
      }
    }

    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};
