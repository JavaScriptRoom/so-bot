const bunyan = require('bunyan');

const log = bunyan.createLogger({
    name: 'sobot',
    streams: [
        {
            stream: process.stdout,
            level: 'debug'
        },
        {
            type: 'rotating-file',
            path: './logs/debug.log',
            period: '1m',
            count: 30,
            level: 'debug'
        }
    ]
});

module.exports = log;