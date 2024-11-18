import { homedir } from 'os';
import { join } from 'path';

const version = require('../package.json').version;
const dirName = '.mockprox-cli';

export const Config: { version: string; logsPath: string } = {
  version,
  logsPath: join(homedir(), `/${dirName}/logs/`)
};
