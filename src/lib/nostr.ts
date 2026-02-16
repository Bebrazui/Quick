import { generateSecretKey, getPublicKey, finalizeEvent, type UnsignedEvent } from 'nostr-tools/pure';
import { encrypt, decrypt } from 'nostr-tools/nip04';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { Filter } from 'nostr-tools';
import { ensureTransfer, isTransferComplete, storeChunk } from './chunkStore';

export interface NostrProfile {
  name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type MessageType =
  | 'text'
  | 'image'
  | 'file'
  | 'file-meta'
  | 'file-chunk'
  | 'channel'
  | 'webrtc-offer'
  | 'webrtc-answer'
  | 'webrtc-ice'
  | 'call-request'
  | 'call-accept'
  | 'call-reject'
  | 'call-end';

export interface ReplyRef {
  id: string;
  from: string;
  text: string;
}

export interface Attachment {
  type: 'image' | 'file';
  name: string;
  mimeType: string;
  data: string;
  size: number;
  file?: File;
  transferId?: string;
  totalChunks?: number;
  chunked?: boolean;
}

export interface DirectMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  pending?: boolean;
  failed?: boolean;
  msgType?: MessageType;
  attachment?: Attachment;
  replyTo?: ReplyRef;
  channelId?: string;
}

export interface Channel {
  id: string;
  name: string;
  about?: string;
  createdBy: string;
  createdAt: number;
}

export interface Contact {
  pubkey: string;
  name?: string;
  about?: string;
  picture?: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unread?: number;
  online?: boolean;
}

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://purplepag.es',
  'wss://nostr.mom',
  'wss://relay.nostr.bg',
];

type MessageCallback = (msg: DirectMessage) => void;
type ChannelCallback = (channel: Channel) => void;
type ChannelMessageCallback = (msg: DirectMessage) => void;
type ProfileCallback = (pubkey: string, profile: NostrProfile) => void;
type ConnectionCallback = (relay: string, status: 'connected' | 'disconnected' | 'error') => void;
type SignalCallback = (from: string, signal: WebRTCSignal) => void;

export interface WebRTCSignal {
  type: MessageType;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  callType?: 'audio' | 'video';
}

class NostrClient {
  private _sk: Uint8Array | null = null;
  private _pk: string = '';
  private sockets: Map<string, WebSocket> = new Map();
  private relayStatus: Map<string, 'connected' | 'disconnected' | 'connecting' | 'error'> = new Map();
  private subscriptions: Map<string, { filters: Filter[]; relay: string }> = new Map();
  private messageCallbacks: Set<MessageCallback> = new Set();
  private channelCallbacks: Set<ChannelCallback> = new Set();
  private channelMessageCallbacks: Set<ChannelMessageCallback> = new Set();
  private profileCallbacks: Set<ProfileCallback> = new Set();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private signalCallbacks: Set<SignalCallback> = new Set();
  private profileCache: Map<string, NostrProfile> = new Map();
  private pendingProfiles: Set<string> = new Set();
  private seenEvents: Set<string> = new Set();
  private _relays: string[] = [...DEFAULT_RELAYS];
  private reconnectAttempts: Map<string, number> = new Map();
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private _stopped = false;
  private _channels: string[] = [];

  get publicKey(): string { return this._pk; }
  get privateKeyHex(): string { return this._sk ? bytesToHex(this._sk) : ''; }
  get relays(): string[] { return [...this._relays]; }
  get channels(): string[] { return [...this._channels]; }
  get sk(): Uint8Array | null { return this._sk; }

  getRelayStatus(relay: string): string {
    return this.relayStatus.get(relay) || 'disconnected';
  }

  get connectedRelayCount(): number {
    let c = 0;
    for (const s of this.relayStatus.values()) if (s === 'connected') c++;
    return c;
  }

  generateKeys() {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    return { privateKey: bytesToHex(sk), publicKey: pk };
  }

  login(privateKeyHex: string): string {
    const sk = hexToBytes(privateKeyHex);
    const pk = getPublicKey(sk);
    this._sk = sk; this._pk = pk; this._stopped = false;
    localStorage.setItem('nostr_sk', privateKeyHex);
    return pk;
  }

