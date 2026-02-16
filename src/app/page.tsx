"use client";

import { useEffect } from "react";
import { useAppState, setLoggedIn, loadContacts } from "@/lib/store";
import { nostrClient } from "@/lib/nostr";
import LoginScreen from "@/components/LoginScreen";
import Sidebar from "@/components/Sidebar";
import ChatView from "@/components/ChatView";
import CallOverlay from "@/components/CallOverlay";
import { Welcome } from "@/components/Welcome";

export default function HomePage() {
  const { isLoggedIn, activeChat } = useAppState();

  useEffect(() => {
    const autoLogin = async () => {
      if (nostrClient.tryAutoLogin()) {
        setLoggedIn(true);
        await nostrClient.connectToRelays();
        loadContacts();
      }
    };
    autoLogin();
  }, []);

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-bg text-text">
      {/* Sidebar */}
      <div
        className={`${
          activeChat ? 'hidden' : 'block w-full'
        } md:block md:w-80 md:flex-shrink-0`}
      >
        <Sidebar />
      </div>

      {/* Main Content (Chat or Welcome) */}
      <div
        className={`flex-1 flex-col ${activeChat ? 'flex' : 'hidden'} md:flex`}
      >
        {activeChat ? <ChatView /> : <Welcome />}
      </div>

      <CallOverlay />
    </main>
  );
}
