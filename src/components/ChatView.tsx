import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Copy,
  Download,
  Hash,
  Loader2,
  Menu,
  Paperclip,
  Phone,
  Reply,
  Send,
  Search,
  Video,
  X,
} from 'lucide-react';
import NextImage from 'next/image';
import { nostrClient, type Attachment, type DirectMessage, type ReplyRef } from '../lib/nostr';
import {
  addChannelMessage,
  addMessage,
  getChannelMessages,
  getMessages,
  toggleSidebar,
  updateContactProfile,
  useAppState,
} from '../lib/store';
import { downloadChunkedTransfer } from '../lib/chunkStore';
import { downloadAttachment, formatFileSize, getFileIcon, processFile } from '../lib/fileUtils';
import { webrtcManager } from '../lib/webrtc';
import Avatar from './Avatar';

function Highlight({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight.trim()) {
    return <span>{text}</span>;
  }
  const regex = new RegExp(`(${highlight})`, 'gi');
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-300 text-black rounded-sm">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

export default function ChatView() {
  const { activeChat, contacts, channels } = useAppState();
  const isChannel = !!activeChat && activeChat.startsWith('channel:');
  const channelId = isChannel ? activeChat!.slice('channel:'.length) : '';

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [pendingAttachment, setPendingAttachment] = useState<Attachment | null>(null);
  const [sendProgress, setSendProgress] = useState<{ sent: number; total: number } | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const contact = useMemo(() => contacts.find(c => c.pubkey === activeChat), [contacts, activeChat]);
  const channel = useMemo(() => channels.find(c => c.id === channelId), [channels, channelId]);

  useEffect(() => {
    if (isSearchVisible) {
      searchInputRef.current?.focus();
    }
  }, [isSearchVisible]);

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    return messages.filter(msg => msg.content?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [messages, searchQuery]);


  useEffect(() => {
    if (!activeChat) return;
    if (isChannel) {
      setMessages(getChannelMessages(channelId));
    } else {
      setMessages(getMessages(activeChat));
      nostrClient.requestProfile(activeChat);
    }
    setPendingAttachment(null);
    setSendProgress(null);
    setReplyTo(null);
    setError('');
  }, [activeChat, isChannel, channelId]);

  useEffect(() => {
    const unsubMsg = nostrClient.onMessage(msg => {
      addMessage(msg);
      if (!activeChat || isChannel) return;
      setMessages(getMessages(activeChat));
    });
    const unsubChannel = nostrClient.onChannelMessage(msg => {
      addChannelMessage(msg);
      if (!channelId || !isChannel || msg.channelId !== channelId) return;
      setMessages(getChannelMessages(channelId));
    });
    return () => {
      unsubMsg();
      unsubChannel();
    };
  }, [activeChat, isChannel, channelId]);

  useEffect(() => {
    const unsub = nostrClient.onProfile((pubkey, profile) => {
      updateContactProfile(pubkey, profile.name, profile.picture, profile.about);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!activeChat) return;
    setMessages(isChannel ? getChannelMessages(channelId) : getMessages(activeChat));
  }, [activeChat, contacts, channels, isChannel, channelId]);

  useEffect(() => {
    if (searchQuery) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, searchQuery]);

  const handleSend = async () => {
    if ((!input.trim() && !pendingAttachment) || !activeChat || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    setError('');
    setSendProgress(null);

    try {
      if (isChannel) {
        if (pendingAttachment) throw new Error('Attachments are not supported in public channels.');
        const msg = await nostrClient.sendChannelMessage(channelId, text, replyTo || undefined);
        addChannelMessage(msg);
        setMessages(getChannelMessages(channelId));
      } else if (pendingAttachment) {
        const msg = await nostrClient.sendAttachment(
          activeChat,
          pendingAttachment,
          text,
          (sent, total) => setSendProgress({ sent, total }),
          replyTo || undefined,
        );
        addMessage(msg);
        setMessages(getMessages(activeChat));
        setPendingAttachment(null);
      } else {
        const msg = await nostrClient.sendDirectMessage(activeChat, text, replyTo || undefined);
        addMessage(msg);
        setMessages(getMessages(activeChat));
      }
      setReplyTo(null);
      setSendProgress(null);
    } catch (err) {
      setError((err as Error).message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleCall = useCallback((type: 'audio' | 'video') => {
    if (!activeChat || isChannel) return;
    webrtcManager.initiateCall(activeChat, type);
  }, [activeChat, isChannel]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setError('');
    try {
      const attachment = await processFile(file);
      if (attachment) setPendingAttachment(attachment);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 1400);
  };

  const handleDownload = async (msg: DirectMessage) => {
    if (!msg.attachment) return;
    if (msg.attachment.chunked && msg.attachment.transferId) {
      await downloadChunkedTransfer(msg.attachment.transferId, msg.attachment.name, msg.attachment.mimeType);
      return;
    }
    downloadAttachment(msg.attachment);
  };

  if (!activeChat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg">
        <div className="text-center px-4">
          <h2 className="text-2xl font-bold text-text mb-2" style={{ fontFamily: 'Space Grotesk' }}>Anonymous Decentralized Messenger</h2>
          <p className="text-text-secondary text-sm">Choose contact or channel to start.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-bg h-full">
      <div className="px-4 py-3 border-b border-border bg-bg-secondary/50 backdrop-blur-sm flex items-center gap-3">
        <button onClick={toggleSidebar} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary lg:hidden">
          <Menu className="w-5 h-5" />
        </button>

        {isChannel ? (
          <div className="w-8 h-8 rounded-full bg-cyan/15 border border-cyan/25 flex items-center justify-center">
            <Hash className="w-4 h-4 text-cyan" />
          </div>
        ) : (
          <Avatar pubkey={activeChat} name={contact?.name} picture={contact?.picture} size="sm" showBorder />
        )}

        <div className="flex-1 min-w-0">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={isSearchVisible ? 'search' : 'title'}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="w-full"
            >
              {isSearchVisible ? (
                <div className="relative w-full">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search in chat..."
                    className="w-full bg-bg-tertiary border border-border rounded-lg pl-8 pr-8 py-1 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50"
                  />
                  <button onClick={() => { setIsSearchVisible(false); setSearchQuery(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div>
                  <div className="text-sm font-medium text-text truncate">
                    {isChannel ? `# ${channel?.name || nostrClient.shortenKey(channelId)}` : (contact?.name || nostrClient.shortenKey(activeChat))}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {isChannel ? 'Public channel over relays' : 'Encrypted DM over relays'}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => setIsSearchVisible(!isSearchVisible)} className={`p-2 rounded-lg hover:bg-bg-hover transition-colors ${isSearchVisible ? 'bg-bg-tertiary text-accent' : 'text-text-muted hover:text-text-secondary'}`} title="Search">
            <Search className="w-4 h-4" />
          </button>
          {!isChannel && (
            <>
              <button onClick={() => handleCall('audio')} className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-green transition-colors" title="Audio call"><Phone className="w-4 h-4" /></button>
              <button onClick={() => handleCall('video')} className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-accent transition-colors" title="Video call"><Video className="w-4 h-4" /></button>
              <button onClick={() => handleCopy(activeChat, 'header')} className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors" title="Copy key">
                {copied === 'header' ? <Check className="w-4 h-4 text-green" /> : <Copy className="w-4 h-4" />}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {filteredMessages.map(msg => {
          const isMe = msg.from === nostrClient.publicKey;
          return (
            <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`group relative max-w-[78%] rounded-2xl text-sm overflow-hidden ${isMe ? 'bg-accent text-white rounded-br-md' : 'bg-bg-secondary border border-border text-text rounded-bl-md'}`}>
                {msg.replyTo && (
                  <div className={`mx-2 mt-2 px-2 py-1 rounded-md text-[11px] ${isMe ? 'bg-white/15 text-white/80' : 'bg-bg-tertiary text-text-secondary'}`}>
                    <p className="font-medium truncate">{msg.replyTo.from === nostrClient.publicKey ? 'You' : nostrClient.shortenKey(msg.replyTo.from)}</p>
                    <p className="truncate">{msg.replyTo.text}</p>
                  </div>
                )}

                {msg.msgType === 'image' && msg.attachment && !msg.attachment.chunked && (
                  <div className="cursor-pointer" onClick={() => setPreviewImage(`data:${msg.attachment!.mimeType};base64,${msg.attachment!.data}`)}>
                    <NextImage src={`data:${msg.attachment.mimeType};base64,${msg.attachment.data}`} alt={msg.attachment.name} width={300} height={200} className="max-w-full max-h-64 rounded-t-2xl object-cover" />
                  </div>
                )}

                {msg.attachment && msg.msgType === 'file' && (
                  <div className="flex items-center gap-3 px-3.5 pt-3 cursor-pointer" onClick={() => handleDownload(msg)}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${isMe ? 'bg-white/15' : 'bg-bg-tertiary'}`}>
                      {getFileIcon(msg.attachment.mimeType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium truncate ${isMe ? 'text-white' : 'text-text'}`}>{msg.attachment.name}</p>
                      <p className={`text-[10px] ${isMe ? 'text-white/60' : 'text-text-muted'}`}>{formatFileSize(msg.attachment.size)}</p>
                    </div>
                    <Download className={`w-4 h-4 shrink-0 ${isMe ? 'text-white/60' : 'text-text-muted'}`} />
                  </div>
                )}

                {msg.attachment && msg.msgType === 'image' && msg.attachment.chunked && (
                  <div className="flex items-center gap-3 px-3.5 pt-3 cursor-pointer" onClick={() => handleDownload(msg)}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${isMe ? 'bg-white/15' : 'bg-bg-tertiary'}`}>🖼️</div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium truncate ${isMe ? 'text-white' : 'text-text'}`}>{msg.attachment.name}</p>
                      <p className={`text-[10px] ${isMe ? 'text-white/60' : 'text-text-muted'}`}>Chunked image, click to download</p>
                    </div>
                    <Download className={`w-4 h-4 shrink-0 ${isMe ? 'text-white/60' : 'text-text-muted'}`} />
                  </div>
                )}

                {msg.content && (
                  <div className="px-3.5 py-2.5">
                    <p className="whitespace-pre-wrap break-words">
                      <Highlight text={msg.content} highlight={searchQuery} />
                    </p>
                  </div>
                )}

                <div className={`flex items-center gap-1 px-3.5 pb-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <span className={`text-[10px] ${isMe ? 'text-white/50' : 'text-text-muted'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div className={`absolute top-1 ${isMe ? 'left-0 -translate-x-9' : 'right-0 translate-x-9'} flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
                  {msg.content && (
                    <button onClick={() => handleCopy(msg.content, msg.id)} className="p-1 rounded bg-bg-secondary border border-border">
                      {copied === msg.id ? <Check className="w-3 h-3 text-green" /> : <Copy className="w-3 h-3 text-text-muted" />}
                    </button>
                  )}
                  <button onClick={() => setReplyTo({ id: msg.id, from: msg.from, text: msg.content || msg.attachment?.name || '' })} className="p-1 rounded bg-bg-secondary border border-border">
                    <Reply className="w-3 h-3 text-text-muted" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <AnimatePresence>
        {replyTo && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-4 py-2 border-t border-border bg-bg-secondary/40 overflow-hidden">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-text-muted">Reply to {replyTo.from === nostrClient.publicKey ? 'you' : nostrClient.shortenKey(replyTo.from)}</p>
                <p className="text-xs text-text-secondary truncate">{replyTo.text || '(attachment)'}</p>
              </div>
              <button onClick={() => setReplyTo(null)} className="p-1.5 rounded hover:bg-bg-hover"><X className="w-3.5 h-3.5 text-text-muted" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingAttachment && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-4 border-t border-border bg-bg-secondary/30 overflow-hidden">
            <div className="py-3 flex items-center gap-3">
              {pendingAttachment.type === 'image' && pendingAttachment.data ? (
                <div className="w-16 h-16 rounded-xl overflow-hidden border border-border shrink-0">
                  <NextImage src={`data:${pendingAttachment.mimeType};base64,${pendingAttachment.data}`} alt="Attachment preview" width={64} height={64} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-xl bg-bg-tertiary border border-border flex items-center justify-center text-2xl shrink-0">{getFileIcon(pendingAttachment.mimeType)}</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text truncate">{pendingAttachment.name}</p>
                <p className="text-xs text-text-muted">{formatFileSize(pendingAttachment.size)}</p>
              </div>
              <button onClick={() => setPendingAttachment(null)} className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-red transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sendProgress && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-4 border-t border-border bg-bg-secondary/30 overflow-hidden">
            <div className="py-2">
              <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Uploading...
                </span>
                <span>{sendProgress.sent}/{sendProgress.total} chunks</span>
              </div>
              <div className="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                <motion.div className="h-full bg-accent rounded-full" initial={{ width: 0 }} animate={{ width: `${(sendProgress.sent / sendProgress.total) * 100}%` }} transition={{ duration: 0.2 }} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-4 py-2 bg-red-dim border-t border-red/20">
            <p className="text-xs text-red">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-4 py-3 border-t border-border bg-bg-secondary/30">
        <div className="flex items-end gap-2">
          {!isChannel && (
            <div className="flex items-center gap-0.5 pb-1">
              <button onClick={() => imageInputRef.current?.click()} className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-accent transition-colors" title="Send image" disabled={sending}>
                <NextImage className="w-5 h-5" />
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-accent transition-colors" title="Send file" disabled={sending}>
                <Paperclip className="w-5 h-5" />
              </button>
            </div>
          )}

          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />

          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={pendingAttachment ? 'Add caption...' : (isChannel ? 'Post message to channel...' : 'Write message...')}
            rows={1}
            disabled={sending}
            className="flex-1 bg-bg-tertiary border border-border rounded-xl px-4 py-3 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 resize-none max-h-32 disabled:opacity-50"
            style={{ minHeight: '44px' }}
          />

          <motion.button whileHover={{ scale: sending ? 1 : 1.05 }} whileTap={{ scale: sending ? 1 : 0.95 }} onClick={handleSend} disabled={(!input.trim() && !pendingAttachment) || sending} className="p-3 bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl transition-colors shrink-0">
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {previewImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4" onClick={() => setPreviewImage(null)}>
            <button className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors z-10" onClick={() => setPreviewImage(null)}>
              <X className="w-6 h-6" />
            </button>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="relative max-w-full max-h-full" onClick={e => e.stopPropagation()}>
              <NextImage src={previewImage} alt="Image preview" layout="fill" objectFit="contain" className="rounded-lg" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
