import { useState } from 'react';
import { motion } from 'framer-motion';
import { Key, Plus, LogIn, Copy, Check, Shield, Zap, Globe } from 'lucide-react';
import { nostrClient } from '../lib/nostr';
import { setLoggedIn, loadContacts, loadChannels } from '../lib/store';

export default function LoginScreen() {
  const [mode, setMode] = useState<'choice' | 'generate' | 'import'>('choice');
  const [generatedKeys, setGeneratedKeys] = useState<{ privateKey: string; publicKey: string } | null>(null);
  const [importKey, setImportKey] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [savedKey, setSavedKey] = useState(false);

  const handleGenerate = () => {
    const keys = nostrClient.generateKeys();
    setGeneratedKeys(keys);
    setMode('generate');
  };

  const handleCopyKey = async () => {
    if (!generatedKeys) return;
    await navigator.clipboard.writeText(generatedKeys.privateKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfirmGenerated = () => {
    if (!generatedKeys) return;
    nostrClient.login(generatedKeys.privateKey);
    nostrClient.connectToRelays();
    loadContacts();
    loadChannels();
    setLoggedIn(true);
  };

  const handleImport = () => {
    setError('');
    const key = importKey.trim().replace(/^nsec1/, '');
    if (!nostrClient.isValidHexKey(key)) {
      setError('Invalid private key. Must be 64 hex characters.');
      return;
    }
    try {
      nostrClient.login(key);
      nostrClient.connectToRelays();
      loadContacts();
      loadChannels();
      setLoggedIn(true);
    } catch {
      setError('Failed to login with this key.');
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-bg p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan/5 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        {mode === 'choice' && (
          <div className="text-center">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200 }}
              className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-accent/10 border border-accent/20 mb-6"
            >
              <Zap className="w-10 h-10 text-accent" />
            </motion.div>

            <h1 className="text-3xl font-bold text-text mb-2" style={{ fontFamily: 'Space Grotesk' }}>
              NOSTR P2P
            </h1>
            <p className="text-text-secondary text-sm mb-2">
              Decentralized. Encrypted. Censorship-resistant.
            </p>
            <div className="flex items-center justify-center gap-4 text-xs text-text-muted mb-8">
              <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> E2E Encrypted</span>
              <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> No Central Server</span>
            </div>

            <div className="space-y-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGenerate}
                className="w-full flex items-center gap-3 px-5 py-4 bg-accent hover:bg-accent-hover text-white rounded-xl transition-colors text-sm font-medium"
              >
                <Plus className="w-5 h-5" />
                <div className="text-left">
                  <div>Generate New Identity</div>
                  <div className="text-xs opacity-70">Create a new keypair</div>
                </div>
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setMode('import')}
                className="w-full flex items-center gap-3 px-5 py-4 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-xl transition-colors text-sm font-medium text-text"
              >
                <LogIn className="w-5 h-5 text-text-secondary" />
                <div className="text-left">
                  <div>Import Private Key</div>
                  <div className="text-xs text-text-muted">Use existing Nostr identity</div>
                </div>
              </motion.button>
            </div>
          </div>
        )}

        {mode === 'generate' && generatedKeys && (
          <div>
            <button onClick={() => setMode('choice')} className="text-text-secondary hover:text-text text-sm mb-4 flex items-center gap-1">
              ← Back
            </button>

            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-green/10 border border-green/20 mb-4">
                <Key className="w-7 h-7 text-green" />
              </div>
              <h2 className="text-xl font-bold text-text" style={{ fontFamily: 'Space Grotesk' }}>Your New Identity</h2>
              <p className="text-text-secondary text-xs mt-1">Save your private key securely!</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-text-muted uppercase tracking-wider mb-1 block">Public Key</label>
                <div className="bg-bg-tertiary border border-border rounded-lg p-3 text-xs text-text-secondary font-mono break-all">
                  {generatedKeys.publicKey}
                </div>
              </div>

              <div>
                <label className="text-xs text-text-muted uppercase tracking-wider mb-1 block">Private Key (SECRET)</label>
                <div className="bg-red-dim border border-red/20 rounded-lg p-3 text-xs text-red font-mono break-all">
                  {generatedKeys.privateKey}
                </div>
              </div>

              <button
                onClick={handleCopyKey}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-lg text-sm text-text transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-green" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy Private Key'}
              </button>

              <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={savedKey}
                  onChange={e => setSavedKey(e.target.checked)}
                  className="rounded accent-accent"
                />
                I have saved my private key securely
              </label>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleConfirmGenerated}
                disabled={!savedKey}
                className="w-full px-5 py-4 bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl transition-all text-sm font-medium"
              >
                Enter Messenger
              </motion.button>
            </div>
          </div>
        )}

        {mode === 'import' && (
          <div>
            <button onClick={() => setMode('choice')} className="text-text-secondary hover:text-text text-sm mb-4 flex items-center gap-1">
              ← Back
            </button>

            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-accent/10 border border-accent/20 mb-4">
                <LogIn className="w-7 h-7 text-accent" />
              </div>
              <h2 className="text-xl font-bold text-text" style={{ fontFamily: 'Space Grotesk' }}>Import Key</h2>
              <p className="text-text-secondary text-xs mt-1">Enter your Nostr private key (hex)</p>
            </div>

            <div className="space-y-4">
              <div>
                <textarea
                  value={importKey}
                  onChange={e => setImportKey(e.target.value)}
                  placeholder="Enter 64-character hex private key..."
                  rows={3}
                  className="w-full bg-bg-tertiary border border-border rounded-lg p-3 text-sm text-text font-mono resize-none focus:outline-none focus:border-accent placeholder:text-text-muted"
                />
              </div>

              {error && (
                <p className="text-red text-xs">{error}</p>
              )}

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleImport}
                className="w-full px-5 py-4 bg-accent hover:bg-accent-hover text-white rounded-xl transition-colors text-sm font-medium"
              >
                Login
              </motion.button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
