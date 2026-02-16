import { nostrClient, type WebRTCSignal } from './nostr';

export type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended';
export type CallType = 'audio' | 'video';

type CallStateCallback = (state: CallState, remotePubkey: string | null, callType: CallType, error?: string) => void;
type StreamCallback = (local: MediaStream | null, remote: MediaStream | null) => void;

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
};

class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private _callState: CallState = 'idle';
  private _remotePubkey: string | null = null;
  private _callType: CallType = 'audio';
  private stateCallbacks: Set<CallStateCallback> = new Set();
  private streamCallbacks: Set<StreamCallback> = new Set();
  private iceCandidateQueue: RTCIceCandidateInit[] = [];
  private _callStartTime: number = 0;
  private _unsubSignal: (() => void) | null = null;
  private callTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryInterval: ReturnType<typeof setInterval> | null = null;
  private audioCtx: AudioContext | null = null;
  private audioOsc: OscillatorNode | null = null;
  // Предзахваченный стрим — берём медиа ДО звонка чтобы потом не ждать
  private preStream: MediaStream | null = null;

  get callState() { return this._callState; }
  get remotePubkey() { return this._remotePubkey; }
  get callType() { return this._callType; }
  get callStartTime() { return this._callStartTime; }

  onStateChange(cb: CallStateCallback) { this.stateCallbacks.add(cb); return () => { this.stateCallbacks.delete(cb); }; }
  onStream(cb: StreamCallback) { this.streamCallbacks.add(cb); return () => { this.streamCallbacks.delete(cb); }; }

  private setState(state: CallState, error?: string) {
    this._callState = state;
    if (state === 'connected') { this._callStartTime = Date.now(); this.stopRingtone(); }
    if (state === 'idle' || state === 'ended') this.stopRingtone();
    this.stateCallbacks.forEach(cb => cb(state, this._remotePubkey, this._callType, error));
  }

  private notifyStreams() {
    this.streamCallbacks.forEach(cb => cb(this.localStream, this.remoteStream));
  }

  private playRingtone() {
    this.stopRingtone();
    try {
      this.audioCtx = new AudioContext();
      this.audioOsc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      this.audioOsc.connect(gain);
      gain.connect(this.audioCtx.destination);
      this.audioOsc.frequency.value = 440;
      gain.gain.value = 0.08;
      this.audioOsc.start();
      const ctx = this.audioCtx;
      const pulse = () => {
        if (this._callState !== 'ringing' || !this.audioCtx) { try { this.audioOsc?.stop(); ctx.close(); } catch {} return; }
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        setTimeout(pulse, 1200);
      };
      pulse();
    } catch {}
  }

  private stopRingtone() {
    try { this.audioOsc?.stop(); } catch {}
    try { this.audioCtx?.close(); } catch {}
    this.audioOsc = null;
    this.audioCtx = null;
  }

  init() {
    if (this._unsubSignal) return;
    this._unsubSignal = nostrClient.onSignal((from, signal) => { this.handleSignal(from, signal); });
  }

  destroy() {
    if (this._unsubSignal) { this._unsubSignal(); this._unsubSignal = null; }
    this.cleanup(false);
  }

  private async handleSignal(from: string, signal: WebRTCSignal) {
    switch (signal.type) {
      case 'call-request':
        if (this._callState !== 'idle') {
          nostrClient.sendWebRTCSignal(from, { type: 'call-reject' }).catch(() => {});
          return;
        }
        this._remotePubkey = from;
        this._callType = signal.callType || 'audio';
        this.setState('ringing');
        this.playRingtone();
        this.callTimeout = setTimeout(() => { if (this._callState === 'ringing') this.rejectCall(); }, 45000);
        break;

      case 'call-accept':
        if ((this._callState === 'calling') && this._remotePubkey === from) {
          this.clearRetry();
          this.clearCallTimeout();
          this.setState('connecting');
          await this.startWebRTC(true);
        }
        break;

      case 'call-reject':
        if (this._remotePubkey === from) { this.cleanup(false); this.setState('idle', 'Звонок отклонён'); }
        break;

      case 'call-end':
        if (this._remotePubkey === from) this.cleanup(false);
        break;

      case 'webrtc-offer':
        if (this._remotePubkey === from && signal.sdp) await this.handleOffer(signal.sdp);
        break;

      case 'webrtc-answer':
        if (this._remotePubkey === from && signal.sdp) await this.handleAnswer(signal.sdp);
        break;

      case 'webrtc-ice':
        if (this._remotePubkey === from && signal.candidate) await this.handleIceCandidate(signal.candidate);
        break;
    }
  }

  private clearCallTimeout() { if (this.callTimeout) { clearTimeout(this.callTimeout); this.callTimeout = null; } }
  private clearRetry() { if (this.retryInterval) { clearInterval(this.retryInterval); this.retryInterval = null; } }

  async initiateCall(pubkey: string, type: CallType) {
    if (this._callState !== 'idle') return;

    // Захватываем медиа СРАЗУ — если не получится, сообщаем до начала звонка
    try {
      this.preStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
      });
    } catch (err) {
      // Если видео не получилось — пробуем только аудио
      if (type === 'video') {
        try {
          this.preStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          type = 'audio';
        } catch {
          this.setState('idle', this.mediaErrorMsg(err));
          return;
        }
      } else {
        this.setState('idle', this.mediaErrorMsg(err));
        return;
      }
    }

    this._remotePubkey = pubkey;
    this._callType = type;
    this.setState('calling');

    // Отправляем call-request и повторяем каждые 3 сек (Nostr ненадёжен)
    const sendReq = () => {
      nostrClient.sendWebRTCSignal(pubkey, { type: 'call-request', callType: type }).catch(() => {});
    };
    sendReq();
    this.retryInterval = setInterval(() => {
      if (this._callState === 'calling') sendReq();
      else this.clearRetry();
    }, 3000);

    // Таймаут 40 сек
    this.callTimeout = setTimeout(() => {
      if (this._callState === 'calling') {
        this.cleanup(true);
        this.setState('idle', 'Нет ответа');
      }
    }, 40000);
  }

  async acceptCall() {
    if (this._callState !== 'ringing' || !this._remotePubkey) return;
    this.clearCallTimeout();
    this.stopRingtone();
    this.setState('connecting');

    // Захватываем медиа при принятии
    try {
      this.preStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: this._callType === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
      });
    } catch (err) {
      if (this._callType === 'video') {
        try { this.preStream = await navigator.mediaDevices.getUserMedia({ audio: true }); this._callType = 'audio'; }
        catch { this.cleanup(false); this.setState('idle', this.mediaErrorMsg(err)); return; }
      } else {
        this.cleanup(false); this.setState('idle', this.mediaErrorMsg(err)); return;
      }
    }

    await nostrClient.sendWebRTCSignal(this._remotePubkey, { type: 'call-accept' });
    await this.startWebRTC(false);
  }

  async rejectCall() {
    if (this._callState !== 'ringing' || !this._remotePubkey) return;
    this.clearCallTimeout(); this.stopRingtone();
    nostrClient.sendWebRTCSignal(this._remotePubkey, { type: 'call-reject' }).catch(() => {});
    this.cleanup(false);
  }

  private mediaErrorMsg(err: unknown): string {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError') return 'Доступ к микрофону/камере запрещён. Разрешите в настройках браузера.';
      if (err.name === 'NotFoundError') return 'Микрофон/камера не найдены. Подключите устройство.';
      if (err.name === 'NotReadableError') return 'Устройство занято другим приложением.';
      return `Ошибка: ${err.message}`;
    }
    return 'Не удалось получить доступ к медиа';
  }

  private async startWebRTC(isInitiator: boolean) {
    try {
      this.pc = new RTCPeerConnection(ICE_CONFIG);

      // Используем предзахваченный стрим
      this.localStream = this.preStream;
      this.preStream = null;

      if (!this.localStream) {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: this._callType === 'video',
        });
      }

      this.localStream.getTracks().forEach(track => {
        this.pc!.addTrack(track, this.localStream!);
      });

      this.remoteStream = new MediaStream();

      this.pc.ontrack = (event) => {
        if (event.streams[0]) {
          event.streams[0].getTracks().forEach(track => {
            this.remoteStream!.addTrack(track);
          });
        } else if (event.track) {
          this.remoteStream!.addTrack(event.track);
        }
        this.notifyStreams();
      };

      this.pc.onicecandidate = (event) => {
        if (event.candidate && this._remotePubkey) {
          nostrClient.sendWebRTCSignal(this._remotePubkey, {
            type: 'webrtc-ice',
            candidate: event.candidate.toJSON(),
          }).catch(() => {});
        }
      };

      this.pc.oniceconnectionstatechange = () => {
        const s = this.pc?.iceConnectionState;
        if (s === 'connected' || s === 'completed') {
          this.setState('connected');
        } else if (s === 'failed') {
          if (this.pc && isInitiator) {
            try { this.pc.restartIce(); } catch { this.endCall('Соединение прервано'); }
          } else {
            this.endCall('Соединение прервано');
          }
        } else if (s === 'disconnected') {
          setTimeout(() => {
            if (this.pc?.iceConnectionState === 'disconnected') this.endCall('Соединение потеряно');
          }, 7000);
        }
      };

      this.notifyStreams();

      if (isInitiator) {
        const offer = await this.pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: this._callType === 'video',
        });
        await this.pc.setLocalDescription(offer);
        await nostrClient.sendWebRTCSignal(this._remotePubkey!, {
          type: 'webrtc-offer',
          sdp: offer.sdp,
        });
      }

      for (const c of this.iceCandidateQueue) {
        try { await this.pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
      this.iceCandidateQueue = [];

    } catch (err) {
      this.endCall(this.mediaErrorMsg(err));
    }
  }

  private async handleOffer(sdp: string) {
    if (!this.pc) return;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await nostrClient.sendWebRTCSignal(this._remotePubkey!, { type: 'webrtc-answer', sdp: answer.sdp });
    } catch (e) { console.error('handleOffer:', e); }
  }

  private async handleAnswer(sdp: string) {
    if (!this.pc) return;
    try { await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp })); }
    catch (e) { console.error('handleAnswer:', e); }
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.pc || !this.pc.remoteDescription) { this.iceCandidateQueue.push(candidate); return; }
    try { await this.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  }

  endCall(error?: string) {
    if (this._remotePubkey && this._callState !== 'idle' && this._callState !== 'ended') {
      nostrClient.sendWebRTCSignal(this._remotePubkey, { type: 'call-end' }).catch(() => {});
    }
    this.cleanup(false);
    if (error) this.setState('idle', error);
  }

  private cleanup(silent: boolean) {
    this.clearCallTimeout();
    this.clearRetry();
    this.stopRingtone();
    if (this.preStream) { this.preStream.getTracks().forEach(t => t.stop()); this.preStream = null; }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    if (this.remoteStream) { this.remoteStream.getTracks().forEach(t => t.stop()); this.remoteStream = null; }
    if (this.pc) { this.pc.close(); this.pc = null; }
    this.iceCandidateQueue = [];
    this._remotePubkey = null;
    this._callStartTime = 0;
    if (!silent) this.setState('idle');
    this.notifyStreams();
  }

  toggleMute(): boolean {
    if (!this.localStream) return false;
    const t = this.localStream.getAudioTracks()[0];
    if (t) { t.enabled = !t.enabled; return !t.enabled; }
    return false;
  }

  toggleVideo(): boolean {
    if (!this.localStream) return false;
    const t = this.localStream.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; return !t.enabled; }
    return false;
  }
}

export const webrtcManager = new WebRTCManager();
