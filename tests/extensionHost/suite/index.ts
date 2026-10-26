import Mocha from "mocha";
import { join } from "node:path";

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", timeout: 20_000 });
  mocha.addFile(join(__dirname, "extension.test.js"));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} extension-host test(s) failed.`));
        return;
      }
      resolve();
    });
  });
}
