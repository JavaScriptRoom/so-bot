const Bot = require('./bot');

module.exports = async ({mainRoom, email, password}) => {
	const bot = new Bot(mainRoom);
	try {
		await bot.auth(email, password);
		await bot.connect();
		await bot.listen();
	} catch(error) {
		console.trace(error);
	}

	process.on('SIGINT', () => bot.quit(false));

	bot.once('open', () => console.log('Connected'));
	bot.once('close', () => console.log('Connection closed'));
	bot.on('error', error => console.error(error));
	bot.on('event', event => bot.handleEvent(event));
};