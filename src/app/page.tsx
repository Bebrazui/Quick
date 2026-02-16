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
  const { isLoggedIn, activeChat, showSidebar } = useAppState();

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
    <main className="flex h-screen w-screen bg-bg text-text">
      {showSidebar && <Sidebar />}
      <div className={`flex-1 flex flex-col ${showSidebar ? "w-[calc(100vw-320px)]" : "w-full"}`}>
        {activeChat ? <ChatView /> : <Welcome />}
      </div>
      <CallOverlay />
    </main>
  );
}
