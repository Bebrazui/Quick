import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, Check, Copy, Hash, LogOut, MessageCircle, Radio, Search, Settings, Trash2, UserPlus, Wifi, X } from 'lucide-react';
import { nostrClient, type Channel, type Contact } from '../lib/nostr';
import {
  addChannel,
  addContact,
  removeContact,
  setActiveChat,
  setLoggedIn,
  toggleSidebar,
  updateContactProfile,
  useAppState,
} from '../lib/store';
import Avatar from './Avatar';

export default function Sidebar() {
  const { contacts, channels, activeChat, showSidebar } = useAppState();
  const [showAddContact, setShowAddContact] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newContactKey, setNewContactKey] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelAbout, setNewChannelAbout] = useState('');
  const [joinChannelId, setJoinChannelId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newRelay, setNewRelay] = useState('');
  const [copied, setCopied] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileAbout, setProfileAbout] = useState('');
  const [profilePicture, setProfilePicture] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [, setTick] = useState(0);

  useEffect(() => {
    const u1 = nostrClient.onConnection(() => setTick(t => t + 1));
    const u2 = nostrClient.onChannel(channel => addChannel(channel));
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    const unsub = nostrClient.onProfile((pubkey, profile) => {
      updateContactProfile(pubkey, profile.name, profile.picture, profile.about);
      if (pubkey === nostrClient.publicKey) {
        setProfileName(profile.name || '');
        setProfileAbout(profile.about || '');
        setProfilePicture(profile.picture || '');
      }
    });
    return unsub;
  }, []);

  const handleAddContact = () => {
    setAddError('');
    const key = newContactKey.trim();
    if (!nostrClient.isValidHexKey(key)) {
      setAddError('Invalid public key. Expected 64-char hex.');
      return;
    }
    if (key === nostrClient.publicKey) {
      setAddError('You cannot add yourself.');
      return;
    }
    addContact(key, newContactName.trim() || undefined);
    setNewContactKey('');
    setNewContactName('');
    setShowAddContact(false);
  };

  const handleCreateChannel = async () => {
    const name = newChannelName.trim();
    if (!name) return;
    try {
      const channel = await nostrClient.createChannel(name, newChannelAbout.trim());
      addChannel(channel);
      setActiveChat(`channel:${channel.id}`);
      setNewChannelName('');
      setNewChannelAbout('');
      setShowCreateChannel(false);
    } catch {
      // ignore
    }
  };

  const handleJoinChannel = () => {
    const channelId = joinChannelId.trim();
    if (!channelId) return;
    const known = channels.find(c => c.id === channelId);
    if (!known) {
      const localChannel: Channel = {
        id: channelId,
        name: `channel-${channelId.slice(0, 8)}`,
        createdBy: '',
        createdAt: Date.now(),
      };
      addChannel(localChannel);
    }
    setActiveChat(`channel:${channelId}`);
    setJoinChannelId('');
  };

  const handleCopyPubkey = async () => {
    await navigator.clipboard.writeText(nostrClient.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleOpenProfile = () => {
    const p = nostrClient.getProfile(nostrClient.publicKey);
    setProfileName(p?.name || '');
    setProfileAbout(p?.about || '');
    setProfilePicture(p?.picture || '');
    setShowProfile(true);
  };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      await nostrClient.updateProfile({ name: profileName, about: profileAbout, picture: profilePicture });
    } catch {
      // ignore
    }
    setProfileSaving(false);
    setShowProfile(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => setProfilePicture(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleAddRelay = () => {
    let url = newRelay.trim();
    if (!url) return;
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) url = `wss://${url}`;
    nostrClient.addRelay(url);
    setNewRelay('');
    setTick(t => t + 1);
  };

  const handleLogout = () => {
    nostrClient.logout();
    setLoggedIn(false);
  };

  const filteredContacts = contacts
    .filter(c => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return c.name?.toLowerCase().includes(q) || c.pubkey.includes(q);
    })
    .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));

  const filteredChannels = channels.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.id.includes(q);
  });

  const connectedCount = nostrClient.connectedRelayCount;

  if (!showSidebar) {
    return (
      <button
        onClick={toggleSidebar}
        className="fixed top-4 left-4 z-50 lg:hidden bg-bg-secondary border border-border rounded-lg p-2 text-text-secondary hover:text-text"
      >
        <MessageCircle className="w-5 h-5" />
      </button>
    );
  }

  return (
    <>
      <motion.div initial={{ x: -320 }} animate={{ x: 0 }} className="w-full md:w-80 h-full bg-bg-secondary border-r border-border flex flex-col shrink-0">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-text" style={{ fontFamily: 'Space Grotesk' }}>NOSTR MESH</h1>
              <div className="flex items-center gap-1 text-xs">
                <Radio className={`w-3 h-3 ${connectedCount > 0 ? 'text-green' : 'text-red'}`} />
                <span className={connectedCount > 0 ? 'text-green' : 'text-red'}>{connectedCount}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowAddContact(true)} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text transition-colors" title="Add contact"><UserPlus className="w-4 h-4" /></button>
              <button onClick={() => setShowCreateChannel(true)} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text transition-colors" title="Create channel"><Hash className="w-4 h-4" /></button>
              <button onClick={() => setShowSettings(true)} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text transition-colors" title="Settings"><Settings className="w-4 h-4" /></button>
            </div>
          </div>

          <button onClick={handleOpenProfile} className="w-full flex items-center gap-2.5 px-2 py-2 bg-bg-tertiary hover:bg-bg-hover rounded-lg transition-colors">
            <Avatar pubkey={nostrClient.publicKey} name={profileName} picture={profilePicture} size="sm" showBorder />
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-text truncate">{profileName || nostrClient.shortenKey(nostrClient.publicKey)}</p>
              <p className="text-[10px] text-text-muted font-mono truncate">{nostrClient.shortenKey(nostrClient.publicKey)}</p>
            </div>
            <button onClick={(e) => { e.stopPropagation(); handleCopyPubkey(); }} className="p-1 rounded hover:bg-bg-active transition-colors" title="Copy key">
              {copied ? <Check className="w-3 h-3 text-green" /> : <Copy className="w-3 h-3 text-text-muted" />}
            </button>
          </button>

          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search chats/channels..." className="w-full pl-9 pr-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-text-muted">Contacts</div>
          {filteredContacts.length === 0 ? (
            <div className="px-4 py-2 text-xs text-text-muted">No contacts yet.</div>
          ) : (
            <div className="py-1">
              {filteredContacts.map(contact => (
                <ContactItem
                  key={contact.pubkey}
                  contact={contact}
                  isActive={activeChat === contact.pubkey}
                  onClick={() => setActiveChat(contact.pubkey)}
                  onRemove={() => removeContact(contact.pubkey)}
                />
              ))}
            </div>
          )}

          <div className="px-4 pt-4 pb-1 text-[10px] uppercase tracking-wider text-text-muted">Channels</div>
          <div className="px-4 pb-2">
            <div className="flex gap-2">
              <input value={joinChannelId} onChange={e => setJoinChannelId(e.target.value)} placeholder="Channel ID" className="flex-1 bg-bg-tertiary border border-border rounded-lg px-2.5 py-2 text-xs text-text font-mono placeholder:text-text-muted focus:outline-none focus:border-accent/50" />
              <button onClick={handleJoinChannel} className="px-2.5 py-2 bg-accent hover:bg-accent-hover rounded-lg text-xs text-white">Join</button>
            </div>
          </div>
          {filteredChannels.length === 0 ? (
            <div className="px-4 py-2 text-xs text-text-muted">No channels yet.</div>
          ) : (
            <div className="py-1">
              {filteredChannels.map(channel => (
                <button
                  key={channel.id}
                  onClick={() => setActiveChat(`channel:${channel.id}`)}
                  className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors ${activeChat === `channel:${channel.id}` ? 'bg-accent/10 border-r-2 border-accent' : 'hover:bg-bg-hover'}`}
                >
                  <Hash className="w-4 h-4 text-cyan shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-text truncate">{channel.name}</p>
                    <p className="text-[10px] text-text-muted font-mono truncate">{nostrClient.shortenKey(channel.id)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {showAddContact && (
          <Modal onClose={() => setShowAddContact(false)} title="Add Contact">
            <div className="space-y-3">
              <input value={newContactKey} onChange={e => setNewContactKey(e.target.value)} placeholder="Public key (64 hex)" className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2.5 text-sm text-text font-mono placeholder:text-text-muted focus:outline-none focus:border-accent/50" />
              <input value={newContactName} onChange={e => setNewContactName(e.target.value)} placeholder="Display name (optional)" className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50" />
              {addError && <p className="text-red text-xs">{addError}</p>}
              <button onClick={handleAddContact} className="w-full px-4 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors">Add</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateChannel && (
          <Modal onClose={() => setShowCreateChannel(false)} title="Create Channel">
            <div className="space-y-3">
              <input value={newChannelName} onChange={e => setNewChannelName(e.target.value)} placeholder="Channel name" className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50" />
              <textarea value={newChannelAbout} onChange={e => setNewChannelAbout(e.target.value)} rows={3} placeholder="About channel" className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 resize-none" />
              <button onClick={handleCreateChannel} className="w-full px-4 py-3 bg-cyan/20 hover:bg-cyan/30 text-cyan rounded-lg text-sm font-medium transition-colors">Create</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProfile && (
          <Modal onClose={() => setShowProfile(false)} title="My Profile">
            <div className="space-y-4">
              <div className="flex flex-col items-center">
                <div className="relative group">
                  <Avatar pubkey={nostrClient.publicKey} name={profileName} picture={profilePicture} size="xl" showBorder />
                  <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <Camera className="w-6 h-6 text-white" />
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                  </label>
                </div>
              </div>
              <input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Name" className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50" />
              <textarea value={profileAbout} onChange={e => setProfileAbout(e.target.value)} rows={2} placeholder="About" className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 resize-none" />
              <input value={profilePicture} onChange={e => setProfilePicture(e.target.value)} placeholder="Avatar URL" className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50" />
              <button onClick={handleSaveProfile} disabled={profileSaving} className="w-full px-4 py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">{profileSaving ? 'Saving...' : 'Save'}</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <Modal onClose={() => setShowSettings(false)} title="Settings">
            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="text-xs text-text-muted uppercase tracking-wider mb-2 block flex items-center gap-1.5"><Wifi className="w-3 h-3" /> Relays</label>
                <div className="space-y-1 mb-2">
                  {nostrClient.relays.map(relay => (
                    <div key={relay} className="flex items-center justify-between px-3 py-2 bg-bg-tertiary rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${nostrClient.getRelayStatus(relay) === 'connected' ? 'bg-green' : nostrClient.getRelayStatus(relay) === 'connecting' ? 'bg-yellow' : 'bg-red'}`} />
                        <span className="text-xs text-text-secondary font-mono">{relay.replace('wss://', '')}</span>
                      </div>
                      <button onClick={() => { nostrClient.removeRelay(relay); setTick(t => t + 1); }} className="text-text-muted hover:text-red transition-colors"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newRelay} onChange={e => setNewRelay(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddRelay()} placeholder="wss://relay.example.com" className="flex-1 bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-xs text-text font-mono placeholder:text-text-muted focus:outline-none focus:border-accent/50" />
                  <button onClick={handleAddRelay} className="px-3 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs transition-colors">+</button>
                </div>
              </div>

              <div>
                <label className="text-xs text-text-muted uppercase tracking-wider mb-1 block">Public key</label>
                <div className="bg-bg-tertiary rounded-lg p-3 text-xs text-text-secondary font-mono break-all">{nostrClient.publicKey}</div>
              </div>

              <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-dim hover:bg-red/20 border border-red/20 text-red rounded-lg text-sm transition-colors"><LogOut className="w-4 h-4" /> Logout</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}

function ContactItem({ contact, isActive, onClick, onRemove }: { contact: Contact; isActive: boolean; onClick: () => void; onRemove: () => void }) {
  return (
    <div className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors relative ${isActive ? 'bg-accent/10 border-r-2 border-accent' : 'hover:bg-bg-hover'}`} onClick={onClick}>
      <Avatar pubkey={contact.pubkey} name={contact.name} picture={contact.picture} size="md" showBorder />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text truncate">{contact.name || nostrClient.shortenKey(contact.pubkey)}</span>
          {contact.lastMessageTime && <span className="text-[10px] text-text-muted shrink-0 ml-2">{formatTime(contact.lastMessageTime)}</span>}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted truncate">{contact.lastMessage || nostrClient.shortenKey(contact.pubkey)}</span>
          {(contact.unread || 0) > 0 && <span className="ml-2 shrink-0 bg-accent text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{contact.unread}</span>}
        </div>
      </div>
      <button onClick={e => { e.stopPropagation(); onRemove(); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-red-dim text-red opacity-0 group-hover:opacity-100 hover:bg-red/20 transition-all" title="Remove"><Trash2 className="w-3 h-3" /></button>
    </div>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="w-full max-w-md bg-bg-secondary border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-text" style={{ fontFamily: 'Space Grotesk' }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-bg-hover text-text-secondary"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000 && d.getDate() === now.getDate()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
