module.exports = {
    echo({ args, event }, reply) {
        reply(args.join(' '));
    },
    countArgs({ args, event }, reply) {
        reply(args.map((arg, i) => `${i}:${arg}`).join(' '));
    }
};