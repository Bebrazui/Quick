/**
 * Manages a persistent blocklist for call IDs using localStorage.
 * This prevents phantom calls from ever reappearing after being terminated.
 */
export class CallBlocklistManager {
  private readonly storageKey = 'nostr_call_blocklist';

  private getBlocklist(): Set<string> {
    try {
      const stored = localStorage.getItem(this.storageKey);
      const blocklist = stored ? new Set(JSON.parse(stored)) : new Set();
      console.log('[Blocklist] Fetched', blocklist);
      return blocklist;
    } catch (e) {
      console.error("[Blocklist] Could not read from localStorage.", e);
      return new Set();
    }
  }

  private saveBlocklist(blocklist: Set<string>): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(Array.from(blocklist)));
      console.log('[Blocklist] Saved', blocklist);
    } catch (e) {
      console.error("[Blocklist] Could not write to localStorage.", e);
    }
  }

  /**
   * Adds a call ID to the blocklist permanently.
   * @param callId The call ID to block.
   */
  add(callId: string): void {
    if (!callId) return;
    const blocklist = this.getBlocklist();
    if (!blocklist.has(callId)) {
      blocklist.add(callId);
      this.saveBlocklist(blocklist);
      console.log(`[Blocklist] Call ID added: ${callId}`);
    } else {
      console.log(`[Blocklist] Call ID ${callId} is already in the blocklist.`);
    }
  }

  /**
   * Checks if a call ID is in the blocklist.
   * @param callId The call ID to check.
   * @returns True if the call ID is blocked, false otherwise.
   */
  has(callId: string): boolean {
    const isBlocked = this.getBlocklist().has(callId);
    console.log(`[Blocklist] Checking for ${callId}. Is blocked: ${isBlocked}`);
    return isBlocked;
  }

  /**
   * (For future settings UI) Removes a call ID from the blocklist.
   * @param callId The call ID to unblock.
   */
  remove(callId: string): void {
    const blocklist = this.getBlocklist();
    if (blocklist.delete(callId)) {
      this.saveBlocklist(blocklist);
      console.log(`[Blocklist] Call ID removed: ${callId}`);
    }
  }
}
