import { EventEmitter } from 'events';
import { stringify } from 'querystring';

import Promise from 'bluebird';
import WS from 'ws';
import { jar } from 'request';
import request from 'request-promise';
import cheerio from 'cheerio';

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
    auth(email, password) {
        return request({
            method: 'GET',
            uri: 'https://stackoverflow.com/users/login',
            jar: this.jar
        }).then(body => {
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
        });
    }
    connect() {
        return request({
            method: 'GET',
            uri: BASE_URL,
            jar: this.jar
        }).then(body => {
            const $ = cheerio.load(body);
            this.fkey = $('input[name="fkey"]').val();
        });
    }
    createWsConnection(roomid, fkey) {
        const form = stringify({ roomid, fkey });
        return request({
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
        })
        .then(body => JSON.parse(body).url)
        .then(wsAddress => new WS(`${wsAddress}?l=99999999999`, { origin: BASE_URL }));
    }
    listen(roomid) {
        if(!this.fkey) {
            throw new Error('Not connected');
        }
        if(!roomid) {
            roomid = this.mainRoom;
        }
        this.rooms.add(roomid);
        return this.createWsConnection(roomid, this.fkey).then(ws => {
            this.ws = ws;
            this.ws.on('error', error => this.emit('error', error));
            this.ws.on('message', (message, flags) => {
                const data = JSON.parse(message);
                console.log(data);
                for(let room of Object.entries(data)) {
                    if(room.e && (room.t != room.d)) {
                        room.e.forEach(event => this.emit('event', event));
                    }
                }
            });
            return new Promise(resolve => {
                this.ws.once('open', () => {
                    this.emit('open');
                    resolve();
                });
            });
        });
    }
    join(roomid) {
        if(this.rooms.has(roomid)) {
            throw new Error(`Already joined room ${roomid}`);
        }
        this.rooms.add(roomid);
        return this.createWsConnection(roomid, this.fkey).then(ws => {
            ws.on('open', () => ws.close());
        });
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
    apiRequest(path, form) {
        return request({
            method: 'POST',
            uri: `${BASE_URL}/${path}`,
            form
        }).then(response => {
            return (response && response.length) ? JSON.parse(response) : {};
        });
    }
    send(text, roomid) {
        if(!roomid) {
            roomid = this.mainRoom;
        }
        const path = `/chats/${roomid}/messages/new`;
        return this.apiRequest(path, { text }).then(data => data.id);
    }
    edit(text, messageId) {
        const path = `/messages/${messageId}`;
        return this.apiRequest(path, { text });
    }
    handleEvent(event) {
        
    }
}

export default Bot;