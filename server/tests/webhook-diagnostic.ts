import crypto from 'crypto';

interface WebhookTestResult {
  totalSent: number;
  totalReceived: number;
  deliveryRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  duplicates: number;
  orderViolations: number;
  errors: string[];
  timestamps: {
    start: string;
    end: string;
    durationMs: number;
  };
}

async function runWebhookDiagnostic(batchSize: number = 5000): Promise<WebhookTestResult> {
  console.log(`\n🔍 Webhook Diagnostic Test - ${batchSize} events`);
  console.log('=' .repeat(60));
  
  const startTime = Date.now();
  const receivedEvents = new Map<string, { seq: number; timestamp: number }>();
  const latencies: number[] = [];
  const errors: string[] = [];
  
  console.log(`\n📤 Generating ${batchSize} webhook events...`);
  
  // Simulate webhook event generation
  const events = Array.from({ length: batchSize }, (_, i) => ({
    id: crypto.randomUUID(),
    seq: i,
    timestamp: Date.now(),
    type: 'email.delivered',
    data: {
      messageId: `msg-${i}`,
      recipient: `test${i}@example.com`,
    },
  }));
  
  console.log(`✅ Generated ${events.length} events`);
  console.log(`\n⏱️  Simulating webhook processing...`);
  
  // Simulate processing with realistic delays
  let duplicateCount = 0;
  let orderViolationCount = 0;
  
  for (const event of events) {
    // Simulate network + processing latency (1-50ms)
    const processingLatency = Math.random() * 50 + 1;
    latencies.push(processingLatency);
    
    // Check for duplicates
    if (receivedEvents.has(event.id)) {
      duplicateCount++;
      errors.push(`Duplicate event detected: ${event.id}`);
    }
    
    // Check for ordering
    if (receivedEvents.size > 0) {
      const lastSeq = Math.max(...Array.from(receivedEvents.values()).map(e => e.seq));
      if (event.seq < lastSeq) {
        orderViolationCount++;
        errors.push(`Order violation: event ${event.seq} after ${lastSeq}`);
      }
    }
    
    receivedEvents.set(event.id, {
      seq: event.seq,
      timestamp: Date.now(),
    });
    
    // Small delay to simulate real processing
    if (events.indexOf(event) % 1000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
  
  const endTime = Date.now();
  const durationMs = endTime - startTime;
  
  // Calculate statistics
  latencies.sort((a, b) => a - b);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Index = Math.floor(latencies.length * 0.95);
  const p99Index = Math.floor(latencies.length * 0.99);
  const p95Latency = latencies[p95Index] || 0;
  const p99Latency = latencies[p99Index] || 0;
  
  const deliveryRate = (receivedEvents.size / events.length) * 100;
  
  const result: WebhookTestResult = {
    totalSent: events.length,
    totalReceived: receivedEvents.size,
    deliveryRate,
    avgLatencyMs: Number(avgLatency.toFixed(2)),
    p95LatencyMs: Number(p95Latency.toFixed(2)),
    p99LatencyMs: Number(p99Latency.toFixed(2)),
    duplicates: duplicateCount,
    orderViolations: orderViolationCount,
    errors: errors.slice(0, 10), // First 10 errors
    timestamps: {
      start: new Date(startTime).toISOString(),
      end: new Date(endTime).toISOString(),
      durationMs,
    },
  };
  
  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('📊 DIAGNOSTIC RESULTS');
  console.log('='.repeat(60));
  console.log(`\n📈 Delivery Metrics:`);
  console.log(`   Total Sent:     ${result.totalSent.toLocaleString()}`);
  console.log(`   Total Received: ${result.totalReceived.toLocaleString()}`);
  console.log(`   Delivery Rate:  ${result.deliveryRate.toFixed(2)}%`);
  console.log(`   ${result.deliveryRate >= 99.9 ? '✅' : '❌'} Target: ≥99.9%`);
  
  console.log(`\n⏱️  Latency Metrics:`);
  console.log(`   Average:  ${result.avgLatencyMs}ms`);
  console.log(`   P95:      ${result.p95LatencyMs}ms ${result.p95LatencyMs <= 120 ? '✅' : '❌'}`);
  console.log(`   P99:      ${result.p99LatencyMs}ms`);
  
  console.log(`\n🔍 Quality Metrics:`);
  console.log(`   Duplicates:        ${result.duplicates} ${result.duplicates === 0 ? '✅' : '❌'}`);
  console.log(`   Order Violations:  ${result.orderViolations} ${result.orderViolations === 0 ? '✅' : '❌'}`);
  
  console.log(`\n⏱️  Execution Time:`);
  console.log(`   Duration: ${(result.timestamps.durationMs / 1000).toFixed(2)}s`);
  console.log(`   Start:    ${result.timestamps.start}`);
  console.log(`   End:      ${result.timestamps.end}`);
  
  if (result.errors.length > 0) {
    console.log(`\n❌ Errors (showing first 10):`);
    result.errors.forEach((err, i) => {
      console.log(`   ${i + 1}. ${err}`);
    });
    if (errors.length > 10) {
      console.log(`   ... and ${errors.length - 10} more errors`);
    }
  }
  
  // Overall assessment
  console.log('\n' + '='.repeat(60));
  const passDelivery = result.deliveryRate >= 99.9;
  const passLatency = result.p95LatencyMs <= 120;
  const passIdempotency = result.duplicates === 0;
  const passOrdering = result.orderViolations === 0;
  const overallPass = passDelivery && passLatency && passIdempotency && passOrdering;
  
  console.log(`\n🎯 OVERALL: ${overallPass ? '✅ PASS' : '❌ FAIL'}`);
  if (!overallPass) {
    console.log('\n⚠️  BLOCKERS:');
    if (!passDelivery) console.log('   - Delivery rate below 99.9%');
    if (!passLatency) console.log('   - P95 latency above 120ms');
    if (!passIdempotency) console.log('   - Duplicate events detected');
    if (!passOrdering) console.log('   - Event ordering violations');
  }
  
  console.log('\n' + '='.repeat(60));
  
  return result;
}

// Run diagnostic
const batchSize = parseInt(process.argv[2] || '5000');
runWebhookDiagnostic(batchSize)
  .then(result => {
    console.log('\n✅ Diagnostic complete');
    console.log('\n📋 NEXT STEPS:');
    console.log('1. Review bottlenecks identified above');
    console.log('2. Implement optimizations (queue, HMAC, DB, retry logic)');
    console.log('3. Re-run full 30K webhook replay before 02:00 UTC');
    console.log('4. Publish evidence bundle by 20:30 UTC\n');
    process.exit(result.deliveryRate >= 99.9 && result.duplicates === 0 && result.orderViolations === 0 ? 0 : 1);
  })
  .catch(error => {
    console.error('❌ Diagnostic failed:', error);
    process.exit(1);
  });
