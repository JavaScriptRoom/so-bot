const { EventEmitter } = require('events');
const { stringify } = require('querystring');

const Promise = require('bluebird');
const WS = require('ws');
const { jar } = require('request');
const request = require('request-promise');
const cheerio = require('cheerio');

const logger = require('./logger');
const commands = require('./commands');

const BASE_URL = 'https://chat.stackoverflow.com';
const EVENT_MAP = {
    "1": "MessagePosted",
    "2": "MessageEdited",
    "3": "UserEntered",
    "4": "UserLeft",
    "5": "RoomNameChanged",
    "6": "MessageStarred",
    "7": "DebugMessage",
    "8": "UserMentioned",
    "9": "MessageFlagged",
    "10": "MessageDeleted",
    "11": "FileAdded",
    "12": "ModeratorFlag",
    "13": "UserSettingsChanged",
    "14": "GlobalNotification",
    "15": "AccessLevelChanged",
    "16": "UserNotification",
    "17": "Invitation",
    "18": "MessageReply",
    "19": "MessageMovedOut",
    "20": "MessageMovedIn",
    "21": "TimeBreak",
    "22": "FeedTicker",
    "29": "UserSuspended",
    "30": "UserMerged",
    "34": "UserNameOrAvatarChanged"    
};

class Bot extends EventEmitter {
    constructor({ mainRoom, email, password, trigger}) {
        super(EventEmitter);
        Object.assign(this, {
            mainRoom,
            email,
            password,
            trigger,
            logger,
            jar: jar(),
            fkey: null,
            ws: null,
            rooms: {}
        });
    }
    async auth() {
        this.logger.debug(`Authenticating with email ${this.email}`);
        const body = await request({
            method: 'GET',
            uri: 'https://stackoverflow.com/users/login',
            jar: this.jar
        });
        const $ = cheerio.load(body);
        const fkey = $('input[name="fkey"]').val();
        this.logger.debug(`Using fkey ${fkey} to login`);
        return request({
            method: 'POST',
            uri: 'https://stackoverflow.com/users/login',
            jar: this.jar,
            followAllRedirects: true,
            form: {
                fkey,
                email: this.email,
                password: this.password
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
        this.logger.debug(`Setting bot fkey to ${this.fkey}`);
        return body;
    }
    async createWsConnection(roomid, fkey) {
        this.logger.debug(`Getting WS URL for room ${roomid}`);
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
        const originalRoom = roomid === null;
        if (!this.fkey) {
            throw new Error('Not connected');
        }
        if (!roomid) {
            roomid = this.mainRoom;
        }
        this.logger.debug(`Joining room ${roomid}`);
        const ws = await this.createWsConnection(roomid, this.fkey);
        if(!originalRoom) {
            ws.on('message', () => ws.close());
        } else {
            ws.on('error', error => this.emit('error', error));
            ws.on('message', (message, flags) => {
                const json = JSON.parse(message);
                for (let [room, data] of Object.entries(json)) {
                    if (data.e && Array.isArray(data.e) && (data.t != data.d)) {
                        data.e.forEach(event => {
                            this.emit('event', event)
                        });
                    }
                }
            });
            this.ws = ws;
        }
        return new Promise(resolve => {
            ws.once('open', () => {
                this.logger.debug(`Connected to room ${roomid}`);
                resolve();
            });
        });
    }
    async leave(roomid = 'all') {
        if (!this.fkey) {
            throw new Error('Not connected');
        }
        this.logger.debug(`Leaving room ${roomid}`);
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
        const uri = `${BASE_URL}/${path}`;
        this.logger.debug({
            uri,
            form,
            type: 'api_request'
        });
        const response = await request({
            uri,
            method: 'POST',
            jar: this.jar,
            form
        });
        return (response && response.length) ? JSON.parse(response) : {};
    }
    send(text, roomid) {
        if (!roomid) {
            roomid = this.mainRoom;
        }
        this.logger.debug(`Sending text message ${text} to room ${roomid}`);
        const path = `chats/${roomid}/messages/new`;
        return this.apiRequest(path, {
            text,
            fkey: this.fkey
        }).then(data => data.id);
    }
    edit(text, messageId) {
        const path = `messages/${messageId}`;
        return this.apiRequest(path, {
            text,
            fkey: this.fkey
        });
    }
    handleEvent(event) {
        this.logger.debug(event);
        if(event.event_type === 1) {
            // temporary
            const matched = event.content.replace('&quot;', '"').match(new RegExp(`([^\\s"]+)|"([^"]*)"`, 'g'));
            this.logger.debug(matched);
            if(matched) {
                const [command, ...args] = matched;
                const commandWithoutTrigger = command.replace(this.trigger, '');
                if(typeof commands[commandWithoutTrigger] === 'function') {
                    this.logger.debug(`Matched command ${command} with args ${args.join(' ')}`);
                    commands[commandWithoutTrigger].call(this, { args, event }, (text, room = event.room_id) => this.send(text, room));
                }
            }
        }
    }
}

module.exports = Bot;