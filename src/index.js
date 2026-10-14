import { run } from './pipeline.js';

const args = process.argv.slice(2);
if (args.some(arg => !['--simulate-failure', '--show-raw'].includes(arg))) {
  console.error('Usage: npm start -- [--simulate-failure] [--show-raw]');
  process.exitCode = 2;
} else {
  try {
    const { report, rawRecords } = await run({ simulateFailure: args.includes('--simulate-failure') });
    if (args.includes('--show-raw')) console.log(JSON.stringify(rawRecords[0] ?? null, null, 2));
    console.log(JSON.stringify(report, null, 2));
    const expectedDemo = report.simulated_failure && report.failed_pages === 1
      && report.valid_records === 60 && report.invalid_records === 0 && report.run_errors === 0;
    if (report.status !== 'complete' && !expectedDemo) process.exitCode = 1;
  } catch (error) {
    console.error('Unable to finish/write run report: ' + error.message);
    process.exitCode = 1;
  }
}
