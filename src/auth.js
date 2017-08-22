import request from 'request-promise';
import cheerio from 'cheerio';

export default (email, password) => {
	return request('https://stackoverflow.com/users/login').then(body => {
		const $ = cheerio.load(body);
		const fkey = $('input[name="fkey"]').val();
		return request({
			method: 'POST',
			uri: 'https://stackoverflow.com/users/login',
			followAllRedirects: true,
			form: {
				email, password, fkey
			}
		});
	});
};