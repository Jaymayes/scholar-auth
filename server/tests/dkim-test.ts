import { emailService } from '../services/emailService';

async function testDKIMVerification() {
  console.log('\n🔐 DKIM/SPF/DMARC Verification Test');
  console.log('=' .repeat(60));
  
  const testEmails = [
    { provider: 'Gmail', address: 'jamarr+gmail@referralsvc.com' },
    { provider: 'Outlook', address: 'jamarr+outlook@referralsvc.com' },
    { provider: 'iCloud', address: 'jamarr+icloud@referralsvc.com' },
  ];

  console.log('\n📧 Sending test emails to verify authentication...\n');

  for (const test of testEmails) {
    try {
      console.log(`📤 Sending to ${test.provider} (${test.address})...`);
      
      await emailService.sendPasswordResetEmail(
        test.address,
        'test-token-' + Date.now()
      );
      
      console.log(`✅ ${test.provider}: Email sent successfully`);
    } catch (error) {
      console.error(`❌ ${test.provider}: Failed -`, error instanceof Error ? error.message : String(error));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 NEXT STEPS:');
  console.log('1. Check inbox for each test email (Gmail, Outlook, iCloud)');
  console.log('2. Open each email and view full headers');
  console.log('3. Verify authentication results:');
  console.log('   - SPF: PASS (v=spf1 include:pmta.postmarkapp.com)');
  console.log('   - DKIM: PASS (d=referralsvc.com, signature verified)');
  console.log('   - DMARC: PASS (p=none acceptable for Gate A)');
  console.log('4. Screenshot headers and save to evidence/');
  console.log('5. Publish 15:30 UTC checkpoint with results\n');
}

testDKIMVerification().catch(console.error);