  logout() {
    this._stopped = true; this.disconnectAll();
    this._sk = null; this._pk = '';
    localStorage.removeItem('nostr_sk');
    localStorage.removeItem('nostr_contacts');
  }

  tryAutoLogin(): boolean {
    const sk = localStorage.getItem('nostr_sk');
    if (sk?.length === 64) { try { this.login(sk); return true; } catch { localStorage.removeItem('nostr_sk'); } }
    return false;
  }

  onMessage(cb: MessageCallback) { this.messageCallbacks.add(cb); return () => { this.messageCallbacks.delete(cb); }; }
  onChannel(cb: ChannelCallback) { this.channelCallbacks.add(cb); return () => { this.channelCallbacks.delete(cb); }; }
  onChannelMessage(cb: ChannelMessageCallback) { this.channelMessageCallbacks.add(cb); return () => { this.channelMessageCallbacks.delete(cb); }; }
  onProfile(cb: ProfileCallback) { this.profileCallbacks.add(cb); return () => { this.profileCallbacks.delete(cb); }; }
  onConnection(cb: ConnectionCallback) { this.connectionCallbacks.add(cb); return () => { this.connectionCallbacks.delete(cb); }; }
  onSignal(cb: SignalCallback) { this.signalCallbacks.add(cb); return () => { this.signalCallbacks.delete(cb); }; }

  async connectToRelays() { for (const r of this._relays) this.connectToRelay(r); }

  setChannels(channelIds: string[]) {
    this._channels = [...new Set(channelIds.filter(Boolean))];
    for (const [relay, ws] of this.sockets) {
      if (ws.readyState === WebSocket.OPEN) this.subscribeToChannels(relay);
    }
  }

