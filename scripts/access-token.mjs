import { createHash } from 'node:crypto';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

export function accessTokenDirectory({
  temporaryDirectory = tmpdir(),
  identity = userInfo(),
} = {}) {
  const userKey = createHash('sha256')
    .update(
      JSON.stringify([
        identity.uid,
        identity.gid,
        identity.username,
        identity.homedir,
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  return join(temporaryDirectory, `diffsplain-access-${userKey}`);
}
