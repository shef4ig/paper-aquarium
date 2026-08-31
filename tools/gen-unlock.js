// Печатает salt+hash для токена разблокировки комнаты.
// Использование: node tools/gen-unlock.js <roomId> <token>
'use strict';
const crypto = require('crypto');
const roomId = process.argv[2] || 'room';
const token = process.argv[3] || 'demo-key';
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(String(token), salt, 32).toString('hex');
console.log(JSON.stringify({ roomId, token, salt, unlockHash: hash }, null, 2));
