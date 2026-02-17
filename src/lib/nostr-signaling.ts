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
  private isDestroyed = false;
  private pastEventsIgnored = false; // Флаг для EOSE

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

  getPublicKey(): string {
    return this.publicKey;
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
      if (this.isDestroyed) {
        console.log('NostrSignaling destroyed, not reconnecting.');
        return;
      }
      console.log('Disconnected from relay, reconnecting...');
      setTimeout(() => {
        if (this.isDestroyed) return;
        this.ws = this.connectRelay();
      }, 3000);
    };
    
    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    }

    return ws;
  }

  private subscribeToSignaling() {
    this.subscriptionId = `call-${Date.now()}`;
    this.pastEventsIgnored = false; // Сбрасываем флаг при каждой новой подписке

    const filter = {
      kinds: [25050, 25051, 25052, 25053, 25054],
      '#p': [this.publicKey],
      since: Math.floor(Date.now() / 1000) - 5 // Запрашиваем события за последние 5 секунд на всякий случай
    };

    this.ws.send(JSON.stringify(['REQ', this.subscriptionId, filter]));
  }

  private async handleRelayMessage(message: any[]) {
    const type = message[0];
    const subId = message[1];

    if (subId !== this.subscriptionId) {
      return; // Сообщение от другой подписки
    }

    if (type === 'EOSE') {
      console.log('EOSE received, processing live events.');
      this.pastEventsIgnored = true;
      return;
    }

    if (type === 'EVENT') {
      // Игнорируем ВСЕ события до получения EOSE
      if (!this.pastEventsIgnored) {
        return;
      }

      const event = message[2] as NostrEvent;

      if (event.pubkey === this.publicKey) {
        return; // Игнорируем свои же события
      }

      try {
        const decrypted = await nip04.decrypt(
          this.privateKey,
          event.pubkey!,
          event.content
        );
        const data = JSON.parse(decrypted);
        const callIdTag = event.tags.find(t => t[0] === 'call-id');
        if (!callIdTag) return;

        const callId = callIdTag[1];

        switch (event.kind) {
          case 25050: this.onOffer?.(data.sdp, event.pubkey!, callId); break;
          case 25051: this.onAnswer?.(data.sdp, event.pubkey!, callId); break;
          case 25052: this.onIceCandidate?.(data.candidate, event.pubkey!); break;
          case 25053: this.onHangup?.(event.pubkey!, callId); break;
          case 25054: this.onReject?.(event.pubkey!, callId); break;
        }
      } catch (err) {
        // Ошибки расшифровки - это нормально, если сообщения не для нас
      }
    }
  }

  private async sendSignalingEvent(kind: number, recipientPubkey: string, data: any, callId: string) {
    const encrypted = await nip04.encrypt(this.privateKey, recipientPubkey, JSON.stringify(data));

    const event = finalizeEvent({
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientPubkey],
        ['call-id', callId],
        // Срок жизни события в 60 секунд
        ['expiration', String(Math.floor(Date.now() / 1000) + 60)],
      ],
      content: encrypted,
    }, this.privateKey);

    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(['EVENT', event]));
    } else {
      console.error("WebSocket not open. Could not send event.");
    }
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
    this.isDestroyed = true;
    if (this.subscriptionId && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(['CLOSE', this.subscriptionId]));
    }
    if (this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
    }
  }
}