// Test the redirect fix for hash-based URLs
async function generateShortHash(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const shortHash = hashArray.slice(0, 6).map(b => b.toString(36)).join('');
  return shortHash;
}

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function testRedirectLogic() {
  // Simulate manifest data
  const mockManifest = [
    'cats/00001_20231201_123456.webp',
    'cats/00002_20231201_345678.webp',
    'cats/00003_20231201_901234.webp'
  ];

  console.log('🧪 Testing redirect fix for hash-based URLs\n');

  for (let i = 0; i < mockManifest.length; i++) {
    const filename = mockManifest[i];
    const hash = await generateShortHash(filename);
    const encodedHash = b64urlEncode(hash);

    // Simulate the lookup process
    let foundIndex = -1;
    for (let j = 0; j < mockManifest.length; j++) {
      const testFilename = mockManifest[j];
      const testHash = await generateShortHash(testFilename);
      if (testHash === hash) {
        foundIndex = j;
        break;
      }
    }

    const expectedUrl = foundIndex >= 0 ? `/?i=${foundIndex}` : '/';

    console.log(`📁 ${filename}`);
    console.log(`🔢 Hash: ${hash}`);
    console.log(`🔗 Encoded: ${encodedHash}`);
    console.log(`🎯 Should redirect to: ${expectedUrl}`);
    console.log(`✅ Correct: ${foundIndex === i ? 'YES' : 'NO'}`);
    console.log('');
  }
}

testRedirectLogic();
