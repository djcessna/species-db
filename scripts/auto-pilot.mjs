import { execSync } from 'child_process';

// Interval in minutes between automatic imports
const INTERVAL_MINUTES = 2;

console.log('🤖 Auto-Pilot Started!');
console.log(`The system will automatically fetch new species & papers every ${INTERVAL_MINUTES} minutes.\n`);

function runPipeline() {
  const time = new Date().toLocaleTimeString();
  console.log(`\n========================================`);
  console.log(`🚀 Starting Automated Import Cycle at ${time}`);
  console.log(`========================================`);

  try {
    console.log('\n--- Step 1: Fetching New Species ---');
    execSync('node --env-file=.env scripts/fetch-species.mjs', { stdio: 'inherit' });

    console.log('\n--- Step 2: Fetching Papers for New Species ---');
    execSync('node --env-file=.env scripts/fetch-papers.mjs', { stdio: 'inherit' });

    console.log(`\n Cycle complete! Sleeping for ${INTERVAL_MINUTES} minutes...`);
  } catch (err) {
    console.error('❌ Error during automated cycle:', err.message);
  }
}

// Run once immediately on startup
runPipeline();

// Schedule to repeat on your interval
setInterval(runPipeline, INTERVAL_MINUTES * 60 * 1000);
