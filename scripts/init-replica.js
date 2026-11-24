(async () => {
// Executed by mongosh. Bounded, idempotent and rejects an unrelated existing replica set.
const deadline = Date.now() + 90000;
let connection;
while (Date.now() < deadline) {
  try { connection = await new Mongo('mongodb://mongo:27017/?directConnection=true'); await connection.getDB('admin').runCommand({ ping: 1 }); break; }
  catch { await sleep(1000); }
}
if (!connection) throw new Error('MongoDB did not become reachable');
const admin = connection.getDB('admin');
async function command(value) { try { return await admin.runCommand(value); } catch (e) { if ([94, 23].includes(e.code)) return { ok: 0, code: e.code }; throw e; } }
let config = await command({ replSetGetConfig: 1 });
if (!config.ok && config.code === 94) {
  const result = await command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] } });
  if (!result.ok && result.code !== 23) throw new Error('Replica set initialization failed');
} else if (!config.ok) throw new Error('Cannot read replica configuration');
while (Date.now() < deadline) {
  config = await command({ replSetGetConfig: 1 });
  if (config.ok) {
    if (config.config._id !== 'rs0' || config.config.members.length !== 1 || config.config.members[0].host !== 'mongo:27017') throw new Error('Incompatible existing replica configuration');
    if ((await admin.runCommand({ hello: 1 })).isWritablePrimary) { print('rs0 PRIMARY ready'); quit(0); }
  }
  await sleep(1000);
}
throw new Error('PRIMARY election timed out');

})().catch(error => { print(error.message); quit(1); });
