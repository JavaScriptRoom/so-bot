const { EventEmitter } = require('events');
const { stringify } = require('querystring');

const Promise = require('bluebird');
const WS = require('ws');
const { jar } = require('request');
const request = require('request-promise');
const cheerio = require('cheerio');

const BASE_URL = 'https://chat.stackoverflow.com';

class Bot extends EventEmitter {
    constructor(mainRoom) {
        super(EventEmitter);
        Object.assign(this, {
            mainRoom,
            jar: jar(),
            fkey: null,
            rooms: {}
        });
    }
    async auth(email, password) {
        const body = await request({
            method: 'GET',
            uri: 'https://stackoverflow.com/users/login',
            jar: this.jar
        });
        const $ = cheerio.load(body);
        const fkey = $('input[name="fkey"]').val();
        return request({
            method: 'POST',
            uri: 'https://stackoverflow.com/users/login',
            jar: this.jar,
            followAllRedirects: true,
            form: {
                email, password, fkey
            }
        });
    }
    async connect() {
        const body = await request({
            method: 'GET',
            uri: BASE_URL,
            jar: this.jar
        });
        const $ = cheerio.load(body);
        this.fkey = $('input[name="fkey"]').val();
        return body;
    }
    async createWsConnection(roomid, fkey) {
        const form = stringify({ roomid, fkey });
        const body = await request({
            method: 'POST',
            uri: `${BASE_URL}/ws-auth`,
            jar: this.jar,
            body: form,
            headers: {
                Origin: BASE_URL,
                Referer: `${BASE_URL}/rooms/${roomid}`,
                'Content-Length': form.length,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        const wsAddress = JSON.parse(body).url;
        return new WS(`${wsAddress}?l=99999999999`, { origin: BASE_URL });
    }
    async join(roomid = null) {
        if (!this.fkey) {
            throw new Error('Not connected');
        }
        if (!roomid) {
            roomid = this.mainRoom;
        }
        if (this.rooms[roomid]) {
            throw new Error(`Already joined room ${roomid}`);
        }
        const ws = await this.createWsConnection(roomid, this.fkey);
        this.rooms[roomid] = ws;
        ws.on('error', error => this.emit('error', error));
        ws.on('message', (message, flags) => {
            const json = JSON.parse(message);
            for (let [room, data] of Object.entries(json)) {
                if (data.e && Array.isArray(data.e) && (data.t != data.d)) {
                    data.e.forEach(event => {
                        this.emit('event', { room, event })
                    });
                }
            }
        });
        ws.once('open', () => {
            this.emit('room-open', roomid);
        });
    }
    async leave(roomid = 'all') {
        if (!this.fkey) {
            throw new Error('Not connected');
        }
        if (!this.rooms[roomid]) {
            throw new Error(`Not connected to room ${roomid}`);
        }
        if (roomid === 'all') {
            for (const ws of Object.values(this.rooms)) {
                if (ws && ws.readyState !== WS.CLOSED) {
                    ws.close();
                }
            }
        } else {
            const ws = this.rooms[roomid];
            if (ws && ws.readyState !== WS.CLOSED) {
                ws.close();
            }
        }
        return request({
            method: 'POST',
            uri: `${BASE_URL}/chats/leave/${roomid}`,
            jar: this.jar,
            form: {
                quiet: true,
                fkey: this.fkey
            }
        });
    }
    async apiRequest(path, form) {
        const response = await request({
            method: 'POST',
            uri: `${BASE_URL}/${path}`,
            form
        });
        return (response && response.length) ? JSON.parse(response) : {};
    }
    send(text, roomid) {
        if (!roomid) {
            roomid = this.mainRoom;
        }
        const path = `/chats/${roomid}/messages/new`;
        return this.apiRequest(path, { text }).then(data => data.id);
    }
    edit(text, messageId) {
        const path = `/messages/${messageId}`;
        return this.apiRequest(path, { text });
    }
    handleEvent({ room, event }) {
        console.log(room);
        console.log(event);
    }
}

module.exports = Bot;