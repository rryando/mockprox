import { Environment } from 'mockprox-commons';
import { equal } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { MockproxServer } from '../../../src';
import { getEnvironment } from '../../libs/environment';

describe('Server should follow Faker.js options', () => {
  let testEnv: Environment;
  let testServer: MockproxServer;

  before(async () => {
    testEnv = await getEnvironment('test');
    testServer = new MockproxServer(testEnv, {
      fakerOptions: {
        seed: 1,
        locale: 'en_GB'
      },
      envVarsPrefix: ''
    });
    testServer.start();
  });

  after(() => {
    testServer.stop();
  });

  it('should return seeding and localized content', async () => {
    const response = await fetch('http://localhost:3000/faker');
    const body = await response.text();

    equal(body, 'SA3 1CE');
  });
});
