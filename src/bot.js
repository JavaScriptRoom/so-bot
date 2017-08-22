const {EventEmitter} = require('events');
const {stringify} = require('querystring');

const Promise = require('bluebird');
const WS = require('ws');
const {jar} = require('request');
const request = require('request-promise');
const cheerio = require('cheerio');

const BASE_URL = 'https://chat.stackoverflow.com';

class Bot extends EventEmitter {
    constructor(mainRoom) {
        super(EventEmitter);
        Object.assign(this, {
            mainRoom,
            jar: jar(),
            ws: null,
            fkey: null,
            rooms: new Set()
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
        const form = stringify({roomid, fkey});
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
        return new WS(`${wsAddress}?l=99999999999`, {origin: BASE_URL});
    }
    async listen(roomid) {
        if(!this.fkey) {
            throw new Error('Not connected');
        }
        if(!roomid) {
            roomid = this.mainRoom;
        }
        this.rooms.add(roomid);
        this.ws = await this.createWsConnection(roomid, this.fkey);
        this.ws.on('error', error => this.emit('error', error));
        this.ws.on('message', (message, flags) => {
            const json = JSON.parse(message);
            for(let [room, data] of Object.entries(json)) {
                if(data.e && Array.isArray(data.e) && (data.t != data.d)) {
                    data.e.forEach(event => {
                        this.emit('event', {room, event})
                    });
                }
            }
        });
        this.ws.once('open', () => {
            this.emit('open');
        });
    }
    async join(roomid) {
        if(this.rooms.has(roomid)) {
            throw new Error(`Already joined room ${roomid}`);
        }
        this.rooms.add(roomid);
        const ws = await this.createWsConnection(roomid, this.fkey);
        // TODO: implement rooms, for now just close the connection because it's not supported
        ws.on('open', () => ws.close());
    }
    leaveAll() {
        if(!this.fkey) {
            throw new Error('Not connected');
        }
        return request({
            method: 'POST',
            uri: `${BASE_URL}/chats/leave/all`,
            jar: this.jar,
            form: {
                quiet: true,
                fkey: this.fkey
            }
        });
    }
    quit(leave = false) {
        if(this.ws && this.ws.readyState !== WS.CLOSED) {
            this.ws.close();
        }
        if(this.fkey) {
            if(leave) {
                return this.leaveAll().then(() => this.emit('close'));
            } else {
                this.emit('close');
                return Promise.resolve();
            }
        }
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
        if(!roomid) {
            roomid = this.mainRoom;
        }
        const path = `/chats/${roomid}/messages/new`;
        return this.apiRequest(path, {text}).then(data => data.id);
    }
    edit(text, messageId) {
        const path = `/messages/${messageId}`;
        return this.apiRequest(path, {text});
    }
    handleEvent({room, event}) {
        console.log(room);
        console.log(event);
    }
}

module.exports = Bot;