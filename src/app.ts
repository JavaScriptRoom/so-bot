import { Bot } from './bot';

export default async (config: any) => {
	const bot = new Bot(config);
	try {
		await bot.auth();
		await bot.connect();
		await bot.join();
		await bot.join(152531);
	} catch (error) {
		console.trace(error);
	}

	bot.once('open', () => console.log('Connected'));
	bot.once('close', () => console.log('Connection closed'));
	bot.on('error', error => console.error(error));
	bot.on('event', event => bot.handleEvent(event));
};