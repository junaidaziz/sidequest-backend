import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });
if (!result.stdout) {
  process.stderr.write(result.stderr || 'npm audit produced no report\n');
  process.exit(1);
}
const report = JSON.parse(result.stdout);
if (report.error || !report.metadata?.vulnerabilities) {
  console.error(report.message ?? 'npm audit failed before producing a vulnerability report.');
  process.exit(1);
}
const total = report.metadata?.vulnerabilities?.total ?? 0;
if (total !== 0) {
  console.error(`Production dependency audit found ${total} vulnerability record(s).`);
  process.exit(1);
}
console.log('Production dependency audit passed with no advisories.');
