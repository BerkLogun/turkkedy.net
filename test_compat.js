// Test backwards compatibility logic
function b64urlDecode(s) {
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  const pad = s.length % 4; if (pad) s += '='.repeat(4-pad);
  const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function processKey(encodedKey) {
  let key = b64urlDecode(encodedKey);
  // Handle backwards compatibility: old keys have full path, new keys have just filename
  if (!key.includes('/')) {
    // New format: just filename, prepend cats/
    key = 'cats/' + key;
  }
  return key;
}

// Test old format
const oldEncoded = 'Y2F0cy8wMDAwMV8yMDIzMTIwMV8xMjM0NTYud2VicA';
const oldResult = processKey(oldEncoded);
console.log('Old format test:');
console.log('Encoded:', oldEncoded);
console.log('Decoded and processed:', oldResult);

// Test new format
const newEncoded = 'MDAwMDFfMjAyMzEyMDFfMTIzNDU2LndlYnA';
const newResult = processKey(newEncoded);
console.log('\nNew format test:');
console.log('Encoded:', newEncoded);
console.log('Decoded and processed:', newResult);
