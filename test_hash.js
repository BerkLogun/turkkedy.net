// Test hash-based approach for uniqueness
async function generateShortHash(input) {
  // Simple hash function for testing (not crypto-grade)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Take first 6 chars of base36 representation
  return Math.abs(hash).toString(36).substring(0, 6);
}

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function testHashes() {
  const testFiles = [
    'cats/00001_20231201_123456.webp',
    'cats/00001_20231202_789012.webp',
    'cats/00002_20231201_345678.webp',
    'cats/00003_20231201_901234.webp'
  ];

  console.log('Testing hash uniqueness:');
  const hashes = [];

  for (const file of testFiles) {
    const hash = await generateShortHash(file);
    const encoded = b64urlEncode(hash);
    console.log(`${file} -> ${hash} -> ${encoded} (length: ${encoded.length})`);
    hashes.push(hash);
  }

  // Check for duplicates
  const uniqueHashes = new Set(hashes);
  console.log(`\nUnique hashes: ${uniqueHashes.size}/${hashes.length}`);
  if (uniqueHashes.size === hashes.length) {
    console.log('✅ All hashes are unique!');
  } else {
    console.log('❌ Hash collisions detected!');
  }
}

testHashes();
