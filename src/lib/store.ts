import { useState, useCallback, useSyncExternalStore } from 'react';
import { nostrClient, type Contact, type DirectMessage, type Channel } from './nostr';

interface AppState {
  contacts: Contact[];
  channels: Channel[];
  messages: Map<string, DirectMessage[]>;
  channelMessages: Map<string, DirectMessage[]>;
  activeChat: string | null;
  isLoggedIn: boolean;
  showSidebar: boolean;
}

let state: AppState = {
  contacts: [],
  channels: [],
  messages: new Map(),
  channelMessages: new Map(),
  activeChat: null,
  isLoggedIn: false,
  showSidebar: true,
};

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(l => l());
}

function getSnapshot() {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function setActiveChat(pubkey: string | null) {
  state = { ...state, activeChat: pubkey };
  if (pubkey && !pubkey.startsWith('channel:')) {
    const contacts = state.contacts.map(c =>
      c.pubkey === pubkey ? { ...c, unread: 0 } : c
    );
    state = { ...state, contacts };
  }
  notify();
}

export function setLoggedIn(value: boolean) {
  state = { ...state, isLoggedIn: value };
  notify();
}

export function toggleSidebar() {
  state = { ...state, showSidebar: !state.showSidebar };
  notify();
}

export function addContact(pubkey: string, name?: string) {
  if (state.contacts.find(c => c.pubkey === pubkey)) return;
  const contact: Contact = {
    pubkey,
    name: name || nostrClient.shortenKey(pubkey),
    unread: 0,
  };
  state = { ...state, contacts: [...state.contacts, contact] };
  saveContacts();
  nostrClient.requestProfile(pubkey);
  notify();
}

export function removeContact(pubkey: string) {
  state = {
    ...state,
    contacts: state.contacts.filter(c => c.pubkey !== pubkey),
    activeChat: state.activeChat === pubkey ? null : state.activeChat,
  };
  saveContacts();
  notify();
}

export function updateContactProfile(pubkey: string, name?: string, picture?: string, about?: string) {
  state = {
    ...state,
    contacts: state.contacts.map(c =>
      c.pubkey === pubkey ? { ...c, name: name || c.name, picture, about } : c
    ),
  };
  notify();
}

function getLastMessagePreview(msg: DirectMessage): string {
  if (msg.msgType === 'image') return '🖼️ Photo';
  if (msg.msgType === 'file') return `📎 ${msg.attachment?.name || 'File'}`;
  return msg.content;
}

export function addMessage(msg: DirectMessage) {
  const otherPubkey = msg.from === nostrClient.publicKey ? msg.to : msg.from;
  const existing = state.messages.get(otherPubkey) || [];

  if (existing.find(m => m.id === msg.id)) return;

  const updated = [...existing, msg].sort((a, b) => a.timestamp - b.timestamp);
  const newMessages = new Map(state.messages);
  newMessages.set(otherPubkey, updated);

  const preview = getLastMessagePreview(msg);

  const contacts = state.contacts.map(c => {
    if (c.pubkey === otherPubkey) {
      return {
        ...c,
        lastMessage: preview,
        lastMessageTime: msg.timestamp,
        unread: state.activeChat === otherPubkey ? 0 : (c.unread || 0) + (msg.from !== nostrClient.publicKey ? 1 : 0),
      };
    }
    return c;
  });

  const hasContact = contacts.find(c => c.pubkey === otherPubkey);
  if (!hasContact && msg.from !== nostrClient.publicKey) {
    contacts.push({
      pubkey: otherPubkey,
      name: nostrClient.shortenKey(otherPubkey),
      lastMessage: preview,
      lastMessageTime: msg.timestamp,
      unread: state.activeChat === otherPubkey ? 0 : 1,
    });
    nostrClient.requestProfile(otherPubkey);
    saveContacts();
  }

  state = { ...state, messages: newMessages, contacts };
  notify();
}

export function addChannel(channel: Channel) {
  if (state.channels.find(c => c.id === channel.id)) return;
  state = { ...state, channels: [channel, ...state.channels] };
  saveChannels();
  nostrClient.setChannels(state.channels.map(c => c.id));
  notify();
}

export function addChannelMessage(msg: DirectMessage) {
  const channelId = msg.channelId;
  if (!channelId) return;
  const existing = state.channelMessages.get(channelId) || [];
  if (existing.find(m => m.id === msg.id)) return;
  const updated = [...existing, msg].sort((a, b) => a.timestamp - b.timestamp);
  const map = new Map(state.channelMessages);
  map.set(channelId, updated);
  state = { ...state, channelMessages: map };
  notify();
}

export function getChannelMessages(channelId: string): DirectMessage[] {
  return state.channelMessages.get(channelId) || [];
}

export function getMessages(pubkey: string): DirectMessage[] {
  return state.messages.get(pubkey) || [];
}

function saveContacts() {
  const data = state.contacts.map(c => ({ pubkey: c.pubkey, name: c.name }));
  localStorage.setItem('nostr_contacts', JSON.stringify(data));
}

function saveChannels() {
  localStorage.setItem('nostr_channels', JSON.stringify(state.channels));
}

export function loadContacts() {
  try {
    const raw = localStorage.getItem('nostr_contacts');
    if (raw) {
      const data = JSON.parse(raw) as { pubkey: string; name?: string }[];
      const contacts: Contact[] = data.map(d => ({
        pubkey: d.pubkey,
        name: d.name || nostrClient.shortenKey(d.pubkey),
        unread: 0,
      }));
      state = { ...state, contacts };
      notify();
      contacts.forEach(c => nostrClient.requestProfile(c.pubkey));
    }
  } catch {
    // ignore
  }
}

export function loadChannels() {
  try {
    const raw = localStorage.getItem('nostr_channels');
    if (!raw) return;
    const channels = JSON.parse(raw) as Channel[];
    state = { ...state, channels };
    nostrClient.setChannels(channels.map(c => c.id));
    notify();
  } catch {
    // ignore
  }
}

export function useRelayStatuses() {
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  return { refresh };
}
