import { OAuth2Token } from 'homey-oauth2app';

export default class TuyaOAuth2Token extends OAuth2Token {
  endpoint: string;
  uid: string;
  expire_time: number;
  terminal_id: string;
  username: string;

  constructor({
    endpoint,
    uid,
    expire_time,
    terminal_id,
    username,
    ...props
  }: {
    endpoint: string;
    uid: string;
    expire_time: number;
    access_token: string;
    refresh_token: string;
    terminal_id: string;
    username: string;
  }) {
    super({ ...props });

    this.endpoint = endpoint;
    this.uid = uid;
    this.expire_time = expire_time;
    this.terminal_id = terminal_id;
    this.username = username;
  }

  toJSON(): {
    access_token: string;
    refresh_token: string;
    uid: string;
    expire_time: number;
    endpoint: string;
    terminal_id: string;
    username: string;
  } {
    return {
      ...super.toJSON(),
      endpoint: this.endpoint,
      uid: this.uid,
      expire_time: this.expire_time,
      terminal_id: this.terminal_id,
      username: this.username,
    };
  }
}

module.exports = TuyaOAuth2Token;
