import * as path from 'node:path';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 180000 });
  for (const f of ['editor.test.js', 'petri.test.js', 'sidebar.test.js', 'analysis.test.js']) mocha.addFile(path.join(__dirname, f));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} integration test(s) failed`)) : resolve()));
  });
}
