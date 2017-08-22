import Bot from './bot';

export default function ({ mainRoom, email, password }) {
	const bot = new Bot(mainRoom);
	bot.auth(email, password)
		.then(() => bot.connect())
		.then(() => bot.listen())
		.catch(error => console.trace(error));

	process.on('SIGINT', () => bot.quit(false));

	bot.once('open', () => console.log('Connected'));
	bot.once('close', () => console.log('Connection closed'));
	bot.on('error', error => console.error(error));
	bot.on('event', event => bot.handleEvent(event));
};