import { NostrSignaling } from './nostr-signaling';

export type CallState = 
  | 'idle' 
  | 'calling' 
  | 'ringing' 
  | 'connecting' 
  | 'connected' 
  | 'ended';

export type CallType = 'audio' | 'video';

interface CallEventHandlers {
  onStateChange: (state: CallState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onLocalStream: (stream: MediaStream) => void;
  onCallDuration: (seconds: number) => void;
  onError: (error: string) => void;
  onIncomingCall: (callerPubkey: string, callId: string, callType: CallType) => void;
}

export class CallManager {
  private signaling: NostrSignaling;
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private callState: CallState = 'idle';
  private currentCallId: string | null = null;
  private currentPeerPubkey: string | null = null;
  private callType: CallType = 'audio';
  private durationTimer: number | null = null;
  private callStartTime: number = 0;
  private iceCandidateQueue: RTCIceCandidateInit[] = [];
  private handlers: CallEventHandlers;

  // STUN/TURN серверы
  private readonly rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ],
    iceCandidatePoolSize: 10,
  };

  constructor(signaling: NostrSignaling, handlers: CallEventHandlers) {
    this.signaling = signaling;
    this.handlers = handlers;
    this.setupSignalingHandlers();
  }

  private setupSignalingHandlers() {
    this.signaling.onOffer = async (sdp, callerPubkey, callId) => {
      if (this.callState !== 'idle') {
        // Уже в звонке — отклоняем
        await this.signaling.sendReject(callerPubkey, callId);
        return;
      }

      this.currentCallId = callId;
      this.currentPeerPubkey = callerPubkey;
      
      // Определяем тип звонка из SDP
      const hasVideo = sdp.sdp?.includes('m=video') || false;
      this.callType = hasVideo ? 'video' : 'audio';
      
      this.setState('ringing');
      
      // Сохраняем offer для принятия
      this._pendingOffer = sdp;
      
      this.handlers.onIncomingCall(callerPubkey, callId, this.callType);
    };

    this.signaling.onAnswer = async (sdp, senderPubkey, callId) => {
      if (callId !== this.currentCallId) return;
      
      if (this.peerConnection) {
        await this.peerConnection.setRemoteDescription(
          new RTCSessionDescription(sdp)
        );
        
        // Обрабатываем отложенные ICE кандидаты
        await this.processIceCandidateQueue();
        
        this.setState('connecting');
      }
    };

    this.signaling.onIceCandidate = async (candidate, senderPubkey) => {
      if (senderPubkey !== this.currentPeerPubkey) return;
      
      if (this.peerConnection?.remoteDescription) {
        await this.peerConnection.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } else {
        // Откладываем, если remote description ещё не установлен
        this.iceCandidateQueue.push(candidate);
      }
    };

    this.signaling.onHangup = (senderPubkey, callId) => {
      if (senderPubkey === this.currentPeerPubkey) {
        this.endCall(false);
      }
    };

    this.signaling.onReject = (senderPubkey, callId) => {
      if (callId === this.currentCallId) {
        this.endCall(false);
      }
    };
  }

  private _pendingOffer: RTCSessionDescriptionInit | null = null;

  async startCall(recipientPubkey: string, type: CallType = 'audio') {
    if (this.callState !== 'idle') {
      throw new Error('Already in a call');
    }

    try {
      this.callType = type;
      this.currentCallId = this.generateCallId();
      this.currentPeerPubkey = recipientPubkey;

      this.localStream = await this.getMediaStream(type);
      this.handlers.onLocalStream(this.localStream);

      this.createPeerConnection();

      this.localStream.getTracks().forEach(track => {
        this.peerConnection!.addTrack(track, this.localStream!);
      });

      const offer = await this.peerConnection!.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video',
      });

      await this.peerConnection!.setLocalDescription(offer);

      await this.signaling.sendOffer(
        recipientPubkey, 
        offer, 
        this.currentCallId
      );

      this.setState('calling');

      setTimeout(() => {
        if (this.callState === 'calling') {
          this.endCall(true);
        }
      }, 30000);

    } catch (err: any) {
      this.handlers.onError(err.message);
      this.endCall(false);
    }
  }

  async acceptCall() {
    if (this.callState !== 'ringing' || !this._pendingOffer) {
      throw new Error('No incoming call to accept');
    }

    try {
      this.localStream = await this.getMediaStream(this.callType);
      this.handlers.onLocalStream(this.localStream);

      this.createPeerConnection();

      this.localStream.getTracks().forEach(track => {
        this.peerConnection!.addTrack(track, this.localStream!);
      });

      await this.peerConnection!.setRemoteDescription(
        new RTCSessionDescription(this._pendingOffer)
      );

      await this.processIceCandidateQueue();

      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);

      await this.signaling.sendAnswer(
        this.currentPeerPubkey!, 
        answer, 
        this.currentCallId!
      );

      this._pendingOffer = null;
      this.setState('connecting');

    } catch (err: any) {
      this.handlers.onError(err.message);
      this.endCall(false);
    }
  }

  async rejectCall() {
    if (this.callState !== 'ringing') return;
    
    await this.signaling.sendReject(
      this.currentPeerPubkey!, 
      this.currentCallId!
    );
    this.endCall(false);
  }

  async endCall(sendSignal: boolean = true) {
    if (sendSignal && this.currentPeerPubkey && this.currentCallId) {
      await this.signaling.sendHangup(
        this.currentPeerPubkey, 
        this.currentCallId
      );
    }

    this.localStream?.getTracks().forEach(t => t.stop());
    this.remoteStream?.getTracks().forEach(t => t.stop());

    this.peerConnection?.close();

    if (this.durationTimer) {
      clearInterval(this.durationTimer);
    }

    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.currentCallId = null;
    this.currentPeerPubkey = null;
    this._pendingOffer = null;
    this.iceCandidateQueue = [];

    this.setState('ended');
    
    setTimeout(() => this.setState('idle'), 1000);
  }

  toggleMute(): boolean {
    if (!this.localStream) return false;
    
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // true = muted
    }
    return false;
  }

  toggleVideo(): boolean {
    if (!this.localStream) return false;
    
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return !videoTrack.enabled; // true = camera off
    }
    return false;
  }

  private createPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate && this.currentPeerPubkey && this.currentCallId) {
        await this.signaling.sendIceCandidate(
          this.currentPeerPubkey,
          event.candidate.toJSON(),
          this.currentCallId
        );
      }
    };

    this.peerConnection.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      this.handlers.onRemoteStream(this.remoteStream);
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log('Connection state:', state);

      switch (state) {
        case 'connected':
          this.setState('connected');
          this.startDurationTimer();
          break;
        case 'disconnected':
        case 'failed':
          this.endCall(true);
          break;
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE state:', this.peerConnection?.iceConnectionState);
    };
  }

  private async getMediaStream(type: CallType): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: type === 'video' ? {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 60 },
        facingMode: 'user',
      } : false,
    };

    return navigator.mediaDevices.getUserMedia(constraints);
  }

  private async processIceCandidateQueue() {
    for (const candidate of this.iceCandidateQueue) {
      await this.peerConnection?.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    }
    this.iceCandidateQueue = [];
  }

  private setState(state: CallState) {
    this.callState = state;
    this.handlers.onStateChange(state);
  }

  private startDurationTimer() {
    this.callStartTime = Date.now();
    this.durationTimer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - this.callStartTime) / 1000);
      this.handlers.onCallDuration(seconds);
    }, 1000);
  }

  private generateCallId(): string {
    return `call-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  get state(): CallState {
    return this.callState;
  }

  get isVideoCall(): boolean {
    return this.callType === 'video';
  }
}
