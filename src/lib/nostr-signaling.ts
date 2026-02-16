import { getPublicKey, nip04, finalizeEvent } from 'nostr-tools';

interface NostrEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey?: string;
  id?: string;
  sig?: string;
}

export class NostrSignaling {
  private ws: WebSocket;
  private privateKey: Uint8Array;
  private publicKey: string;
  private relayUrl: string;
  private subscriptionId: string | null = null;
  
  // Callbacks
  onOffer: ((offer: RTCSessionDescriptionInit, callerPubkey: string, callId: string) => void) | null = null;
  onAnswer: ((answer: RTCSessionDescriptionInit, callerPubkey: string, callId: string) => void) | null = null;
  onIceCandidate: ((candidate: RTCIceCandidateInit, senderPubkey: string) => void) | null = null;
  onHangup: ((senderPubkey: string, callId: string) => void) | null = null;
  onReject: ((senderPubkey: string, callId: string) => void) | null = null;

  constructor(privateKey: Uint8Array, relayUrl: string = 'wss://relay.damus.io') {
    this.privateKey = privateKey;
    this.publicKey = getPublicKey(privateKey);
    this.relayUrl = relayUrl;
    this.ws = this.connectRelay();
  }

  private connectRelay(): WebSocket {
    const ws = new WebSocket(this.relayUrl);
    
    ws.onopen = () => {
      console.log('Connected to Nostr relay');
      this.subscribeToSignaling();
    };

    ws.onmessage = (event) => {
      this.handleRelayMessage(JSON.parse(event.data));
    };

    ws.onclose = () => {
      console.log('Disconnected from relay, reconnecting...');
      setTimeout(() => {
        this.ws = this.connectRelay();
      }, 3000);
    };

    return ws;
  }

  private subscribeToSignaling() {
    this.subscriptionId = `call-${Date.now()}`;
    
    const filter = {
      kinds: [25050, 25051, 25052, 25053, 25054],
      '#p': [this.publicKey],
      since: Math.floor(Date.now() / 1000) - 30, // Только последние 30 сек
    };

    this.ws.send(JSON.stringify(['REQ', this.subscriptionId, filter]));
  }

  private async handleRelayMessage(message: any[]) {
    if (message[0] !== 'EVENT') return;
    
    const event = message[2] as NostrEvent;
    
    // Не обрабатываем свои события
    if (event.pubkey === this.publicKey) return;
    
    try {
      // Расшифровываем содержимое (NIP-04)
      const decrypted = await nip04.decrypt(
        this.privateKey, 
        event.pubkey!,
        event.content
      );
      const data = JSON.parse(decrypted);
      const callId = event.tags.find(t => t[0] === 'call-id')?.[1] || '';
      
      switch (event.kind) {
        case 25050: // Offer
          this.onOffer?.(data.sdp, event.pubkey!, callId);
          break;
        case 25051: // Answer
          this.onAnswer?.(data.sdp, event.pubkey!, callId);
          break;
        case 25052: // ICE Candidate
          this.onIceCandidate?.(data.candidate, event.pubkey!);
          break;
        case 25053: // Hangup
          this.onHangup?.(event.pubkey!, callId);
          break;
        case 25054: // Reject
          this.onReject?.(event.pubkey!, callId);
          break;
      }
    } catch (err) {
      console.error('Failed to process signaling event:', err);
    }
  }

  private async sendSignalingEvent(
    kind: number,
    recipientPubkey: string,
    data: any,
    callId: string
  ) {
    // Шифруем данные (NIP-04)
    const encrypted = await nip04.encrypt(
      this.privateKey,
      recipientPubkey,
      JSON.stringify(data)
    );

    const event = finalizeEvent({
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientPubkey],
        ['call-id', callId],
        ['expiration', String(Math.floor(Date.now() / 1000) + 300)], // 5 мин TTL
      ],
      content: encrypted,
    }, this.privateKey);

    this.ws.send(JSON.stringify(['EVENT', event]));
  }

  async sendOffer(recipientPubkey: string, sdp: RTCSessionDescriptionInit, callId: string) {
    await this.sendSignalingEvent(25050, recipientPubkey, { sdp }, callId);
  }

  async sendAnswer(recipientPubkey: string, sdp: RTCSessionDescriptionInit, callId: string) {
    await this.sendSignalingEvent(25051, recipientPubkey, { sdp }, callId);
  }

  async sendIceCandidate(recipientPubkey: string, candidate: RTCIceCandidateInit, callId: string) {
    await this.sendSignalingEvent(25052, recipientPubkey, { candidate }, callId);
  }

  async sendHangup(recipientPubkey: string, callId: string) {
    await this.sendSignalingEvent(25053, recipientPubkey, {}, callId);
  }

  async sendReject(recipientPubkey: string, callId: string) {
    await this.sendSignalingEvent(25054, recipientPubkey, {}, callId);
  }

  destroy() {
    if (this.subscriptionId) {
      this.ws.send(JSON.stringify(['CLOSE', this.subscriptionId]));
    }
    this.ws.close();
  }
}
