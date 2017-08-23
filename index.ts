const config = require('./config.json');
import bot from './src/app';

console.log('config', config);

bot(config);