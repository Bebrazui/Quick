"use client";
import { Zap, Users, MessageSquare, AtSign, Sun, Moon } from 'lucide-react';
import { useTheme } from "next-themes";

function FeatureCard({ icon, title, children, color }) {
  return (
    <div className="bg-bg-secondary p-6 rounded-2xl border border-border transform hover:-translate-y-1 transition-transform duration-300 ease-in-out">
      <div className="flex items-start gap-4">
        <div className={`p-2 rounded-lg`} style={{ backgroundColor: `${color}1A`}}>
          {icon}
        </div>
        <div>
          <h3 className="font-bold text-text text-lg">{title}</h3>
          <p className="text-sm text-text-secondary mt-1">{children}</p>
        </div>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button
      className="p-2 rounded-full text-text-secondary hover:text-text hover:bg-bg-tertiary transition-colors"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}

export function Welcome() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-accent/10 via-bg/0 to-bg/0 opacity-70"></div>
      <div className="w-full max-w-4xl bg-bg-secondary/50 backdrop-blur-2xl border border-border rounded-3xl shadow-glow p-8 md:p-12 z-10">
        
        <div className="flex flex-col items-center text-center">
          <div className="p-3 bg-gradient-to-br from-accent to-blue-500 rounded-full mb-6 shadow-lg">
            <Zap size={32} className="text-white" />
          </div>

          <h1 className="text-5xl md:text-6xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-text to-text-secondary">
            Welcome to <span className="bg-clip-text text-transparent bg-gradient-to-r from-accent to-blue-500">Nostr</span>
          </h1>

          <p className="text-text-secondary text-lg md:text-xl max-w-2xl mb-10">
            A new kind of social network. Decentralized, open, and free.
          </p>

          <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-6 text-left mb-10">
            <FeatureCard title="Direct Messages" icon={<MessageSquare size={24} className="text-accent"/>} color="#7C3AED">
              Encrypted, peer-to-peer conversations.
            </FeatureCard>
            <FeatureCard title="Public Channels" icon={<Users size={24} className="text-cyan"/>} color="#22D3EE">
              Join communities and discussions.
            </FeatureCard>
            <FeatureCard title="Your Identity" icon={<AtSign size={24} className="text-green"/>} color="#4ADE80">
              Controlled by you, not a corporation.
            </FeatureCard>
          </div>

          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
