/**
 * Global Test Teardown - Runs once after all tests
 * 
 * Cleans up test resources and ensures proper shutdown
 */

export default async function globalTeardown() {
  console.log('🧹 Global test teardown starting...');
  
  try {
    // Any global cleanup needed
    console.log('✅ Global test teardown complete');
  } catch (error) {
    console.error('❌ Global test teardown failed:', error);
    // Don't throw - teardown failures shouldn't fail the test run
  }
}
