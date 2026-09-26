const fs = require('node:fs');
const settings = JSON.parse(fs.readFileSync(process.argv[2] || '/etc/tela-selfvpn/server.json', 'utf8'));
const { origin } = require('../selfvpn/protocol');
console.log('selfvpn:' + Buffer.from(JSON.stringify({ v: 1, server: origin(settings.origin), token: settings.inviteToken })).toString('base64url'));