  private connectToRelay(url: string) {
    if (this._stopped) return;
    if (this.sockets.has(url)) {
      const e = this.sockets.get(url)!;
      if (e.readyState === WebSocket.OPEN || e.readyState === WebSocket.CONNECTING) return;
    }
    this.relayStatus.set(url, 'connecting');
    this.connectionCallbacks.forEach(cb => cb(url, 'disconnected'));
    try {
      const ws = new WebSocket(url);
      const ct = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 8000);
      this.sockets.set(url, ws);
      ws.onopen = () => { clearTimeout(ct); this.reconnectAttempts.set(url, 0); this.relayStatus.set(url, 'connected'); this.connectionCallbacks.forEach(cb => cb(url, 'connected')); this.subscribeToMessages(url); };
      ws.onclose = () => { clearTimeout(ct); this.relayStatus.set(url, 'disconnected'); this.connectionCallbacks.forEach(cb => cb(url, 'disconnected')); this.sockets.delete(url); this.scheduleReconnect(url); };
      ws.onerror = () => { this.relayStatus.set(url, 'error'); this.connectionCallbacks.forEach(cb => cb(url, 'error')); };
      ws.onmessage = (e) => { try { this.handleRelayMessage(JSON.parse(e.data)); } catch {} };
    } catch { this.relayStatus.set(url, 'error'); this.scheduleReconnect(url); }
  }

  private scheduleReconnect(url: string) {
    if (this._stopped) return;
    const e = this.reconnectTimers.get(url); if (e) clearTimeout(e);
    const a = this.reconnectAttempts.get(url) || 0;
    const d = Math.min(3000 * Math.pow(2, a), 60000);
    this.reconnectAttempts.set(url, a + 1);
    this.reconnectTimers.set(url, setTimeout(() => { if (!this._stopped && this._sk) this.connectToRelay(url); }, d));
  }

  private handleRelayMessage(data: unknown[]) {
    if (!Array.isArray(data)) return;
    if (data[0] === 'EVENT') {
      const ev = data[2] as NostrEvent;
      if (!ev || this.seenEvents.has(ev.id)) return;
      this.seenEvents.add(ev.id);
      if (ev.kind === 4) this.handleEncryptedDM(ev);
      else if (ev.kind === 0) this.handleProfileEvent(ev);
      else if (ev.kind === 40) this.handleChannelEvent(ev);
      else if (ev.kind === 42) this.handleChannelMessageEvent(ev);
    }
  }

  private async handleEncryptedDM(event: NostrEvent) {
    if (!this._sk) return;
    const pTag = event.tags.find(t => t[0] === 'p'); if (!pTag) return;
    const isForMe = pTag[1] === this._pk, isFromMe = event.pubkey === this._pk;
    if (!isForMe && !isFromMe) return;
    const other = isFromMe ? pTag[1] : event.pubkey;
    try {
      const dec = await decrypt(this._sk, other, event.content);
      try {
        const p = JSON.parse(dec);
          if (p?._nostr_msg_type) {
            const mt = p._nostr_msg_type as MessageType;
            if (mt === 'text') {
              this.messageCallbacks.forEach(cb => cb({
                id: event.id,
                from: event.pubkey,
                to: pTag[1],
                content: (p.text as string) || '',
                timestamp: event.created_at * 1000,
                msgType: 'text',
                replyTo: p.replyTo as ReplyRef | undefined,
              }));
              return;
            }
            if (['webrtc-offer','webrtc-answer','webrtc-ice','call-request','call-accept','call-reject','call-end'].includes(mt)) {
            this.signalCallbacks.forEach(cb => cb(event.pubkey, { type: mt, sdp: p.sdp, candidate: p.candidate, callType: p.callType }));
            return;
          }
          if (mt === 'file-chunk') { this.handleFileChunk(event.id, event.pubkey, pTag[1], event.created_at * 1000, p); return; }
          if (mt === 'file-meta') {
            const transferId = (p.transferId as string) || '';
            if (!transferId) return;
            await ensureTransfer({
              transferId,
              fileName: (p.fileName as string) || 'file',
              mimeType: (p.mimeType as string) || 'application/octet-stream',
              fileType,
              size: (p.size as number) || 0,
              totalChunks: (p.totalChunks as number) || 0,
              text: (p.text as string) || '',
            });
            return;
          }
          if (mt === 'image' || mt === 'file') {
            this.messageCallbacks.forEach(cb => cb({ id: event.id, from: event.pubkey, to: pTag[1], content: p.text || '', timestamp: event.created_at * 1000, msgType: mt, replyTo: p.replyTo as ReplyRef | undefined, attachment: { type: mt, name: p.fileName || 'file', mimeType: p.mimeType || 'application/octet-stream', data: p.data || '', size: p.size || 0 } }));
            return;
          }
        }
      } catch {}
      this.messageCallbacks.forEach(cb => cb({ id: event.id, from: event.pubkey, to: pTag[1], content: dec, timestamp: event.created_at * 1000, msgType: 'text' }));
    } catch {}
  }

  private async handleFileChunk(eventId: string, from: string, to: string, timestamp: number, p: Record<string, unknown>) {
    const transferId = p.transferId as string;
    const chunkIndex = p.chunkIndex as number;
    const totalChunks = p.totalChunks as number;
    const data = p.data as string;
    if (!transferId || typeof chunkIndex !== 'number' || typeof totalChunks !== 'number' || typeof data !== 'string') return;

    const fileType = (p.fileType as string) === 'image' ? 'image' : 'file';
    await ensureTransfer({
      transferId,
      fileName: (p.fileName as string) || 'file',
      mimeType: (p.mimeType as string) || 'application/octet-stream',
      fileType,
      size: (p.size as number) || 0,
      totalChunks,
      text: (p.text as string) || '',
    });
    await storeChunk(transferId, chunkIndex, totalChunks, data);
    const done = await isTransferComplete(transferId);
    if (!done) return;

    this.messageCallbacks.forEach(cb => cb({
      id: `${eventId}-assembled-${transferId}`,
      from,
      to,
      content: (p.text as string) || '',
      timestamp,
      msgType: fileType,
      replyTo: p.replyTo as ReplyRef | undefined,
      attachment: {
        type: fileType,
        name: (p.fileName as string) || 'file',
        mimeType: (p.mimeType as string) || 'application/octet-stream',
        data: '',
        size: (p.size as number) || 0,
        transferId,
        totalChunks,
        chunked: true,
      },
    }));
  }

  private handleProfileEvent(event: NostrEvent) {
    try { const p = JSON.parse(event.content) as NostrProfile; this.profileCache.set(event.pubkey, p); this.pendingProfiles.delete(event.pubkey); this.profileCallbacks.forEach(cb => cb(event.pubkey, p)); } catch {}
  }

  private handleChannelEvent(event: NostrEvent) {
    try {
      const payload = JSON.parse(event.content) as { name?: string; about?: string };
      const channel: Channel = {
        id: event.id,
        name: payload.name?.trim() || `channel-${event.id.slice(0, 8)}`,
        about: payload.about,
        createdBy: event.pubkey,
        createdAt: event.created_at * 1000,
      };
      this.channelCallbacks.forEach(cb => cb(channel));
    } catch {}
  }

  private handleChannelMessageEvent(event: NostrEvent) {
    const eTag = event.tags.find(t => t[0] === 'e')?.[1];
    if (!eTag) return;
    try {
      const payload = JSON.parse(event.content) as { text?: string; replyTo?: ReplyRef };
      this.channelMessageCallbacks.forEach(cb => cb({
        id: event.id,
        from: event.pubkey,
        to: '',
        content: payload.text || '',
        timestamp: event.created_at * 1000,
        msgType: 'channel',
        channelId: eTag,
        replyTo: payload.replyTo,
      }));
    } catch {
      this.channelMessageCallbacks.forEach(cb => cb({
        id: event.id,
        from: event.pubkey,
        to: '',
        content: event.content || '',
        timestamp: event.created_at * 1000,
        msgType: 'channel',
        channelId: eTag,
      }));
    }
  }

  private subscribeToMessages(relayUrl: string) {
    if (!this._pk) return;
    const ws = this.sockets.get(relayUrl); if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const subId = 'dm-' + Math.random().toString(36).slice(2, 8);
    const since = Math.floor(Date.now() / 1000) - 86400 * 30;
    ws.send(JSON.stringify(['REQ', subId, { kinds: [4], '#p': [this._pk], since }, { kinds: [4], authors: [this._pk], since }]));
    this.subscriptions.set(subId, { filters: [], relay: relayUrl });
    this.subscribeToChannels(relayUrl);
  }

  private subscribeToChannels(relayUrl: string) {
    const ws = this.sockets.get(relayUrl); if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const subId = 'ch-' + Math.random().toString(36).slice(2, 8);
    const since = Math.floor(Date.now() / 1000) - 86400 * 30;
    if (this._channels.length > 0) {
      ws.send(JSON.stringify(['REQ', subId, { kinds: [40], ids: this._channels, since }, { kinds: [42], '#e': this._channels, since }]));
    } else {
      ws.send(JSON.stringify(['REQ', subId, { kinds: [40], limit: 50, since }]));
    }
    this.subscriptions.set(subId, { filters: [], relay: relayUrl });
  }

  async sendEncryptedPayload(recipientPubkey: string, payload: string): Promise<string> {
    if (!this._sk) throw new Error('Не авторизован');
    const encrypted = await encrypt(this._sk, recipientPubkey, payload);
    const ev: UnsignedEvent = { kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipientPubkey]], content: encrypted, pubkey: this._pk };
    const event = finalizeEvent(ev, this._sk);
    this.seenEvents.add(event.id);
    const json = JSON.stringify(['EVENT', event]);
    const open: WebSocket[] = [];
    for (const [, ws] of this.sockets) if (ws.readyState === WebSocket.OPEN) open.push(ws);
    if (!open.length) throw new Error('Нет подключённых релеев');
    open.forEach(ws => { try { ws.send(json); } catch {} });
    return event.id;
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(bin);
  }

  async sendDirectMessage(recipientPubkey: string, content: string, replyTo?: ReplyRef): Promise<DirectMessage> {
    const payload = replyTo ? JSON.stringify({ _nostr_msg_type: 'text', text: content, replyTo }) : content;
    const id = await this.sendEncryptedPayload(recipientPubkey, payload);
    return { id, from: this._pk, to: recipientPubkey, content, timestamp: Date.now(), msgType: 'text', replyTo };
  }

  // 256KB chunks, parallel send by 3
  private static CHUNK_SIZE = 262144;
  private static PARALLEL = 3;

  async sendAttachment(
    recipientPubkey: string,
    attachment: Attachment,
    text?: string,
    onProgress?: (sent: number, total: number) => void,
    replyTo?: ReplyRef,
  ): Promise<DirectMessage> {
    const maxSize = 2 * 1024 * 1024 * 1024;
    if (attachment.size > maxSize) throw new Error('File is too large. Max size is 2GB.');

    if (!attachment.file) {
      const b64 = attachment.data;
      if (b64.length < 40000) {
        const id = await this.sendEncryptedPayload(recipientPubkey, JSON.stringify({
          _nostr_msg_type: attachment.type,
          fileName: attachment.name,
          mimeType: attachment.mimeType,
          data: b64,
          size: attachment.size,
          text: text || '',
          replyTo,
        }));
        return { id, from: this._pk, to: recipientPubkey, content: text || '', timestamp: Date.now(), msgType: attachment.type, attachment, replyTo };
      }
    }

    const file = attachment.file;
    const transferId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const fileSize = file ? file.size : attachment.size;
    const totalChunks = Math.ceil(fileSize / NostrClient.CHUNK_SIZE);
    let lastId = '';
    let sent = 0;

    await this.sendEncryptedPayload(recipientPubkey, JSON.stringify({
      _nostr_msg_type: 'file-meta',
      transferId,
      totalChunks,
      fileName: attachment.name,
      mimeType: attachment.mimeType,
      size: fileSize,
      text: text || '',
      fileType: attachment.type,
      replyTo,
    }));

    for (let batch = 0; batch < totalChunks; batch += NostrClient.PARALLEL) {
      const promises: Promise<string>[] = [];
      for (let j = 0; j < NostrClient.PARALLEL && batch + j < totalChunks; j++) {
        const i = batch + j;
        if (file) {
          const start = i * NostrClient.CHUNK_SIZE;
          const end = Math.min(start + NostrClient.CHUNK_SIZE, fileSize);
          const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
          const data = this.bytesToBase64(bytes);
          promises.push(this.sendEncryptedPayload(recipientPubkey, JSON.stringify({
            _nostr_msg_type: 'file-chunk',
            transferId,
            chunkIndex: i,
            totalChunks,
            data,
            fileName: attachment.name,
            mimeType: attachment.mimeType,
            size: fileSize,
            text: text || '',
            fileType: attachment.type,
            replyTo,
          })));
        } else {
          const base64ChunkSize = Math.floor((NostrClient.CHUNK_SIZE / 3) * 4);
          const chunk = attachment.data.slice(i * base64ChunkSize, (i + 1) * base64ChunkSize);
          promises.push(this.sendEncryptedPayload(recipientPubkey, JSON.stringify({
            _nostr_msg_type: 'file-chunk',
            transferId,
            chunkIndex: i,
            totalChunks,
            data: chunk,
            fileName: attachment.name,
            mimeType: attachment.mimeType,
            size: fileSize,
            text: text || '',
            fileType: attachment.type,
            replyTo,
          })));
        }
      }
      const ids = await Promise.all(promises);
      lastId = ids[ids.length - 1] || lastId;
      sent += promises.length;
      onProgress?.(sent, totalChunks);
      if (sent < totalChunks) await new Promise(r => setTimeout(r, 50));
    }

    return {
      id: lastId || `local-${transferId}`,
      from: this._pk,
      to: recipientPubkey,
      content: text || '',
      timestamp: Date.now(),
      msgType: attachment.type,
      replyTo,
      attachment: {
        ...attachment,
        data: attachment.file ? '' : attachment.data,
        transferId,
        totalChunks,
        chunked: true,
      },
    };
  }

  async sendWebRTCSignal(recipientPubkey: string, signal: WebRTCSignal) {
    await this.sendEncryptedPayload(recipientPubkey, JSON.stringify({ _nostr_msg_type: signal.type, sdp: signal.sdp, candidate: signal.candidate, callType: signal.callType }));
  }

  async createChannel(name: string, about?: string): Promise<Channel> {
    if (!this._sk) throw new Error('Not authorized');
    const ev: UnsignedEvent = {
      kind: 40,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({ name, about: about || '' }),
      pubkey: this._pk,
    };
    const event = finalizeEvent(ev, this._sk);
    const payload = JSON.stringify(['EVENT', event]);
    for (const [, ws] of this.sockets) if (ws.readyState === WebSocket.OPEN) try { ws.send(payload); } catch {}
    const channel: Channel = { id: event.id, name, about, createdBy: this._pk, createdAt: Date.now() };
    this.channelCallbacks.forEach(cb => cb(channel));
    return channel;
  }

  async sendChannelMessage(channelId: string, text: string, replyTo?: ReplyRef): Promise<DirectMessage> {
    if (!this._sk) throw new Error('Not authorized');
    const ev: UnsignedEvent = {
      kind: 42,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['e', channelId, '', 'root']],
      content: JSON.stringify({ text, replyTo }),
      pubkey: this._pk,
    };
    const event = finalizeEvent(ev, this._sk);
    const payload = JSON.stringify(['EVENT', event]);
    let sent = false;
    for (const [, ws] of this.sockets) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      sent = true;
      try { ws.send(payload); } catch {}
    }
    if (!sent) throw new Error('No connected relays');
    return {
      id: event.id,
      from: this._pk,
      to: '',
      content: text,
      timestamp: Date.now(),
      msgType: 'channel',
      channelId,
      replyTo,
    };
  }

  requestProfile(pubkey: string): NostrProfile | null {
    if (this.profileCache.has(pubkey)) return this.profileCache.get(pubkey)!;
    if (this.pendingProfiles.has(pubkey)) return null;
    this.pendingProfiles.add(pubkey);
    const subId = 'p-' + Math.random().toString(36).slice(2, 8);
    for (const [, ws] of this.sockets) { if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(['REQ', subId, { kinds: [0], authors: [pubkey], limit: 1 }])); break; } }
    return null;
  }

  getProfile(pubkey: string) { return this.profileCache.get(pubkey) || null; }

  async updateProfile(profile: NostrProfile) {
    if (!this._sk) throw new Error('Не авторизован');
    const ev: UnsignedEvent = { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(profile), pubkey: this._pk };
    const event = finalizeEvent(ev, this._sk);
    const json = JSON.stringify(['EVENT', event]);
    for (const [, ws] of this.sockets) if (ws.readyState === WebSocket.OPEN) try { ws.send(json); } catch {}
    this.profileCache.set(this._pk, profile);
  }

  disconnectAll() {
    for (const [, t] of this.reconnectTimers) clearTimeout(t);
    this.reconnectTimers.clear(); this.reconnectAttempts.clear();
    for (const [, ws] of this.sockets) ws.close();
    this.sockets.clear(); this.subscriptions.clear(); this.relayStatus.clear();
  }

  addRelay(url: string) { if (!this._relays.includes(url)) { this._relays.push(url); this.connectToRelay(url); } }
  removeRelay(url: string) {
    this._relays = this._relays.filter(r => r !== url);
    const t = this.reconnectTimers.get(url); if (t) { clearTimeout(t); this.reconnectTimers.delete(url); }
    this.reconnectAttempts.delete(url);
    const ws = this.sockets.get(url); if (ws) { ws.close(); this.sockets.delete(url); }
    this.relayStatus.delete(url);
  }

  shortenKey(key: string) { return (!key || key.length < 16) ? key : key.slice(0, 8) + '…' + key.slice(-8); }
  isValidHexKey(key: string) { return /^[0-9a-fA-F]{64}$/.test(key); }
}

export const nostrClient = new NostrClient();
export { DEFAULT_RELAYS };
