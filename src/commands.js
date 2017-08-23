const request = require('request-promise');
const cheerio = require('cheerio');

module.exports = {
    echo({ args, event }, reply) {
        reply(args.join(' '));
    },
    countArgs({ args, event }, reply) {
        reply(args.map((arg, i) => `${i}:${arg}`).join(' '));
    },
    async mdn({ args, event }, reply) {
        const body = await request(`https://developer.mozilla.org/en-US/search?q=${args.join(' ')}`);
        const $ = cheerio.load(body);
        const results = $('.result-list .result-list-item h4 a').map((i, link) => {
            return `[${$(link).text()}](${$(link).attr('href')})`;
        }).get();
        const result = `:${event.message_id} MDN: ${results.slice(0, 5).join(', ')}`;
        reply(result);
    }
};