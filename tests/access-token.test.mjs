import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { accessTokenDirectory } from '../scripts/access-token.mjs';

const firstUser = {
  uid: 1000,
  gid: 1000,
  username: 'first',
  homedir: '/home/first',
};
const secondUser = {
  uid: 1001,
  gid: 1001,
  username: 'second',
  homedir: '/home/second',
};

test('scopes saved access values to the current user', () => {
  const firstDirectory = accessTokenDirectory({
    temporaryDirectory: '/shared',
    identity: firstUser,
  });
  const secondDirectory = accessTokenDirectory({
    temporaryDirectory: '/shared',
    identity: secondUser,
  });

  assert.match(firstDirectory, /^\/shared\/diffsplain-access-[a-f0-9]{16}$/);
  assert.notEqual(firstDirectory, secondDirectory);
  assert.match(accessTokenDirectory(), new RegExp(`^${tmpdir()}/`));
});
