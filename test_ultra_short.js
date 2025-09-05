// Test ultra-short URL backwards compatibility
function b64urlDecode(s) {
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  const pad = s.length % 4; if (pad) s += '='.repeat(4-pad);
  const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function processKey(encodedKey) {
  let key = b64urlDecode(encodedKey);
  console.log('Decoded key:', key);

  // Handle backwards compatibility: old keys have full path, new keys have just sequential ID
  if (!key.includes('/')) {
    if (/^\d+$/.test(key)) {
      // Ultra-short format: just sequential ID (e.g., "00001"), lookup needed
      console.log('Ultra-short format detected - would lookup in manifest');
      key = `cats/${key}_20231201_123456.webp`; // Simulated manifest lookup result
    } else {
      // Shorter format: filename without path (e.g., "00001_20231201_123456.webp")
      key = `cats/${key}`;
      console.log('Converted to full path:', key);
    }
  }

  return key;
}

// Test different formats
const testCases = [
  'Y2F0cy8wMDAwMV8yMDIzMTIwMV8xMjM0NTYud2VicA',  // Old format
  'MDAwMDFfMjAyMzEyMDFfMTIzNDU2LndlYnA',          // Previous shorter format
  'MDAwMDE'                                          // New ultra-short format
];

testCases.forEach((encoded, i) => {
  console.log(`\nTest case ${i + 1}:`);
  console.log('Encoded:', encoded);
  const result = processKey(encoded);
  console.log('Final result:', result);
});
