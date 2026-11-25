const target = process.argv[2];
if (!/^(?:spatial_memory|sm_release_20261125_[0-9]+)$/.test(target)) {
  throw new Error('Unknown migration target');
}
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== 'db' || url.pathname !== '/spatial_memory') {
  throw new Error('Unexpected Compose database');
}
url.pathname = '/' + target;
process.env.DATABASE_URL = url.toString();
process.argv.length = 2;
void import('./migrate.cjs');
