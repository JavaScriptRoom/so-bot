
import { EventEmitter } from 'events';
import { stringify } from 'querystring';

import * as Bluebird from 'bluebird';
import * as WS from 'ws';
import { jar } from 'request';
import * as request from 'request-promise';
import * as cheerio from 'cheerio';

import { logger } from './logger';
import commands from './commands';

const BASE_URL = 'https://chat.stackoverflow.com';

// Thanks anal greg, https://github.com/awalgarg/sochatbot/blob/master/sechatapi/eventmaps.json
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

type WSMessage = {
    data: {
        e: any[]; //todo
        t: any; // todo
        d: any; // todo
    }
}

interface BotConfig {
    mainRoom: number;
    email: string;
    password: string;
    trigger: string;
}

export class Bot extends EventEmitter {
    private logger = logger;
    private jar = jar();
    private fkey: string;
    private ws: WS;
    private rooms = {};
    private mainRoom: number;
    private email: string;
    private password: string;
    private trigger: string;

    constructor(config: BotConfig) {
        super();
        this.mainRoom = config.mainRoom;
        this.email = config.email;
        this.password = config.password;
        this.trigger = config.trigger;
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
    async createWsConnection(roomid: number, fkey: string) {
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
    async join(roomid?: number) {
        const originalRoom = roomid === undefined;
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
            ws.on('message', (message) => {
                const json = JSON.parse(message.toString()) as WSMessage;
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
        return new Bluebird(resolve => {
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
    async apiRequest(path: string, form: { [key: string]: string }) {
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
    send(text: string, roomid: number) {
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
    edit(text: string, messageId: number) {
        const path = `messages/${messageId}`;
        return this.apiRequest(path, {
            text,
            fkey: this.fkey
        });
    }
    handleEvent(event: any /* todo */) {
        this.logger.debug(event);
        if(event.event_type === 1) {
            // temporary
            const matched = splitByUnquotedSpaces(event.content.replace('&quot;', '"'));
            this.logger.debug(matched);
            if(matched) {
                const [command, ...args] = matched;
                if (!command.startsWith(this.trigger)) { return; }
                const commandWithoutTrigger = command.replace(this.trigger, '');
                if(typeof commands[commandWithoutTrigger] === 'function') {
                    this.logger.debug(`Matched command ${command} with args ${args.join(' ')}`);
                    commands[commandWithoutTrigger].call(this, { args, event }, (text: string, room = event.room_id) => this.send(text, room));
                }
            }
        }
    }
}

function splitByUnquotedSpaces(str: string) {
    return str.match(/([^\s"]+)|"([^"]*)"/g);
}