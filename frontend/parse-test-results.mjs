import { readFileSync } from 'fs'
const data = JSON.parse(readFileSync('./vitest-results.json', 'utf8'))
console.log('Total:', data.numTotalTests, 'Passed:', data.numPassedTests, 'Failed:', data.numFailedTests)
for (const suite of data.testResults || []) {
  if (!suite) continue
  const file = (suite.testFilePath || '').split(/[/\\]/).pop()
  for (const test of suite.assertionResults || []) {
    if (test.status === 'failed') {
      console.log('FAIL:', file, '>', test.fullName)
      for (const m of test.failureMessages || []) {
        console.log('  MSG:', m.substring(0, 1000))
      }
    }
  }
}
